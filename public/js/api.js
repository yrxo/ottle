// public/js/api.js — smart API resolver: Netlify Function (prod) ya local server.py (dev)
let _mode = null;

export async function resolveMode() {
  if (_mode) return _mode;
  try {
    const r = await fetch("/.netlify/functions/ottle-api?action=ping");
    const d = await r.json();
    if (d && d.ok) { _mode = "fn"; return _mode; }
  } catch (_) {}
  _mode = "local";
  return _mode;
}

export async function apiPost(localPath, fnAction, payload) {
  const m = await resolveMode();
  const url = m === "fn"
    ? `/.netlify/functions/ottle-api?action=${encodeURIComponent(fnAction)}`
    : localPath;
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    if (m === "fn") { // function dead? try local once
      try {
        const r2 = await fetch(localPath, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        return await r2.json();
      } catch (_) { return null; }
    }
    return null; // network fail (caller handles fallback)
  }
}
