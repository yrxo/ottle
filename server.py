#!/usr/bin/env python3
# server.py — Ottle backend: static server + proper verification system
#
# Email OTP flow:
#   POST /api/verify-email    -> MailboxLayer deliverability check (key stays server-side)
#   POST /api/email/send-code -> validate + rate-limit + generate 6-digit code (10-min TTL)
#   POST /api/email/verify-code-> max 5 attempts, then code is burned
#
# Delivery (first available wins):
#   1. Brevo transactional email  (env OTTLE_BREVO_KEY)          <- recommended, free 300/day
#   2. SMTP                        (env OTTLE_SMTP_HOST/USER/PASS)
#   3. Demo mode                   (prints code to console + appends to demo_codes.log)
import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse
import json
import os
import re
import secrets
import time
import hmac
import hashlib
import base64
import smtplib
import ssl
from email.message import EmailMessage


def load_env():
    """Load KEY=VALUE pairs from .env next to this file (no overrides)."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())


load_env()
RZP_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")

MAILBOXLAYER_KEY = os.environ.get("MAILBOXLAYER_KEY", "")
WEB_API_KEY = "AIzaSyCWZqodMphE_c3ius68zkyvijjpsZDuf8Q"  # public identifier; verifies client Firebase tokens


def token_email(id_token):
    """Validate a Firebase ID token via Google Identity Toolkit; return account email or None."""
    if not id_token:
        return None
    try:
        url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=%s" % WEB_API_KEY
        req = urllib.request.Request(url, data=json.dumps({"idToken": id_token}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            users = (json.loads(r.read().decode()) or {}).get("users") or []
        return users[0].get("email") if users else None
    except Exception:
        return None

BREVO_KEY = os.environ.get("OTTLE_BREVO_KEY", "")
SMTP_HOST = os.environ.get("OTTLE_SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("OTTLE_SMTP_PORT", "465"))
SMTP_USER = os.environ.get("OTTLE_SMTP_USER", "")
SMTP_PASS = os.environ.get("OTTLE_SMTP_PASS", "").replace(" ", "")
FROM_EMAIL = os.environ.get("OTTLE_FROM_EMAIL", SMTP_USER)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PORT = int(os.environ.get("PORT", "5173"))  # hosting platforms inject PORT env

CODE_TTL = 600            # code valid for 10 minutes
MAX_ATTEMPTS = 5          # wrong tries before code is burned
SEND_COOLDOWN = 45        # seconds between two sends to same email
MAX_SENDS_PER_HOUR = 5    # rolling hourly cap per email

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
EMAIL_CODES = {}  # email -> {"code", "expires", "attempts", "sends":[timestamps]}


def cleanup_codes():
    now = time.time()
    for e in list(EMAIL_CODES):
        c = EMAIL_CODES[e]
        if c["expires"] < now - 1800:
            del EMAIL_CODES[e]


def verify_email(email):
    try:
        url = ("https://apilayer.net/api/check?access_key=%s&email=%s&smtp=1&format=1"
               % (MAILBOXLAYER_KEY, urllib.parse.quote(email)))
        with urllib.request.urlopen(url, timeout=12) as r:
            d = json.loads(r.read().decode())
        return {"email": email,
                "valid": bool(d.get("format_valid")) and not d.get("disposable"),
                "format_valid": d.get("format_valid"), "mx_found": d.get("mx_found"),
                "disposable": d.get("disposable")}
    except Exception as e:
        return {"email": email, "valid": None, "error": str(e)}


def deliver_code(email, code):
    body = ("Your Ottle verification code is: %s\n\n"
            "This code expires in %d minutes. If you didn't request this, ignore this email." % (code, CODE_TTL // 60))
    subject = "%s is your Ottle verification code" % code
    if BREVO_KEY:
        try:
            payload = json.dumps({
                "sender": {"name": "Ottle", "email": FROM_EMAIL},
                "to": [{"email": email}],
                "subject": subject,
                "textContent": body
            }).encode()
            req = urllib.request.Request(
                "https://api.brevo.com/v3/smtp/email", data=payload,
                headers={"api-key": BREVO_KEY, "Content-Type": "application/json", "accept": "application/json"})
            urllib.request.urlopen(req, timeout=15)
            return True, "brevo"
        except Exception as e:
            print("[BREVO ERROR]", e)
    if SMTP_HOST and SMTP_USER:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = FROM_EMAIL
            msg["To"] = email
            msg.set_content(body)
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as s:
                s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
            return True, "smtp"
        except Exception as e:
            print("[SMTP ERROR]", e)
    # Demo fallback: console + logfile so the code is retrievable while testing
    line = "[%s] DEMO CODE %s -> %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), code, email)
    print("=" * 44)
    print(line.strip())
    print("=" * 44)
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_codes.log"), "a") as f:
            f.write(line)
    except Exception:
        pass
    return True, "demo"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        # Root index.html = single source of truth; "/" hamesha wahi serve kare
        if self.path in ("/", "/index.html"):
            root_idx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
            if os.path.exists(root_idx):
                with open(root_idx, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
                return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send(self, obj, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode())

    def do_POST(self):
        path = self.path.rstrip("/")
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}

        if path == "/api/verify-email":
            email = (body.get("email") or "").strip().lower()
            self._send(verify_email(email))

        elif path == "/api/email/send-code":
            cleanup_codes()
            email = (body.get("email") or "").strip().lower()
            if not EMAIL_RE.match(email):
                return self._send({"sent": False, "message": "Enter a valid email address."}, 400)
            # Security: only a signed-in user may request a code, and only for their OWN email
            acct = token_email(body.get("idToken"))
            if not acct:
                return self._send({"sent": False, "message": "Not authorised. Sign in first."}, 401)
            if acct.strip().lower() != email:
                return self._send({"sent": False, "message": "You can only request a code for your own account."}, 403)
            vr = verify_email(email)
            if vr.get("valid") is not True:
                msg = "Disposable emails are not allowed." if vr.get("disposable") else "This email doesn't look deliverable."
                return self._send({"sent": False, "reason": "invalid", "message": msg}, 400)

            now = time.time()
            rec = EMAIL_CODES.get(email, {})
            sends = [t for t in rec.get("sends", []) if now - t < 3600]
            if len(sends) >= MAX_SENDS_PER_HOUR:
                wait = int(3600 - (now - sends[0])) + 60
                return self._send({"sent": False, "retry_after": wait,
                                   "message": "Too many codes requested. Try again in %d min." % (wait // 60 + 1)}, 429)
            if sends and now - sends[-1] < SEND_COOLDOWN:
                wait = int(SEND_COOLDOWN - (now - sends[-1])) + 1
                return self._send({"sent": False, "retry_after": wait,
                                   "message": "Please wait %ds before requesting again." % wait}, 429)

            code = "%06d" % secrets.randbelow(1000000)
            EMAIL_CODES[email] = {"code": code, "expires": now + CODE_TTL,
                                  "attempts": 0, "sends": sends + [now]}
            ok, via = deliver_code(email, code)
            self._send({"sent": ok, "via": via, "cooldown": SEND_COOLDOWN,
                        "ttl_min": CODE_TTL // 60})

        elif path == "/api/email/verify-code":
            email = (body.get("email") or "").strip().lower()
            code = (body.get("code") or "").strip()
            rec = EMAIL_CODES.get(email)
            if not rec:
                return self._send({"ok": False, "message": "No code found. Request a new one."}, 400)
            if rec["expires"] < time.time():
                del EMAIL_CODES[email]
                return self._send({"ok": False, "expired": True, "message": "Code expired. Request a new one."}, 400)
            if rec["attempts"] >= MAX_ATTEMPTS:
                del EMAIL_CODES[email]
                return self._send({"ok": False, "burned": True,
                                   "message": "Too many wrong attempts. Request a new code."}, 429)
            if rec["code"] == code:
                del EMAIL_CODES[email]
                return self._send({"ok": True})
            rec["attempts"] += 1
            left = MAX_ATTEMPTS - rec["attempts"]
            self._send({"ok": False, "remaining": left,
                        "message": "Wrong code. %d attempt%s left." % (left, "" if left == 1 else "s")}, 400)

        elif path == "/api/create-order":
            # Razorpay Standard Checkout: create order server-side (secret never leaves backend)
            try:
                amount = int(body.get("amount") or 0)
            except Exception:
                amount = 0
            if amount < 100:
                return self._send({"error": "Minimum amount is \u20b91 (100 paise)."}, 400)
            if not RZP_KEY_ID or not RZP_KEY_SECRET:
                return self._send({"error": "Payment gateway not configured."}, 500)
            receipt = "ottle_%d" % int(time.time())
            auth = base64.b64encode(("%s:%s" % (RZP_KEY_ID, RZP_KEY_SECRET)).encode()).decode()
            payload = json.dumps({"amount": amount, "currency": "INR", "receipt": receipt}).encode()
            req = urllib.request.Request(
                "https://api.razorpay.com/v1/orders", data=payload,
                headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    d = json.loads(r.read().decode())
                self._send({"order_id": d["id"], "amount": d["amount"],
                            "currency": d["currency"], "key_id": RZP_KEY_ID})
            except urllib.error.HTTPError as e:
                try:
                    detail = e.read().decode()[:300]
                except Exception:
                    detail = ""
                self._send({"error": "Gateway rejected order.", "detail": detail}, 401 if e.code == 401 else 500)
            except Exception as e:
                self._send({"error": "Could not reach payment gateway.", "detail": str(e)[:200]}, 500)

        elif path == "/api/verify-payment":
            oid = body.get("razorpay_order_id") or ""
            pid = body.get("razorpay_payment_id") or ""
            sig = body.get("razorpay_signature") or ""
            if not (oid and pid and sig):
                return self._send({"verified": False, "error": "Missing fields."}, 400)
            expected = hmac.new(RZP_KEY_SECRET.encode(),
                                ("%s|%s" % (oid, pid)).encode(), hashlib.sha256).hexdigest()
            if hmac.compare_digest(expected, sig):
                self._send({"verified": True})
            else:
                self._send({"verified": False, "error": "Signature mismatch."}, 400)

        else:
            self._send({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    cleanup_codes()
    # NOTE: False on purpose — Windows SO_REUSEADDR allows TWO servers on one port (zombie bug)
    socketserver.TCPServer.allow_reuse_address = False
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        mode = "brevo" if BREVO_KEY else ("smtp" if SMTP_HOST and SMTP_USER else "demo (codes -> console/demo_codes.log)")
        print(f"Ottle running at http://localhost:{PORT}")
        print(f"Verification delivery: {mode}")
        httpd.serve_forever()
