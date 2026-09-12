#!/usr/bin/env node
/* Greenlight AI proxy — the only place provider keys live.
   Zero dependencies; needs Node 18+ (built-in fetch/FormData/Blob).

     mobile app ──> this server ──> Anthropic (interpret text, read photos)
                                └─> ElevenLabs (speech-to-text, text-to-speech)

   The GO/WAIT/SWITCH/INSPECT decision is NOT made here — the deterministic
   engine runs on the phone. This server only structures messy inputs.

   Endpoints (all JSON unless noted):
     GET  /health      -> { ok, anthropic, elevenlabs }
     POST /interpret   { text }                        -> { observation, mentions, source }
     POST /vision      { image_base64, media_type }    -> { observation, source }
     POST /transcribe  { audio_base64, mime }          -> { text }
     POST /speak       { text }                        -> { audio_base64, mime }
*/
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---- tiny .env loader (server/.env — never committed)
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[2] && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch (e) { /* run on plain process env */ }

const PORT = parseInt(process.env.PORT || "8787", 10);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
// scribe_v1 / eleven_turbo_v2_5 are deprecated (removed mid-2026) — current models:
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v2";
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";
const ELEVEN_BASE = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/, "");
const MAX_BODY = 20 * 1024 * 1024;

// ---- observation schema guard (mirror of the app's enums)
const ENUMS = {
  leaf_position: ["older", "younger", "all", "unknown"],
  colour_pattern: ["uniform_chlorosis", "interveinal", "tip_burn", "purpling", "necrosis", "none", "unknown"],
  distribution: ["patchy", "uniform", "along_lines", "low_lying", "unknown"],
  vigour: ["poor", "moderate", "good", "unknown"],
};
function sanitizeObservation(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(o[k])) out[k] = o[k];
  }
  if (typeof o.waterlogging_cues === "boolean") out.waterlogging_cues = o.waterlogging_cues;
  return out;
}

const INTERPRET_SYSTEM =
  "Extract crop-scouting observations from a farm worker's message. Report ONLY what is " +
  "stated or clearly implied — never diagnose a cause. Reply with strict JSON: " +
  '{"observation":{"leaf_position":"older|younger|all|unknown",' +
  '"colour_pattern":"uniform_chlorosis|interveinal|tip_burn|purpling|necrosis|none|unknown",' +
  '"distribution":"patchy|uniform|along_lines|low_lying|unknown",' +
  '"vigour":"poor|moderate|good|unknown","waterlogging_cues":boolean},' +
  '"mentions":{"recent_rain":boolean,"frost":boolean,"recent_spray":boolean}}. ' +
  "Omit any field the message says nothing about.";

const VISION_SYSTEM =
  "You are a crop-scouting perception module. Look at the crop photo and report ONLY what " +
  "you observe as strict JSON — do NOT diagnose a cause. Schema: " +
  '{"leaf_position":"older|younger|all|unknown",' +
  '"colour_pattern":"uniform_chlorosis|interveinal|tip_burn|purpling|necrosis|none|unknown",' +
  '"distribution":"patchy|uniform|along_lines|low_lying|unknown",' +
  '"vigour":"poor|moderate|good|unknown","waterlogging_cues":boolean,' +
  '"image_quality":0.0,"notes":"one short sentence"}';

async function anthropic(system, content) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 400, system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const raw = j.content && j.content[0] && j.content[0].text;
  if (!raw) throw new Error("anthropic: empty response");
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}

// ---- handlers
const handlers = {
  "GET /health": async () => ({
    ok: true, anthropic: !!ANTHROPIC_KEY, elevenlabs: !!ELEVEN_KEY,
    models: { interpret: ANTHROPIC_KEY ? MODEL : null, stt: ELEVEN_KEY ? STT_MODEL : null,
              tts: ELEVEN_KEY ? TTS_MODEL : null },
  }),

  "POST /interpret": async (body) => {
    if (!ANTHROPIC_KEY) throw httpError(501, "anthropic not configured");
    const text = String(body.text || "").slice(0, 4000);
    if (!text.trim()) throw httpError(400, "text required");
    const parsed = await anthropic(INTERPRET_SYSTEM, text);
    return {
      observation: sanitizeObservation(parsed.observation),
      mentions: (parsed.mentions && typeof parsed.mentions === "object") ? parsed.mentions : {},
      source: `AI (${MODEL})`,
    };
  },

  "POST /vision": async (body) => {
    if (!ANTHROPIC_KEY) throw httpError(501, "anthropic not configured");
    const b64 = body.image_base64;
    if (!b64 || typeof b64 !== "string") throw httpError(400, "image_base64 required");
    const media = ["image/jpeg", "image/png", "image/webp"].includes(body.media_type)
      ? body.media_type : "image/jpeg";
    const parsed = await anthropic(VISION_SYSTEM, [
      { type: "image", source: { type: "base64", media_type: media, data: b64 } },
      { type: "text", text: "Return the observation JSON for this crop photo." },
    ]);
    return { observation: sanitizeObservation(parsed), source: `AI vision (${MODEL})` };
  },

  "POST /transcribe": async (body) => {
    if (!ELEVEN_KEY) throw httpError(501, "elevenlabs not configured");
    const b64 = body.audio_base64;
    if (!b64 || typeof b64 !== "string") throw httpError(400, "audio_base64 required");
    const mime = String(body.mime || "audio/m4a");
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(b64, "base64")], { type: mime }), "note.m4a");
    form.append("model_id", STT_MODEL);
    const res = await fetch(`${ELEVEN_BASE}/v1/speech-to-text`, {
      method: "POST", headers: { "xi-api-key": ELEVEN_KEY }, body: form,
    });
    if (!res.ok) throw httpError(502, `elevenlabs stt ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    // single-channel response carries .text; multi-channel carries .transcripts[]
    const text = j.text || (Array.isArray(j.transcripts)
      ? j.transcripts.map(t => t.text || "").join(" ").trim() : "");
    return { text };
  },

  "POST /speak": async (body) => {
    if (!ELEVEN_KEY) throw httpError(501, "elevenlabs not configured");
    const text = String(body.text || "").slice(0, 900);
    if (!text.trim()) throw httpError(400, "text required");
    const res = await fetch(
      `${ELEVEN_BASE}/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": ELEVEN_KEY, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: TTS_MODEL }),
      });
    if (!res.ok) throw httpError(502, `elevenlabs tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio_base64: buf.toString("base64"), mime: "audio/mpeg" };
  },
};

// ---- plumbing
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, "body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(httpError(400, "invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, headers); res.end(); return; }
  const route = `${req.method} ${new URL(req.url, "http://x").pathname}`;
  const handler = handlers[route];
  if (!handler) {
    res.writeHead(404, headers); res.end(JSON.stringify({ error: "not found" })); return;
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const out = await handler(body);
    res.writeHead(200, headers); res.end(JSON.stringify(out));
  } catch (e) {
    const status = e.status || 500;
    res.writeHead(status, headers); res.end(JSON.stringify({ error: e.message }));
    console.error(`${route} -> ${status} ${e.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`greenlight ai proxy on :${PORT}`);
  console.log(`  anthropic:  ${ANTHROPIC_KEY ? `on (${MODEL})` : "OFF — set ANTHROPIC_API_KEY"}`);
  console.log(`  elevenlabs: ${ELEVEN_KEY ? `on (stt ${STT_MODEL}, tts ${TTS_MODEL}, voice ${VOICE})` : "OFF — set ELEVENLABS_API_KEY"}`);
});
