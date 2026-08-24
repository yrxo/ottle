// netlify/functions/ottle-api.js — serverless backend for Ottle on Netlify
// Actions: ping | send-code | verify-code | create-order | verify-payment
const crypto = require("crypto");

const H = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
const j = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "";
const MAILBOXLAYER_KEY = process.env.MAILBOXLAYER_KEY || "";
const BREVO_KEY = process.env.BREVO_KEY || "";
const FROM_EMAIL = process.env.OTTLE_FROM_EMAIL || "raptorayush8@gmail.com";
const RZP_ID = process.env.RAZORPAY_KEY_ID || "";
const RZP_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const OTP_SECRET = process.env.OTP_SECRET || "dev-secret-change-me";
const PROJECT = "ottleb";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const otpHash = (email, code) =>
  crypto.createHmac("sha256", OTP_SECRET).update(`${email}|${code}`).digest("hex");

async function fsCreate(coll, docId, fields) {
  const body = { fields };
  const url = docId
    ? `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?documentId=${encodeURIComponent(docId)}`
    : `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : await r.text() };
}
async function fsGet(path) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`);
  return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
}
async function fsDelete(path) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { method: "DELETE" });
  return r.ok;
}

async function tokenEmail(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.users?.[0]?.email || null;
  } catch (_) { return null; }
}

async function mailboxValid(email) {
  try {
    const r = await fetch(`https://apilayer.net/api/check?access_key=${MAILBOXLAYER_KEY}&email=${encodeURIComponent(email)}&smtp=1&format=1`);
    const d = await r.json();
    return Boolean(d.format_valid) && !d.disposable;
  } catch (_) { return true; } // fail-open so verification isn't blocked if API hiccups
}

async function brevoSend(to, subject, text) {
  if (!BREVO_KEY) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Ottle", email: FROM_EMAIL }, to: [{ email: to }], subject, textContent: text })
  });
  return r.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(200, {});
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const action = (event.queryStringParameters && event.queryStringParameters.action) || body.action;

  try {
    /* ---------- PING ---------- */
    if (action === "ping") return j(200, { ok: true });

    /* ---------- SEND CODE ---------- */
    if (action === "send-code") {
      const email = (body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return j(400, { sent: false, message: "Enter a valid email address." });
      const acct = await tokenEmail(body.idToken);
      if (!acct) return j(401, { sent: false, message: "Not authorised. Sign in first." });
      if (acct.trim().toLowerCase() !== email)
        return j(403, { sent: false, message: "You can only request a code for your own account." });
      if (!(await mailboxValid(email)))
        return j(400, { sent: false, message: "Disposable/undeliverable emails are not allowed." });

      // 45s cooldown via meta doc
      const metaId = md5("meta:" + email);
      const meta = await fsGet(`otpMeta/${metaId}`);
      if (meta.ok && meta.data?.fields?.lastSent) {
        const last = Number(meta.data.fields.lastSent.integerValue || 0);
        const wait = 45 - Math.floor(Date.now() / 1000 - last);
        if (wait > 0) return j(429, { sent: false, retry_after: wait, message: `Please wait ${wait}s before requesting again.` });
      }

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const hash = otpHash(email, code);
      const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
      await fsCreate("otps", hash, { exp: { integerValue: String(exp) } });
      await fsCreate("otpMeta", metaId, { lastSent: { integerValue: String(Math.floor(Date.now() / 1000)) } });

      const sent = await brevoSend(email,
        `${code} is your Ottle verification code`,
        `Your Ottle verification code is: ${code}\n\nThis code expires in 10 minutes.`);
      if (!sent) return j(500, { sent: false, message: "Email service unavailable. Try again." });
      return j(200, { sent: true, cooldown: 45, ttl_min: 10 });
    }

    /* ---------- VERIFY CODE ---------- */
    if (action === "verify-code") {
      const email = (body.email || "").trim().toLowerCase();
      const code = (body.code || "").trim();
      if (!email || !/^\d{6}$/.test(code)) return j(400, { ok: false, message: "Enter the 6-digit code." });
      const hash = otpHash(email, code);
      const doc = await fsGet(`otps/${hash}`);
      if (!doc.ok) return j(400, { ok: false, remaining: 4, message: "Wrong code." });
      const exp = Number(doc.data?.fields?.exp?.integerValue || 0);
      if (exp < Math.floor(Date.now() / 1000)) {
        await fsDelete(`otps/${hash}`);
        return j(400, { ok: false, expired: true, message: "Code expired. Request a new one." });
      }
      await fsDelete(`otps/${hash}`);
      return j(200, { ok: true });
    }

    /* ---------- CREATE ORDER (Razorpay) ---------- */
    if (action === "create-order") {
      const amount = parseInt(body.amount, 10) || 0;
      if (amount < 100) return j(400, { error: "Minimum amount is ₹1 (100 paise)." });
      if (!RZP_ID || !RZP_SECRET) return j(500, { error: "Payment gateway not configured." });
      const auth = Buffer.from(`${RZP_ID}:${RZP_SECRET}`).toString("base64");
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency: "INR", receipt: "ottle_" + Date.now() })
      });
      if (!r.ok) return j(r.status === 401 ? 401 : 500, { error: "Gateway rejected order.", detail: (await r.text()).slice(0, 300) });
      const d = await r.json();
      return j(200, { order_id: d.id, amount: d.amount, currency: d.currency, key_id: RZP_ID });
    }

    /* ---------- VERIFY PAYMENT (Razorpay) ---------- */
    if (action === "verify-payment") {
      const oid = body.razorpay_order_id || "", pid = body.razorpay_payment_id || "", sig = body.razorpay_signature || "";
      if (!oid || !pid || !sig) return j(400, { verified: false, error: "Missing fields." });
      const expected = crypto.createHmac("sha256", RZP_SECRET).update(`${oid}|${pid}`).digest("hex");
      const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
      return j(ok ? 200 : 400, ok ? { verified: true } : { verified: false, error: "Signature mismatch." });
    }

    return j(404, { error: "Unknown action." });
  } catch (e) {
    return j(500, { error: "Server error.", detail: String(e).slice(0, 200) });
  }
};
