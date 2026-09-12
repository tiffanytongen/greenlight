/* Greenlight decision engine — faithful JS port of the Python package
   (signals.py, retrieval.py, reasoning.py, safety.py, pipeline.py, run_eval.py).
   Deterministic; verified against the Python engine on all 25 scenarios. */

const CONFIG = {
  UREA_PRICE_PER_T: 800.0,
  BAD_TIMING_LOSS_LOW: 0.20,
  BAD_TIMING_LOSS_HIGH: 0.40,
  INCORP_RAIN_MIN_MM: 5.0,
  INCORP_RAIN_MAX_MM: 15.0,
  LEACHING_RAIN_MM_72H: 25.0,
  LEACHING_SOILS: ["sand", "loamy_sand", "sandy_loam", "duplex"],
  VOLAT_TMAX_C: 22.0,
  SATURATION_VWC: 0.42,
  DELTA_T_MIN: 2.0, DELTA_T_MAX: 8.0,
  WIND_MIN_KMH: 3.0, WIND_MAX_KMH: 15.0,
  CONFIDENCE_GO_MIN: 0.55,
  RATE_DEVIATION_ALLOWED: 0.30,
};

/* Python-style round at nd decimals: correct rounding of the double's exact
   decimal value, with ties going to the even digit (banker's rounding). */
function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  const t = x.toFixed(nd + 1); // exact tie <=> representable at nd+1 decimals, ending in 5
  if (parseFloat(t) === x && t.endsWith("5")) {
    let p = t.slice(0, -1);
    if (p.endsWith(".")) p = p.slice(0, -1);
    const kept = parseFloat(p); // truncated toward zero
    const lastDigit = parseInt(p.replace("-", "").replace(".", "").slice(-1) || "0", 10);
    if (lastDigit % 2 === 0) return kept === 0 ? 0 : kept;
    const step = Math.pow(10, -nd);
    return parseFloat((kept + Math.sign(x) * step).toFixed(nd));
  }
  const v = parseFloat(x.toFixed(nd)); // no tie: plain correct rounding
  return v === 0 ? 0 : v;
}

// ------------------------------------------------------------------ corpus + retrieval
const CORPUS = {
  n_symptom: {
    text: "Nitrogen deficiency usually shows first on older, lower leaves as a general yellowing, because nitrogen is mobile and moves to new growth.",
    source: "PLACEHOLDER - replace with GRDC nitrogen fact sheet citation",
  },
  s_symptom: {
    text: "Sulfur deficiency typically appears on the youngest leaves as a uniform paling, because sulfur is not readily remobilised within the plant; this distinguishes it from nitrogen deficiency, which shows first on older leaves.",
    source: "PLACEHOLDER - replace with Agriculture Victoria nutrition note",
  },
  waterlog_symptom: {
    text: "Temporary waterlogging can cause yellowing of older leaves that resembles nitrogen deficiency, because saturated roots cannot take up nutrients; such patches often occur in low-lying areas and may recover once the soil drains.",
    source: "PLACEHOLDER - replace with GRDC waterlogging guidance",
  },
  denitrification: {
    text: "When soil is waterlogged and oxygen-depleted, nitrate can be converted to gaseous forms and lost (denitrification), so applying nitrogen to saturated soil is inefficient.",
    source: "PLACEHOLDER - replace with N loss pathways reference",
  },
  incorporation: {
    text: "Surface-applied urea needs light rainfall or irrigation of roughly 5 to 15 mm within a few days to move into the soil; without incorporation a share of the nitrogen is lost to the air as ammonia, especially in warm, moist, windy conditions.",
    source: "PLACEHOLDER - replace with urea volatilisation reference",
  },
  leaching: {
    text: "On sandy or duplex soils, heavy rainfall of tens of millimetres shortly after nitrogen application can move nitrate below the root zone, reducing nitrogen available to the crop.",
    source: "PLACEHOLDER - replace with leaching reference",
  },
  herbicide_damage: {
    text: "Crop damage from a soil-applied residual herbicide tends to follow an application pattern such as along spray runs, rather than the low-lying pattern typical of waterlogging.",
    source: "PLACEHOLDER - replace with herbicide crop-safety note",
  },
  yield_potential: {
    text: "In Mediterranean-type environments seasonal yield potential is strongly influenced by in-season and spring rainfall, so a wet start can raise yield potential and nitrogen demand; a good season may justify maintaining rather than cutting planned nitrogen once the timing is corrected.",
    source: "PLACEHOLDER - replace with GRDC seasonal N strategy note",
  },
  delta_t_window: {
    text: "Herbicide application is generally advised within a Delta T range of about 2 to 8 and moderate wind, avoiding temperature inversions that can carry spray off target.",
    source: "PLACEHOLDER - replace with GRDC spray application manual",
  },
  resistance: {
    text: "Repeated use of the same herbicide mode of action selects for resistant weeds; rotating modes of action and using non-chemical tactics preserves effectiveness.",
    source: "PLACEHOLDER - replace with resistance management reference",
  },
};

const HYP_QUERIES = {
  nitrogen_deficiency: ["nitrogen deficiency older leaves yellowing mobile",
                        "urea incorporation rainfall ammonia loss"],
  waterlogging: ["waterlogging yellowing older leaves low lying saturated roots",
                 "denitrification nitrogen loss saturated soil"],
  sulfur_deficiency: ["sulfur deficiency youngest leaves uniform paling immobile"],
  herbicide_damage: ["herbicide residual crop damage spray run pattern"],
  disease: ["root disease bare patches crop"],
  frost: ["frost damage crop"],
  other: ["crop stress yellowing causes"],
};

function tok(s) {
  const counts = new Map();
  for (const t of (s.toLowerCase().match(/[a-z]+/g) || [])) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return counts;
}

function cosine(a, b) {
  let num = 0;
  for (const [t, va] of a) if (b.has(t)) num += va * b.get(t);
  let da = 0; for (const v of a.values()) da += v * v;
  let db = 0; for (const v of b.values()) db += v * v;
  da = Math.sqrt(da); db = Math.sqrt(db);
  return (da && db) ? num / (da * db) : 0;
}

const CORPUS_VECS = Object.entries(CORPUS).map(([cid, c]) => [cid, tok(c.text)]);

function retrieverSearch(query, k = 3) {
  const q = tok(query);
  const scored = CORPUS_VECS.map(([cid, v]) => [cid, cosine(q, v)]);
  scored.sort((a, b) => b[1] - a[1]); // stable: ties keep corpus order
  return scored.slice(0, k).map(([cid]) => cid);
}

function retrieveForHypotheses(causes, kEach = 2) {
  const hits = [];
  for (const cause of causes) {
    for (const query of (HYP_QUERIES[cause] || [cause])) {
      for (const cid of retrieverSearch(query, kEach)) {
        if (!hits.includes(cid)) hits.push(cid);
      }
    }
  }
  return hits;
}

// ------------------------------------------------------------------ signals
function wetBulbStull(tC, rhPct) {
  const rh = Math.max(1.0, Math.min(100.0, rhPct));
  return (tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
          + Math.atan(tC + rh) - Math.atan(rh - 1.676331)
          + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035);
}
function deltaT(tC, rhPct) { return pyRound(tC - wetBulbStull(tC, rhPct), 1); }

function computeSignals(weather, soil, plan) {
  const app = plan.intended_date_offset_days;
  const inRange = (lo, hi) => weather.filter(d => lo <= d.day_offset && d.day_offset <= hi);
  const rain = (lo, hi) => pyRound(inRange(lo, hi).reduce((s, d) => s + d.precip_mm, 0), 1);

  const past7 = rain(-7, -1), past14 = rain(-14, -1);
  const next2 = rain(app, app + 1), next3 = rain(app, app + 2), next7 = rain(app, app + 6);
  const rain72h = rain(app, app + 2);

  const appDay = weather.find(d => d.day_offset === app) || null;
  let saturation;
  if (appDay && appDay.soil_vwc !== null && appDay.soil_vwc !== undefined) {
    saturation = appDay.soil_vwc >= CONFIG.SATURATION_VWC;
  } else {
    saturation = past7 >= 35.0 && soil.internal_drainage === "poor";
  }

  const lightSoil = CONFIG.LEACHING_SOILS.includes(soil.soil_type);
  const leaching = lightSoil && rain72h > CONFIG.LEACHING_RAIN_MM_72H;

  const windows = inRange(app, app + 4)
    .filter(d => CONFIG.INCORP_RAIN_MIN_MM <= d.precip_mm && d.precip_mm <= CONFIG.INCORP_RAIN_MAX_MM)
    .map(d => d.day_offset);

  const warm = inRange(app, app + 2).some(d => d.tmax_c >= CONFIG.VOLAT_TMAX_C);
  const volat = plan.kind === "nitrogen" && next3 < CONFIG.INCORP_RAIN_MIN_MM && warm;
  const denit = saturation;

  let dt = null, windOk = null, inversion = null;
  if (plan.kind === "herbicide" && appDay) {
    dt = deltaT(appDay.tmax_c, appDay.rh_pct);
    windOk = CONFIG.WIND_MIN_KMH <= appDay.wind_kmh && appDay.wind_kmh <= CONFIG.WIND_MAX_KMH;
    inversion = appDay.wind_kmh < CONFIG.WIND_MIN_KMH;
  }

  return {
    past7_rain_mm: past7, past14_rain_mm: past14,
    next2_rain_mm: next2, next3_rain_mm: next3, next7_rain_mm: next7,
    saturation_flag: saturation, leaching_risk: leaching,
    volatilisation_risk: volat, denitrification_risk: denit,
    incorporation_windows: windows,
    delta_t: dt, wind_ok: windOk, inversion_risk: inversion,
  };
}

function costOfError(plan) {
  const ureaCostPerHa = plan.rate_kg_ha * (CONFIG.UREA_PRICE_PER_T / 1000.0);
  return [pyRound(ureaCostPerHa * CONFIG.BAD_TIMING_LOSS_LOW, 1),
          pyRound(ureaCostPerHa * CONFIG.BAD_TIMING_LOSS_HIGH, 1)];
}

// ------------------------------------------------------------------ perception (mock path)
function defaultObservation(notes) {
  return { leaf_position: "unknown", colour_pattern: "unknown", distribution: "unknown",
           vigour: "unknown", waterlogging_cues: false, image_quality: 0.0, notes: notes || "" };
}
function perceive(prior) {
  if (prior !== null && prior !== undefined) return prior;
  return defaultObservation("no image / mock mode; observations entered elsewhere");
}

// ------------------------------------------------------------------ reasoning
const SOURCE = {
  nitrogen_deficiency: "n_symptom", waterlogging: "waterlog_symptom",
  sulfur_deficiency: "s_symptom", herbicide_damage: "herbicide_damage",
  disease: "n_symptom", frost: "n_symptom", other: "n_symptom",
};
const CAUSES = ["nitrogen_deficiency", "waterlogging", "sulfur_deficiency",
                "herbicide_damage", "disease", "frost", "other"];

function heuristicDifferential(obs, sig, inp) {
  const scores = {}, evFor = {}, evAgainst = {};
  for (const c of CAUSES) { scores[c] = 0.0; evFor[c] = []; evAgainst[c] = []; }

  // waterlogging
  if (sig.saturation_flag) { scores.waterlogging += 0.5; evFor.waterlogging.push("soil saturated (probe/model)"); }
  if (obs.distribution === "low_lying" || inp.soil.low_lying_strip) {
    scores.waterlogging += 0.2; evFor.waterlogging.push("symptom in low-lying area");
  }
  if (obs.waterlogging_cues) { scores.waterlogging += 0.15; evFor.waterlogging.push("visible waterlogging cues"); }
  if (sig.past7_rain_mm >= 30 && inp.soil.internal_drainage === "poor") {
    scores.waterlogging += 0.15;
    evFor.waterlogging.push(`${sig.past7_rain_mm.toFixed(0)} mm last 7 d on poorly-drained soil`);
  }
  if ((inp.cases || []).some(c => c.outcome === "resolved" && (c.symptom + c.note).toLowerCase().includes("waterlog"))) {
    scores.waterlogging += 0.1;
    evFor.waterlogging.push("same paddock recovered from waterlogging before (case memory)");
  }

  // nitrogen deficiency
  if (obs.leaf_position === "older" || obs.leaf_position === "all") {
    scores.nitrogen_deficiency += 0.35; evFor.nitrogen_deficiency.push("older-leaf yellowing");
  }
  if (obs.colour_pattern === "uniform_chlorosis") scores.nitrogen_deficiency += 0.1;
  if (sig.saturation_flag) {
    scores.nitrogen_deficiency -= 0.3;
    evAgainst.nitrogen_deficiency.push("saturated soil mimics N deficiency and loses applied N");
  }
  if (obs.leaf_position === "younger") {
    evAgainst.nitrogen_deficiency.push("N deficiency shows on OLDER leaves, not younger");
  }

  // sulfur deficiency
  if (obs.leaf_position === "younger") {
    scores.sulfur_deficiency += 0.5;
    evFor.sulfur_deficiency.push("youngest-leaf paling (S is immobile)");
  }

  // herbicide damage
  if (obs.distribution === "along_lines") {
    scores.herbicide_damage += 0.4; evFor.herbicide_damage.push("damage along spray runs");
  }
  if ((inp.history || []).some(t => t.kind === "herbicide" && (t.moa_group === "B" || t.moa_group === "2"))) {
    scores.herbicide_damage += 0.1;
    evFor.herbicide_damage.push("Group 2 residual in paddock history");
  }

  // disease (weak)
  if (obs.distribution === "patchy" && obs.vigour === "poor" && !sig.saturation_flag) {
    scores.disease += 0.2; evFor.disease.push("patchy poor-vigour zones");
  }

  if ((inp.farmer_note || "").toLowerCase().includes("frost")) {
    scores.frost += 0.4; evFor.frost.push("farmer mentioned frost");
  }

  const pos = {}; for (const c of CAUSES) pos[c] = Math.max(0.0, scores[c]);
  const total = Object.values(pos).reduce((a, b) => a + b, 0) || 1.0;
  let hyps = [];
  for (const c of CAUSES) {
    const lk = pyRound(pos[c] / total, 3);
    if (lk > 0.02) {
      hyps.push({ cause: c, likelihood: lk, evidence_for: evFor[c],
                  evidence_against: evAgainst[c], source: SOURCE[c] });
    }
  }
  if (!hyps.length) {
    hyps = [{ cause: "other", likelihood: 1.0, evidence_for: ["insufficient signal"],
              evidence_against: [], source: SOURCE.other }];
  }
  hyps.sort((a, b) => b.likelihood - a.likelihood); // stable
  return hyps;
}

const diffLeading = hyps => hyps.reduce((m, h) => (h.likelihood > m.likelihood ? h : m), hyps[0]);
const diffMargin = hyps => hyps.length > 1 ? hyps[0].likelihood - hyps[1].likelihood : 1.0;

function reasonWindow(sig) {
  if (sig.incorporation_windows.length) {
    return { start_day_offset: Math.min(...sig.incorporation_windows),
             end_day_offset: Math.max(...sig.incorporation_windows),
             reason: "Light-rain window (5-15 mm) incorporates urea without leaching." };
  }
  return null;
}

function clarifying(hyps) {
  if (diffMargin(hyps) >= 0.15) return null;
  const top2 = hyps.slice(0, 2).map(h => h.cause);
  if (top2.includes("nitrogen_deficiency") && top2.includes("waterlogging"))
    return "Is the yellowing worst in the low-lying part of the paddock, or spread evenly?";
  if (top2.includes("nitrogen_deficiency") && top2.includes("sulfur_deficiency"))
    return "Is the yellowing on the youngest leaves or the oldest leaves?";
  return "Can you confirm where in the paddock the symptom is worst and on which leaves?";
}

function newDecision(fields) {
  return Object.assign({
    call: null, window: null, rate_change: null, zone_exceptions: [], hypotheses: [],
    rationale: [], alternatives: [], cost_of_error_aud_per_ha_low: 0.0,
    cost_of_error_aud_per_ha_high: 0.0, confidence: 0.0, follow_up: null,
    safety_overrides: [], clarifying_question: null,
  }, fields);
}

function heuristicIntervention(hyps, sig, inp) {
  const lead = diffLeading(hyps);
  const [lo, hi] = costOfError(inp.plan);
  const q = clarifying(hyps);
  const conf = pyRound(lead.likelihood * (q ? 0.7 : 1.0), 3);
  const win = reasonWindow(sig);
  const base = { hypotheses: hyps, confidence: conf,
                 cost_of_error_aud_per_ha_low: lo, cost_of_error_aud_per_ha_high: hi,
                 clarifying_question: q };

  if (lead.cause === "waterlogging") {
    return newDecision({ ...base,
      call: "WAIT", window: win,
      zone_exceptions: inp.soil.low_lying_strip
        ? ["Low-lying strip: exclude until probe shows drainage."] : [],
      rationale: ["Symptom most consistent with transient waterlogging, not N shortfall.",
                  "Applying N now risks volatilisation, leaching and denitrification at once.",
                  "Do NOT cut the planned rate: a wet start can raise yield potential; fix TIMING."],
      alternatives: [{ action: "Split application",
                       why: "Apply once soil drains and a 5-15 mm incorporation window appears." }],
      follow_up: { action: "Re-photograph drained area; if still yellow, tissue test for N.", in_days: 7 },
    });
  }

  if (lead.cause === "sulfur_deficiency") {
    return newDecision({ ...base,
      call: "INSPECT",
      rationale: ["Youngest-leaf paling points to sulfur, not nitrogen.",
                  "A urea top-dress would not correct sulfur deficiency."],
      alternatives: [{ action: "Switch product",
                       why: "Consider a sulfur-containing fertiliser; confirm with a tissue test first." }],
      rate_change: "switch to S-containing product",
      follow_up: { action: "Tissue test for S and N to confirm.", in_days: 3 },
    });
  }

  if (lead.cause === "herbicide_damage") {
    return newDecision({ ...base,
      call: "INSPECT",
      rationale: ["Pattern/history suggests residual herbicide effect, not a nutrient issue.",
                  "N will not fix herbicide damage; confirm before spending inputs."],
      follow_up: { action: "Confirm damage pattern vs spray runs; review plant-back.", in_days: 5 },
    });
  }

  if (lead.cause === "disease" || lead.cause === "frost" || lead.cause === "other") {
    return newDecision({ ...base,
      call: "INSPECT",
      rationale: [`Leading hypothesis (${lead.cause}) is not corrected by nitrogen.`,
                  "Inspect before applying to avoid a wasted pass."],
      follow_up: { action: "Ground-truth the cause before any application.", in_days: 3 },
    });
  }

  // nitrogen_deficiency
  if (sig.saturation_flag || sig.leaching_risk) {
    return newDecision({ ...base,
      call: "WAIT", window: win,
      rationale: ["Likely N deficiency, but conditions would lose the N if applied now.",
                  "Wait for a safe incorporation window."],
      follow_up: { action: "Apply in the identified window; verify greening in 7 d.", in_days: 7 },
    });
  }
  if (sig.volatilisation_risk && !sig.incorporation_windows.length) {
    return newDecision({ ...base,
      call: "WAIT", window: win,
      rationale: ["Likely N deficiency, but warm/dry with no incorporating rain -> volatilisation.",
                  "Wait for light rain to move urea in."],
      follow_up: { action: "Apply when 5-15 mm is forecast within a few days.", in_days: 5 },
    });
  }
  return newDecision({ ...base,
    call: "GO", window: win,
    rationale: ["Symptom consistent with N deficiency and conditions favour uptake without loss."],
    alternatives: [{ action: "Delay to a rain window",
                     why: "If you prefer surer incorporation, apply on the next 5-15 mm day." }],
    follow_up: { action: "Verify greening; re-photograph.", in_days: 7 },
  });
}

// ------------------------------------------------------------------ safety
function nextIncorpWindow(sig) {
  if (sig.incorporation_windows.length) {
    return { start_day_offset: Math.min(...sig.incorporation_windows),
             end_day_offset: Math.max(...sig.incorporation_windows),
             reason: "Light rain window incorporates urea without leaching." };
  }
  return null;
}

function bigRateDeviation(rateChange) {
  const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(rateChange);
  if (!m) return false;
  return Math.abs(parseFloat(m[1])) > CONFIG.RATE_DEVIATION_ALLOWED * 100;
}

function applySafety(decision, sig, inp) {
  const overrides = [...decision.safety_overrides];
  const plan = inp.plan;

  const vetoGo = (reason, window) => {
    if (decision.call === "GO") {
      decision.call = window ? "WAIT" : "INSPECT";
      if (window) decision.window = window;
      overrides.push(reason);
    }
  };

  if (plan.kind === "nitrogen") {
    if (sig.saturation_flag) {
      vetoGo("Soil saturated -> denitrification loss; GO blocked.", nextIncorpWindow(sig));
    }
    if (sig.leaching_risk) {
      vetoGo(`>${CONFIG.LEACHING_RAIN_MM_72H.toFixed(0)} mm forecast within 72 h on ` +
             `${inp.soil.soil_type}; leaching risk; GO blocked.`, nextIncorpWindow(sig));
    }
  }

  if (plan.kind === "herbicide") {
    if (sig.wind_ok === false) vetoGo("Wind outside label range; spray blocked.");
    if (sig.delta_t !== null && !(CONFIG.DELTA_T_MIN <= sig.delta_t && sig.delta_t <= CONFIG.DELTA_T_MAX)) {
      vetoGo(`Delta T ${sig.delta_t} outside ${CONFIG.DELTA_T_MIN}-${CONFIG.DELTA_T_MAX}; blocked.`);
    }
    if (sig.inversion_risk) vetoGo("Likely temperature inversion; drift risk; spray blocked.");
  }

  if (decision.rate_change && bigRateDeviation(decision.rate_change)) {
    if (decision.call === "GO") {
      decision.call = "INSPECT";
      overrides.push("Rate change >30% of plan requires human INSPECT sign-off.");
    }
  }

  if (decision.call === "GO" && decision.confidence < CONFIG.CONFIDENCE_GO_MIN) {
    decision.call = "INSPECT";
    overrides.push(`Confidence ${decision.confidence.toFixed(2)} < ` +
                   `${CONFIG.CONFIDENCE_GO_MIN}; downgraded GO -> INSPECT.`);
  }

  if (decision.follow_up === null) {
    decision.follow_up = { action: "Re-photograph and re-check soil moisture; escalate if worse.", in_days: 7 };
  }

  decision.safety_overrides = overrides;
  return decision;
}

function wouldBeUnsafe(call, sig, planKind) {
  if (call !== "GO") return false;
  if (planKind === "nitrogen") return sig.saturation_flag || sig.leaching_risk;
  if (planKind === "herbicide") {
    return (sig.wind_ok === false) || Boolean(sig.inversion_risk) ||
      (sig.delta_t !== null && !(CONFIG.DELTA_T_MIN <= sig.delta_t && sig.delta_t <= CONFIG.DELTA_T_MAX));
  }
  return false;
}

// ------------------------------------------------------------------ pipeline
function runPipeline(inp, opts = {}) {
  const { useRetrieval = true, applySafetyLayer = true, onStage = null } = opts;
  const trace = [];
  const stage = (name, detail) => { trace.push({ stage: name, detail }); if (onStage) onStage(name, detail); };

  const obs = perceive(inp.observation);
  stage("PERCEPTION", `leaf=${obs.leaf_position}, colour=${obs.colour_pattern}, ` +
        `dist=${obs.distribution}, waterlogging_cues=${obs.waterlogging_cues}`);

  const sig = computeSignals(inp.weather, inp.soil, inp.plan);
  stage("SIGNALS", `past7=${sig.past7_rain_mm}mm next3=${sig.next3_rain_mm}mm ` +
        `sat=${sig.saturation_flag} leach=${sig.leaching_risk} ` +
        `volat=${sig.volatilisation_risk} incorp_windows=[${sig.incorporation_windows.join(", ")}]`);

  const candidates = heuristicDifferential(obs, sig, inp).map(h => h.cause);
  const ids = useRetrieval ? retrieveForHypotheses(candidates) : [];
  stage("RETRIEVAL", "retrieved: " + (ids.length ? ids.join(", ") : "(none / ablation)"));

  const hyps = heuristicDifferential(obs, sig, inp);
  let decision = heuristicIntervention(hyps, sig, inp);
  const lead = decision.hypotheses.length ? diffLeading(decision.hypotheses) : null;
  stage("REASONING", `leading=${lead ? lead.cause : "?"} ` +
        `call(pre-safety)=${decision.call} conf=${decision.confidence}`);

  if (applySafetyLayer) {
    const pre = decision.call;
    decision = applySafety(decision, sig, inp);
    stage("SAFETY", `${pre} -> ${decision.call}; overrides: ` +
          (decision.safety_overrides.length ? decision.safety_overrides.join("; ") : "none"));
  } else {
    stage("SAFETY", "skipped (ablation)");
  }

  return { observation: obs, signals: sig, retrieved_ids: ids, decision, trace };
}

// ------------------------------------------------------------------ evaluation harness
function naiveCall(s) {
  const inp = s.input, obs = inp.observation;
  let yellowish = true;
  if (obs !== null && obs !== undefined) {
    yellowish = (obs.colour_pattern === "uniform_chlorosis" || obs.colour_pattern === "interveinal"
                 || obs.vigour === "poor" || obs.leaf_position === "older" || obs.leaf_position === "all");
  }
  const inTiming = 30 <= inp.zadoks_stage && inp.zadoks_stage <= 39;
  return (yellowish && inTiming) ? "GO" : "INSPECT";
}

const pct = (n, d) => d ? pyRound(100.0 * n / d, 1) : 0.0;

function runArm(scenarios, useRetrieval, safety) {
  return scenarios.map(s => {
    const r = runPipeline(s.input, { useRetrieval, applySafetyLayer: safety });
    const lead = r.decision.hypotheses.length ? diffLeading(r.decision.hypotheses).cause : "other";
    return { id: s.id, gold: s.gold, abstain: s.abstain, call: r.decision.call, top: lead,
             conf: r.decision.confidence, sig: r.signals, retrieved: r.retrieved_ids,
             kind: s.input.plan.kind, overrides: r.decision.safety_overrides };
  });
}

function summarise(rows, name, isReasoner = true) {
  const n = rows.length;
  const dec = rows.filter(r => r.call === r.gold.call).length;
  const top = isReasoner ? rows.filter(r => r.top === r.gold.top).length : 0;
  const unsafe = rows.filter(r => wouldBeUnsafe(r.call, r.sig, r.kind)).length;
  const retApps = rows.filter(r => r.gold.must_retrieve.length);
  const retHit = retApps.filter(r => r.gold.must_retrieve.every(cid => r.retrieved.includes(cid))).length;
  const abst = rows.filter(r => r.abstain);
  const abstOk = abst.filter(r => r.call !== "GO").length;
  return { arm: name, n, decision_acc: pct(dec, n),
           top_hyp_acc: isReasoner ? pct(top, n) : null, unsafe_rate: pct(unsafe, n),
           retrieval_hit: isReasoner ? pct(retHit, retApps.length) : null,
           abstain_ok: abst.length ? pct(abstOk, abst.length) : null };
}

function calibration(rows) {
  const buckets = { "<0.55": [], "0.55-0.75": [], ">0.75": [] };
  for (const r of rows) {
    const c = r.conf;
    const b = c < 0.55 ? "<0.55" : (c <= 0.75 ? "0.55-0.75" : ">0.75");
    buckets[b].push(r.call === r.gold.call);
  }
  const out = {};
  for (const [b, v] of Object.entries(buckets)) out[b] = { n: v.length, acc: pct(v.filter(Boolean).length, v.length) };
  return out;
}

function runEval(scenarios) {
  const rulesNosafe = runArm(scenarios, false, false);
  const full = runArm(scenarios, true, true);
  const naive = scenarios.map(s => {
    const r = runPipeline(s.input, { useRetrieval: true, applySafetyLayer: false });
    return { id: s.id, gold: s.gold, abstain: s.abstain, call: naiveCall(s), top: "-",
             conf: 1.0, sig: r.signals, retrieved: [], kind: s.input.plan.kind, overrides: [] };
  });

  const unsafeReasoner = full.filter(r => wouldBeUnsafe(r.call, r.sig, r.kind)).length;
  const naiveUnsafeBefore = naive.filter(r => wouldBeUnsafe(r.call, r.sig, r.kind)).length;
  let naiveAfter = 0;
  naive.forEach((r, i) => {
    const d = applySafety(newDecision({ call: r.call, confidence: 1.0 }), r.sig, scenarios[i].input);
    if (wouldBeUnsafe(d.call, r.sig, r.kind)) naiveAfter += 1;
  });

  // consistency: 3 identical runs (deterministic, but measured honestly)
  const callsById = new Map();
  for (let k = 0; k < 3; k++) {
    for (const r of runArm(scenarios, true, true)) {
      if (!callsById.has(r.id)) callsById.set(r.id, new Set());
      callsById.get(r.id).add(r.call);
    }
  }
  const consistency = pct([...callsById.values()].filter(v => v.size === 1).length, callsById.size);

  return {
    arms: [summarise(naive, "naive_threshold", false),
           summarise(rulesNosafe, "rules_only (no retrieval, no safety)"),
           summarise(full, "greenlight (full)")],
    reasoner_unsafe_rate: pct(unsafeReasoner, scenarios.length),
    safety_demo_naive_unsafe_before: pct(naiveUnsafeBefore, scenarios.length),
    safety_demo_naive_unsafe_after: pct(naiveAfter, scenarios.length),
    calibration_full: calibration(full),
    consistency_full: consistency,
    provider: "deterministic (in-browser)",
    detail: full.map(r => ({ id: r.id, call: r.call, gold: r.gold.call, top: r.top,
                             gold_top: r.gold.top, conf: r.conf, ok: r.call === r.gold.call })),
  };
}

const GreenlightEngine = {
  CONFIG, CORPUS, HYP_QUERIES, computeSignals, costOfError, heuristicDifferential,
  heuristicIntervention, applySafety, wouldBeUnsafe, runPipeline, runEval, naiveCall,
  retrieveForHypotheses, deltaT, pyRound,
};
if (typeof module !== "undefined") module.exports = GreenlightEngine;
