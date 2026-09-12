/* Backend client. The app holds NO provider keys — only this URL.
   EXPO_PUBLIC_GREENLIGHT_API points at server/ (see repo /server). */

const BASE = String(process.env.EXPO_PUBLIC_GREENLIGHT_API || "").replace(/\/+$/, "");

let snap = { at: 0, ok: false, anthropic: false, elevenlabs: false };

function hasBackend() { return !!BASE; }
function healthSnapshot() { return snap; }

async function withTimeout(ms, fn) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fn(ctl.signal); } finally { clearTimeout(t); }
}

async function refreshHealth(force = false) {
  if (!BASE) return snap;
  if (!force && Date.now() - snap.at < 60000) return snap;
  try {
    const j = await withTimeout(4000, sig =>
      fetch(`${BASE}/health`, { signal: sig }).then(r => r.json()));
    snap = { at: Date.now(), ok: !!j.ok, anthropic: !!j.anthropic, elevenlabs: !!j.elevenlabs };
  } catch (e) {
    snap = { at: Date.now(), ok: false, anthropic: false, elevenlabs: false };
  }
  return snap;
}

async function post(path, body, timeoutMs = 15000) {
  if (!BASE) throw new Error("no backend configured");
  return withTimeout(timeoutMs, async sig => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: sig,
    });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  });
}

module.exports = { hasBackend, healthSnapshot, refreshHealth, post };
