/* Input interpretation: worker language (typed or transcribed) → the
   structured Observation the deterministic engine consumes.

   - backend /interpret (Anthropic, key stays server-side): used when online
   - local keyword parser: always available, offline, transparent fallback
   Interpretation only STRUCTURES input — the GO/WAIT/SWITCH/INSPECT call is
   always the on-device deterministic engine. */

const api = require("./api");

const ENUMS = {
  leaf_position: ["older", "younger", "all", "unknown"],
  colour_pattern: ["uniform_chlorosis", "interveinal", "tip_burn", "purpling", "necrosis", "none", "unknown"],
  distribution: ["patchy", "uniform", "along_lines", "low_lying", "unknown"],
  vigour: ["poor", "moderate", "good", "unknown"],
};

export function sanitizeObservation(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k of Object.keys(ENUMS)) if (ENUMS[k].includes(o[k])) out[k] = o[k];
  if (typeof o.waterlogging_cues === "boolean") out.waterlogging_cues = o.waterlogging_cues;
  return out;
}

export function parseLocal(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const has = (...words) => words.some(w => t.includes(w));
  const obs = {};
  const mentions = {};

  // leaf position
  if (has("old leaf", "older leaf", "old leaves", "older leaves", "bottom leaves", "lower leaves")) obs.leaf_position = "older";
  else if (has("new leaf", "new leaves", "young leaf", "young leaves", "younger leaves", "youngest", "top leaves", "new growth")) obs.leaf_position = "younger";
  else if (has("whole plant", "all leaves", "all over the plant")) obs.leaf_position = "all";

  // colour pattern
  if (has("between the veins", "between veins", "interveinal", "striping", "stripes", "stripey")) obs.colour_pattern = "interveinal";
  else if (has("dead patches", "dead leaf", "dead leaves", "burnt", "scorch", "necro", "dying")) obs.colour_pattern = "necrosis";
  else if (has("purple", "purpling", "reddish")) obs.colour_pattern = "purpling";
  else if (has("tip burn", "burnt tips", "tips burn")) obs.colour_pattern = "tip_burn";
  else if (has("yellow", "yellowing", "pale", "paling", "chloro", "washed out", "lighter green")) obs.colour_pattern = "uniform_chlorosis";

  // distribution
  if (has("low spot", "low spots", "low-lying", "low lying", "hollow", "hollows", "bottom of the paddock", "low part", "low ground", "flat at the bottom")) obs.distribution = "low_lying";
  else if (has("spray line", "spray lines", "spray run", "wheel track", "tram line", "tramline", "in lines", "strips ")) obs.distribution = "along_lines";
  else if (has("patchy", "patches", "spots of", "here and there", "some areas")) obs.distribution = "patchy";
  else if (has("whole paddock", "everywhere", "right across", "across the paddock", "the lot", "uniform")) obs.distribution = "uniform";

  // vigour
  if (has("struggling", "going backwards", "thin crop", "poor crop", "sick", "stunted", "looks terrible", "looks bad")) obs.vigour = "poor";
  else if (has("otherwise healthy", "looks healthy", "good crop", "thick crop", "growing well")) obs.vigour = "good";

  // waterlogging cues
  if (has("ponding", "pooled", "pooling", "standing water", "waterlogged", "water logged", "boggy", "bogged", "soggy", "sodden", "under water", "drowned", "squelch")) {
    obs.waterlogging_cues = true;
    if (!obs.distribution) obs.distribution = "low_lying";
  }

  // context mentions (hints only)
  if (has("rain", "rained", "wet week", "downpour", "storm", "drenched", " wet ")) mentions.recent_rain = true;
  if (has("frost", "froze", "frosted")) mentions.frost = true;
  if (has("sprayed", "herbicide", "spray ")) mentions.recent_spray = true;

  return { observation: obs, mentions, source: "local parser (offline)" };
}

/* Main entry: backend when reachable, local parser otherwise or on failure. */
export async function interpret(text) {
  if (!text || !text.trim()) return { observation: {}, mentions: {}, source: "empty" };
  if (api.hasBackend() && api.healthSnapshot().anthropic) {
    try {
      const r = await api.post("/interpret", { text }, 12000);
      return {
        observation: sanitizeObservation(r.observation),
        mentions: r.mentions || {},
        source: r.source || "AI (server)",
      };
    } catch (e) { /* fall back below */ }
  }
  return parseLocal(text);
}

export const hasLLM = () => api.hasBackend() && api.healthSnapshot().anthropic;
