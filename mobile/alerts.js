/* Alert engine. Re-runs the deterministic engine against current weather and
   compares with what's stored. Pure function: returns NEW alerts only.

   Covers: treatment window opening, weather invalidating a scheduled apply,
   scheduled work due, and a changed recommendation. */
const E = require("./engine.js");

const dayKey = ts => new Date(ts).toISOString().slice(0, 10);

export function evaluateAlerts(state, weatherDays) {
  const now = Date.now();
  const out = [];
  const seen = new Set(state.alerts.map(a => `${a.type}|${a.paddockId}|${a.dayKey}`));
  const push = (type, paddockId, message) => {
    const k = `${type}|${paddockId}|${dayKey(now)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ id: `${type}-${paddockId}-${now}-${out.length}`, ts: now, dayKey: dayKey(now),
               paddockId, type, message, read: false });
  };
  const paddockById = {}; state.paddocks.forEach(p => { paddockById[p.id] = p; });

  // 1 + 2: scheduled work due / weather turning against a scheduled apply
  for (const a of state.actions) {
    if (a.status !== "scheduled") continue;
    const p = paddockById[a.paddockId]; if (!p) continue;
    if (a.due <= now) {
      push("due", a.paddockId, `${a.title} — due now.`);
    }
    if (a.kind === "apply") {
      const sig = E.computeSignals(weatherDays, p.soil,
        { kind: "nitrogen", product: "urea", rate_kg_ha: 130, n_rate_kg_ha: 60, intended_date_offset_days: 0 });
      if (E.wouldBeUnsafe("GO", sig, "nitrogen")) {
        push("weather", a.paddockId,
          `Weather has turned on ${p.name} — the planned application would lose nitrogen. Hold and recheck.`);
      }
    }
  }

  // 3 + 4: latest check per paddock — did the recommendation change / window open?
  const latest = {};
  for (const c of state.checks) if (!latest[c.paddockId]) latest[c.paddockId] = c;
  for (const c of Object.values(latest)) {
    const p = paddockById[c.paddockId]; if (!p || !c.decision) continue;
    const inp = {
      paddock: p.name, crop: "wheat", zadoks_stage: c.zadoks || 31, soil: p.soil,
      plan: { kind: "nitrogen", product: "urea", rate_kg_ha: 130, n_rate_kg_ha: 60, intended_date_offset_days: 0 },
      observation: c.observation, farmer_note: "", history: [], cases: [], weather: weatherDays,
    };
    const res = E.runPipeline(inp, { useRetrieval: true, applySafetyLayer: true });
    // window opening: was held back by wet soil, now drained with a soak coming
    if (c.decision.call === "WAIT" && c.signals && c.signals.saturation_flag &&
        !res.signals.saturation_flag && res.signals.incorporation_windows.length) {
      push("window", c.paddockId,
        `${p.name} has drained and a light-rain window is coming — recheck now, likely good to apply.`);
    }
    const was = c.decision.call, is = res.decision.call;
    if (was !== is) {
      if (was === "WAIT" && is === "GO") {
        const w = res.decision.window;
        push("window", c.paddockId,
          `${p.name} has come good — Greenlight now says GO` +
          (w ? ` (rain window day ${w.start_day_offset}–${w.end_day_offset})` : "") + ".");
      } else {
        push("changed", c.paddockId,
          `${p.name}: recommendation changed ${was} → ${is}. Worth a fresh check.`);
      }
    }
  }
  return out;
}
