/* Photo → observations. The vision model reports what it SEES (leaf position,
   colour pattern, distribution, waterlogging cues) — it never names a cause;
   the deterministic engine does the diagnosing.

   Without a key this returns null and the check runs on text + context alone. */

const LLM_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || null;

let FileSystem = null;
try { FileSystem = require("expo-file-system/legacy"); } catch (e) {
  try { FileSystem = require("expo-file-system"); } catch (e2) { /* unavailable */ }
}

const SYSTEM = 'You are a crop-scouting perception module. Look at the crop photo and ' +
  'report ONLY what you observe as strict JSON — do NOT diagnose a cause. Schema: ' +
  '{"leaf_position":"older|younger|all|unknown",' +
  '"colour_pattern":"uniform_chlorosis|interveinal|tip_burn|purpling|necrosis|none|unknown",' +
  '"distribution":"patchy|uniform|along_lines|low_lying|unknown",' +
  '"vigour":"poor|moderate|good|unknown","waterlogging_cues":boolean,' +
  '"image_quality":0-1,"notes":"one short sentence"}';

export const hasVision = () => !!(LLM_KEY && FileSystem && FileSystem.readAsStringAsync);

export async function observePhoto(uri) {
  if (!hasVision()) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    const media = uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": LLM_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: b64 } },
            { type: "text", text: "Return the observation JSON for this crop photo." },
          ],
        }],
      }),
    });
    const j = await res.json();
    const raw = j.content && j.content[0] && j.content[0].text;
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const keep = {};
    if (["older", "younger", "all", "unknown"].includes(o.leaf_position)) keep.leaf_position = o.leaf_position;
    if (["uniform_chlorosis", "interveinal", "tip_burn", "purpling", "necrosis", "none", "unknown"].includes(o.colour_pattern)) keep.colour_pattern = o.colour_pattern;
    if (["patchy", "uniform", "along_lines", "low_lying", "unknown"].includes(o.distribution)) keep.distribution = o.distribution;
    if (["poor", "moderate", "good", "unknown"].includes(o.vigour)) keep.vigour = o.vigour;
    if (typeof o.waterlogging_cues === "boolean") keep.waterlogging_cues = o.waterlogging_cues;
    return Object.keys(keep).length ? keep : null;
  } catch (e) {
    return null;
  }
}
