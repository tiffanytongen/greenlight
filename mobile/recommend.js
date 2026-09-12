/* Decision → the worker-facing bits: one-sentence explanation, recommended
   action, timing window, and a schedulable payload. Uses what the engine
   already computed (window, follow_up, leading cause) — no new judgement. */

const cap = s => String(s).replace(/_/g, " ");

export function leadCause(decision) {
  if (!decision.hypotheses || !decision.hypotheses.length) return "other";
  return decision.hypotheses.reduce((m, h) => (h.likelihood > m.likelihood ? h : m),
    decision.hypotheses[0]).cause;
}

/* One plain sentence for the banner. */
export function explain(decision) {
  const cause = leadCause(decision);
  switch (decision.call) {
    case "GO":
      return "Crop wants nitrogen and the weather won't steal it.";
    case "WAIT":
      if (cause === "waterlogging") return "Looks waterlogged, not hungry — spreading now would be wasted.";
      if (decision.safety_overrides.length) return "Conditions would lose the nitrogen — the safety rules blocked it.";
      return "Right call, wrong day — the weather would take most of it.";
    case "SWITCH":
      return "Urea won't fix this — it doesn't look like a nitrogen problem.";
    case "INSPECT":
      if (cause === "sulfur_deficiency") return "New-leaf paling points to sulfur, not nitrogen — check before spending.";
      if (cause === "herbicide_damage") return "The pattern follows spray lines — check for chemical damage first.";
      return "Not clear enough to spend money on — look closer first.";
    default:
      return "";
  }
}

function dayLabel(off) {
  if (off <= 0) return "today";
  if (off === 1) return "tomorrow";
  return `in ${off} days`;
}

/* Recommended next action + timing + a schedulable entry. */
export function recommend(decision, paddockName) {
  const w = decision.window;
  const fu = decision.follow_up;
  const cause = leadCause(decision);

  if (decision.call === "GO") {
    const start = w ? Math.max(0, w.start_day_offset) : 0;
    const timing = `${dayLabel(start)}, 7–11 AM` +
      (w && w.end_day_offset > start ? ` (window open to day +${w.end_day_offset})` : "");
    return {
      action: "Apply urea as planned",
      timing,
      schedule: { kind: "apply", title: `Apply urea — ${paddockName}`, dueOffsetDays: start, hour: 7 },
    };
  }
  if (decision.call === "WAIT") {
    if (w && w.start_day_offset >= 0) {
      return {
        action: "Hold the spreader. Apply in the rain window",
        timing: `${dayLabel(w.start_day_offset)}${w.end_day_offset > w.start_day_offset ? `–day +${w.end_day_offset}` : ""}, 7–11 AM`,
        schedule: { kind: "apply", title: `Apply urea in window — ${paddockName}`, dueOffsetDays: w.start_day_offset, hour: 7 },
      };
    }
    const days = fu ? fu.in_days : 2;
    return {
      action: cause === "waterlogging" ? "Hold off. Recheck once it drains" : "Hold off. Recheck soon",
      timing: `${dayLabel(Math.min(days, 7))}, morning`,
      schedule: { kind: "recheck", title: `Recheck — ${paddockName}`, dueOffsetDays: days, hour: 7 },
    };
  }
  if (decision.call === "SWITCH") {
    return {
      action: "Line up the right product; confirm with a tissue test",
      timing: fu ? `${dayLabel(fu.in_days)}` : "this week",
      schedule: { kind: "inspect", title: `Tissue test — ${paddockName}`, dueOffsetDays: fu ? fu.in_days : 3, hour: 8 },
    };
  }
  // INSPECT
  return {
    action: fu ? fu.action : "Walk the paddock and confirm what it is",
    timing: fu ? dayLabel(Math.min(fu.in_days, 7)) : "today",
    schedule: { kind: "inspect", title: `Inspect — ${paddockName}`, dueOffsetDays: fu ? fu.in_days : 1, hour: 8 },
  };
}

export function dueTimestamp(dueOffsetDays, hour) {
  const d = new Date();
  d.setDate(d.getDate() + dueOffsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export { cap };
