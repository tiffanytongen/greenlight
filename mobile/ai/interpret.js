/* Input interpretation: turns messy worker language (typed or transcribed)
   into the structured Observation the deterministic engine consumes.

   Two paths, same output shape:
   - local keyword parser: always available, offline, transparent
   - optional LLM (Anthropic): better with odd phrasing; used only to
     STRUCTURE the input, never to make the GO/WAIT/SWITCH/INSPECT call.
   LLM output is validated against the schema enums and falls back to the
   local parse on any failure. */

const LEAF = ["older", "younger", "all", "unknown"];
const PATTERN = ["uniform_chlorosis", "interveinal", "tip_burn", "purpling", "necrosis", "none", "unknown"];
const DIST = ["patchy", "uniform", "along_lines", "low_lying", "unknown"];
const VIGOUR = ["poor", "moderate", "good", "unknown"];

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

  // context mentions (used for hints, not observation fields)
  if (has("rain", "rained", "wet week", "downpour", "storm", "drenched", " wet ")) mentions.recent_rain = true;
  if (has("frost", "froze", "frosted")) mentions.frost = true;
  if (has("sprayed", "herbicide", "spray ")) mentions.recent_spray = true;
  if (has("fertilis", "fertiliz", "urea", "top-dress", "topdress", "spread")) mentions.fertiliser_question = true;

  return { observation: obs, mentions, source: "local parser" };
}

// ---------------------------------------------------------------- optional LLM
const LLM_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY || null;

const SYSTEM = 'Extract crop-scouting observations from a farm worker\'s message. ' +
  'Report ONLY what is stated or clearly implied — never diagnose a cause. ' +
  'Reply with strict JSON: {"observation":{"leaf_position":"older|younger|all|unknown",' +
  '"colour_pattern":"uniform_chlorosis|interveinal|tip_burn|purpling|necrosis|none|unknown",' +
  '"distribution":"patchy|uniform|along_lines|low_lying|unknown",' +
  '"vigour":"poor|moderate|good|unknown","waterlogging_cues":boolean},' +
  '"mentions":{"recent_rain":boolean,"frost":boolean,"recent_spray":boolean}}. ' +
  'Omit any field the message says nothing about.';

async function parseLLM(text) {
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
      messages: [{ role: "user", content: text }],
    }),
  });
  const j = await res.json();
  const raw = j.content && j.content[0] && j.content[0].text;
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  const o = parsed.observation || {};
  const obs = {};
  if (LEAF.includes(o.leaf_position)) obs.leaf_position = o.leaf_position;
  if (PATTERN.includes(o.colour_pattern)) obs.colour_pattern = o.colour_pattern;
  if (DIST.includes(o.distribution)) obs.distribution = o.distribution;
  if (VIGOUR.includes(o.vigour)) obs.vigour = o.vigour;
  if (typeof o.waterlogging_cues === "boolean") obs.waterlogging_cues = o.waterlogging_cues;
  return { observation: obs, mentions: parsed.mentions || {}, source: "AI interpreter" };
}

/* Main entry: LLM when configured, local parser otherwise (and on failure). */
export async function interpret(text) {
  if (!text || !text.trim()) return { observation: {}, mentions: {}, source: "empty" };
  if (LLM_KEY) {
    try { return await parseLLM(text); } catch (e) { /* fall through */ }
  }
  return parseLocal(text);
}

export const hasLLM = () => !!LLM_KEY;
