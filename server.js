// server.js — Ottle 2.0 Node.js server on localhost:1223
// Pure Node.js (no npm deps needed). Serves static frontend + basic API.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 1223;
const ROOT = path.join(__dirname, "public");
const ROOT_INDEX = path.join(__dirname, "index.html");

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
      // Fallback to root index.html (SPA routing)
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

  // ---- API routes (dev-mode stubs; Firebase handles real data from frontend) ----
  if (pathname.startsWith("/api/")) {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try { JSON.parse(body || "{}"); } catch (_) { body = "{}"; }
        const action = pathname.replace("/api/", "");
        send(res, 200, {
          ok: true, action, mode: "node-dev-stub",
          note: "Real data handled by Firebase from frontend. Set up server.py for email OTP + Razorpay.",
        });
      });
      return;
    }
    send(res, 405, { error: "method not allowed" });
    return;
  }

  // ---- Static files ----
  let filePath = pathname === "/" ? ROOT_INDEX : path.join(ROOT, pathname.slice(1));
  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(ROOT)) && resolved !== ROOT_INDEX) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  serveFile(res, filePath);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("═".repeat(50));
  console.log("  Ottle 2.0 — Node.js server");
  console.log(`  http://localhost:${PORT}`);
  console.log("═".repeat(50));
});
