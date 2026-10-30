// server.js — Ottle Node.js server on localhost:1223
// Pure Node.js (no npm deps). Static files + Email OTP backend.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const PORT = 1223;
const ROOT = path.join(__dirname, "public");
const ROOT_INDEX = path.join(__dirname, "index.html");
const LOG_DIR = __dirname;

// ---- In-memory OTP store ----
const CODE_TTL = 600;           // 10 minutes
const MAX_ATTEMPTS = 5;
const SEND_COOLDOWN = 45;
const MAX_SENDS_PER_HOUR = 5;
const EMAIL_CODES = {}; // email -> { code, expires, attempts, sends: [] }

function cleanupCodes() {
  const now = Date.now() / 1000;
  for (const e of Object.keys(EMAIL_CODES)) {
    const c = EMAIL_CODES[e];
    if (c.expires < now - 1800) delete EMAIL_CODES[e];
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function generateCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

// ---- Brevo email sender (optional, set BREVO_KEY env) ----
function sendViaBrevo(to, subject, text) {
  const key = process.env.BREVO_KEY || "";
  if (!key) return false;
  return new Promise((resolve) => {
    const data = JSON.stringify({
      sender: { name: "Ottle", email: process.env.OTTLE_FROM_EMAIL || "noreply@ottle.in" },
      to: [{ email: to }],
      subject,
      textContent: text,
    });
    const opts = {
      hostname: "api.brevo.com",
      port: 443,
      path: "/v3/smtp/email",
      method: "POST",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        "accept": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve(r.statusCode >= 200 && r.statusCode < 300));
    });
    req.on("error", () => resolve(false));
    req.write(data);
    req.end();
  });
}

// ---- SMTP sender (optional) ----
function sendViaSmtp(to, subject, text) {
  // Node has no built-in SMTP; skip silently, demo mode handles it
  return Promise.resolve(false);
}

// ---- Demo mode: print code to console + log file ----
function sendDemo(to, code) {
  const line = `[${new Date().toISOString()}] OTP CODE ${code} -> ${to}`;
  console.log("=".repeat(50));
  console.log(line);
  console.log("=".repeat(50));
  try {
    fs.appendFileSync(path.join(LOG_DIR, "demo_codes.log"), line + "\n");
  } catch (_) {}
  return true;
}

async function deliverCode(email, code) {
  const body = `Your Ottle verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.`;
  const subject = `${code} is your Ottle verification code`;

  // 1. Brevo
  try {
    if (await sendViaBrevo(email, subject, body)) return true;
  } catch (_) {}
  // 2. SMTP (stub)
  try {
    if (await sendViaSmtp(email, subject, body)) return true;
  } catch (_) {}
  // 3. Demo fallback
  return sendDemo(email, code);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  if (Buffer.isBuffer(body)) res.end(body);
  else if (typeof body === "string") res.end(body);
  else res.end(JSON.stringify(body));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(ROOT_INDEX, (err2, indexData) => {
        if (err2) { send(res, 404, { error: "not found" }); return; }
        send(res, 200, indexData, "text/html; charset=utf-8");
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, MIME[ext] || "application/octet-stream");
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") { send(res, 200, {}); return; }

  // Health check
  if (pathname === "/api/ping" || pathname === "/.netlify/functions/ottle-api?action=ping") {
    send(res, 200, { ok: true, server: "node-1223" });
    return;
  }

  // ---- API routes ----
  if (pathname.startsWith("/api/")) {
    if (req.method !== "POST") { send(res, 405, { error: "method not allowed" }); return; }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch (_) { payload = {}; }

      const action = pathname.replace(/^\/api\//, "");

      // ---- SEND CODE ----
      if (action === "email/send-code") {
        cleanupCodes();
        const email = (payload.email || "").trim().toLowerCase();
        if (!validateEmail(email)) {
          return send(res, 400, { sent: false, message: "Enter a valid email address." });
        }

        const rec = EMAIL_CODES[email] || {};
        const now = Date.now() / 1000;
        const sends = (rec.sends || []).filter((t) => now - t < 3600);
        if (sends.length >= MAX_SENDS_PER_HOUR) {
          return send(res, 429, { sent: false, message: "Too many codes requested. Try again later." });
        }
        if (sends.length && now - sends[sends.length - 1] < SEND_COOLDOWN) {
          return send(res, 429, { sent: false, message: "Please wait before requesting again." });
        }

        const code = generateCode();
        EMAIL_CODES[email] = {
          code,
          expires: now + CODE_TTL,
          attempts: 0,
          sends: [...sends, now],
        };

        const ok = await deliverCode(email, code);
        return send(res, 200, {
          sent: ok, cooldown: SEND_COOLDOWN, ttl_min: CODE_TTL / 60,
          // debug: show code in dev
          _debug_code: code,
        });
      }

      // ---- VERIFY CODE ----
      if (action === "email/verify-code") {
        const email = (payload.email || "").trim().toLowerCase();
        const code = (payload.code || "").trim();
        const rec = EMAIL_CODES[email];
        if (!rec) {
          return send(res, 400, { ok: false, message: "No code found. Request a new one." });
        }
        const now = Date.now() / 1000;
        if (rec.expires < now) {
          delete EMAIL_CODES[email];
          return send(res, 400, { ok: false, expired: true, message: "Code expired. Request a new one." });
        }
        if (rec.attempts >= MAX_ATTEMPTS) {
          delete EMAIL_CODES[email];
          return send(res, 429, { ok: false, burned: true, message: "Too many wrong attempts." });
        }
        if (rec.code === code) {
          delete EMAIL_CODES[email];
          return send(res, 200, { ok: true });
        }
        rec.attempts += 1;
        const left = MAX_ATTEMPTS - rec.attempts;
        return send(res, 400, { ok: false, remaining: left, message: `Wrong code. ${left} left.` });
      }

      // ---- PING ----
      if (action === "ping") {
        return send(res, 200, { ok: true, server: "node-1223" });
      }

      // Generic API fallback
      return send(res, 200, { ok: true, action, mode: "node-dev" });
    });
    return;
  }

  // ---- Static files ----
  let filePath = pathname === "/" ? ROOT_INDEX : path.join(ROOT, pathname.slice(1));
  if (!fs.existsSync(filePath)) {
    const rootFile = path.join(__dirname, pathname.slice(1));
    if (fs.existsSync(rootFile)) filePath = rootFile;
  }
  const resolved = path.resolve(filePath);
  const allowedRoots = [path.resolve(ROOT), path.resolve(__dirname)];
  if (!allowedRoots.some((r) => resolved.startsWith(r)) && resolved !== ROOT_INDEX) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  serveFile(res, filePath);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("═".repeat(50));
  console.log("  Ottle — Node.js server");
  console.log(`  http://localhost:${PORT}`);
  console.log("  Email OTP: demo mode (check console + demo_codes.log)");
  console.log("═".repeat(50));
});
