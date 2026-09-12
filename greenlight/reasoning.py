"""Two-stage reasoning.
  Stage 1 (differential): observation + signals + retrieved text -> ranked causes.
  Stage 2 (intervention): leading cause + plan + signals -> GO/WAIT/SWITCH/INSPECT.

Two interchangeable engines behind one `reason()`:
  - heuristic: deterministic, no LLM. Doubles as the ABLATION 'rules-only' arm and
    the offline demo path.
  - llm: prompts a vision/text model for each stage, Pydantic-validated; on any
    failure it falls back to the heuristic so the pipeline never crashes.

The safety layer (safety.apply_safety) runs AFTER this in the pipeline, so nothing
here needs to enforce hard vetoes — keep the concerns separate."""
from __future__ import annotations
import json
from typing import List, Optional
from .schemas import (Observation, DerivedSignals, GreenlightInput, Differential,
                      Hypothesis, Decision, Call, Window, Alternative, FollowUp)
from .retrieval import Retriever, CORPUS
from .signals import cost_of_error
from . import llm, config


# primary supporting chunk per cause (for the 'source' field / demo)
SOURCE = {
    "nitrogen_deficiency": "n_symptom", "waterlogging": "waterlog_symptom",
    "sulfur_deficiency": "s_symptom", "herbicide_damage": "herbicide_damage",
    "disease": "n_symptom", "frost": "n_symptom", "other": "n_symptom",
}


# ============================================================ HEURISTIC (Stage 1)
def heuristic_differential(obs: Observation, sig: DerivedSignals,
                           inp: GreenlightInput) -> Differential:
    scores = {c: 0.0 for c in
              ["nitrogen_deficiency", "waterlogging", "sulfur_deficiency",
               "herbicide_damage", "disease", "frost", "other"]}
    ev_for = {c: [] for c in scores}
    ev_against = {c: [] for c in scores}

    # waterlogging
    if sig.saturation_flag:
        scores["waterlogging"] += 0.5; ev_for["waterlogging"].append("soil saturated (probe/model)")
    if obs.distribution == "low_lying" or inp.soil.low_lying_strip:
        scores["waterlogging"] += 0.2; ev_for["waterlogging"].append("symptom in low-lying area")
    if obs.waterlogging_cues:
        scores["waterlogging"] += 0.15; ev_for["waterlogging"].append("visible waterlogging cues")
    if sig.past7_rain_mm >= 30 and inp.soil.internal_drainage == "poor":
        scores["waterlogging"] += 0.15
        ev_for["waterlogging"].append(f"{sig.past7_rain_mm:.0f} mm last 7 d on poorly-drained soil")
    if any(c.outcome == "resolved" and "waterlog" in (c.symptom + c.note).lower() for c in inp.cases):
        scores["waterlogging"] += 0.1
        ev_for["waterlogging"].append("same paddock recovered from waterlogging before (case memory)")

    # nitrogen deficiency
    if obs.leaf_position in ("older", "all"):
        scores["nitrogen_deficiency"] += 0.35; ev_for["nitrogen_deficiency"].append("older-leaf yellowing")
    if obs.colour_pattern == "uniform_chlorosis":
        scores["nitrogen_deficiency"] += 0.1
    if sig.saturation_flag:
        scores["nitrogen_deficiency"] -= 0.3
        ev_against["nitrogen_deficiency"].append("saturated soil mimics N deficiency and loses applied N")
    if obs.leaf_position == "younger":
        ev_against["nitrogen_deficiency"].append("N deficiency shows on OLDER leaves, not younger")

    # sulfur deficiency
    if obs.leaf_position == "younger":
        scores["sulfur_deficiency"] += 0.5
        ev_for["sulfur_deficiency"].append("youngest-leaf paling (S is immobile)")

    # herbicide damage
    if obs.distribution == "along_lines":
        scores["herbicide_damage"] += 0.4; ev_for["herbicide_damage"].append("damage along spray runs")
    if any(t.kind == "herbicide" and (t.moa_group in ("B", "2")) for t in inp.history):
        scores["herbicide_damage"] += 0.1
        ev_for["herbicide_damage"].append("Group 2 residual in paddock history")

    # disease (weak)
    if obs.distribution == "patchy" and obs.vigour == "poor" and not sig.saturation_flag:
        scores["disease"] += 0.2; ev_for["disease"].append("patchy poor-vigour zones")

    if "frost" in inp.farmer_note.lower():
        scores["frost"] += 0.4; ev_for["frost"].append("farmer mentioned frost")

    # normalise positives
    pos = {c: max(0.0, s) for c, s in scores.items()}
    total = sum(pos.values()) or 1.0
    hyps = []
    for c, s in pos.items():
        lk = round(s / total, 3)
        if lk > 0.02:
            hyps.append(Hypothesis(cause=c, likelihood=lk, evidence_for=ev_for[c],
                                   evidence_against=ev_against[c], source=SOURCE[c]))
    if not hyps:
        hyps = [Hypothesis(cause="other", likelihood=1.0,
                           evidence_for=["insufficient signal"], source=SOURCE["other"])]
    hyps.sort(key=lambda h: h.likelihood, reverse=True)
    return Differential(hypotheses=hyps)


# ============================================================ HEURISTIC (Stage 2)
def _window(sig: DerivedSignals) -> Optional[Window]:
    if sig.incorporation_windows:
        return Window(start_day_offset=min(sig.incorporation_windows),
                      end_day_offset=max(sig.incorporation_windows),
                      reason="Light-rain window (5-15 mm) incorporates urea without leaching.")
    return None


def _clarifying(diff: Differential) -> Optional[str]:
    if diff.margin >= 0.15:
        return None
    top2 = {h.cause for h in sorted(diff.hypotheses, key=lambda h: h.likelihood, reverse=True)[:2]}
    if {"nitrogen_deficiency", "waterlogging"} <= top2:
        return "Is the yellowing worst in the low-lying part of the paddock, or spread evenly?"
    if {"nitrogen_deficiency", "sulfur_deficiency"} <= top2:
        return "Is the yellowing on the youngest leaves or the oldest leaves?"
    return "Can you confirm where in the paddock the symptom is worst and on which leaves?"


def heuristic_intervention(diff: Differential, sig: DerivedSignals,
                           inp: GreenlightInput) -> Decision:
    lead = diff.leading
    lo, hi = cost_of_error(inp.plan)
    q = _clarifying(diff)
    conf = round(lead.likelihood * (0.7 if q else 1.0), 3)
    win = _window(sig)
    base = dict(hypotheses=diff.hypotheses, confidence=conf,
                cost_of_error_aud_per_ha_low=lo, cost_of_error_aud_per_ha_high=hi,
                clarifying_question=q)

    if lead.cause == "waterlogging":
        return Decision(
            call=Call.WAIT, window=win,
            zone_exceptions=(["Low-lying strip: exclude until probe shows drainage."]
                             if inp.soil.low_lying_strip else []),
            rationale=["Symptom most consistent with transient waterlogging, not N shortfall.",
                       "Applying N now risks volatilisation, leaching and denitrification at once.",
                       "Do NOT cut the planned rate: a wet start can raise yield potential; fix TIMING."],
            alternatives=[Alternative(action="Split application", why="Apply once soil drains and a "
                                      "5-15 mm incorporation window appears.")],
            follow_up=FollowUp(action="Re-photograph drained area; if still yellow, tissue test for N.",
                               in_days=7),
            **base)

    if lead.cause == "sulfur_deficiency":
        return Decision(
            call=Call.INSPECT,
            rationale=["Youngest-leaf paling points to sulfur, not nitrogen.",
                       "A urea top-dress would not correct sulfur deficiency."],
            alternatives=[Alternative(action="Switch product", why="Consider a sulfur-containing "
                                      "fertiliser; confirm with a tissue test first.")],
            rate_change="switch to S-containing product",
            follow_up=FollowUp(action="Tissue test for S and N to confirm.", in_days=3), **base)

    if lead.cause == "herbicide_damage":
        return Decision(
            call=Call.INSPECT,
            rationale=["Pattern/history suggests residual herbicide effect, not a nutrient issue.",
                       "N will not fix herbicide damage; confirm before spending inputs."],
            follow_up=FollowUp(action="Confirm damage pattern vs spray runs; review plant-back.",
                               in_days=5), **base)

    if lead.cause in ("disease", "frost", "other"):
        return Decision(
            call=Call.INSPECT,
            rationale=[f"Leading hypothesis ({lead.cause}) is not corrected by nitrogen.",
                       "Inspect before applying to avoid a wasted pass."],
            follow_up=FollowUp(action="Ground-truth the cause before any application.", in_days=3),
            **base)

    # nitrogen_deficiency
    if sig.saturation_flag or sig.leaching_risk:
        return Decision(
            call=Call.WAIT, window=win,
            rationale=["Likely N deficiency, but conditions would lose the N if applied now.",
                       "Wait for a safe incorporation window."],
            follow_up=FollowUp(action="Apply in the identified window; verify greening in 7 d.",
                               in_days=7), **base)
    if sig.volatilisation_risk and not sig.incorporation_windows:
        return Decision(
            call=Call.WAIT, window=win,
            rationale=["Likely N deficiency, but warm/dry with no incorporating rain -> volatilisation.",
                       "Wait for light rain to move urea in."],
            follow_up=FollowUp(action="Apply when 5-15 mm is forecast within a few days.", in_days=5),
            **base)
    return Decision(
        call=Call.GO, window=win,
        rationale=["Symptom consistent with N deficiency and conditions favour uptake without loss."],
        alternatives=[Alternative(action="Delay to a rain window", why="If you prefer surer "
                                  "incorporation, apply on the next 5-15 mm day.")],
        follow_up=FollowUp(action="Verify greening; re-photograph.", in_days=7), **base)


# ============================================================ LLM path
DIFF_SYSTEM = (
    "You are an agronomy differential-diagnosis engine for Australian broadacre cropping. "
    "Given crop observations, derived weather signals, paddock history and retrieved guideline "
    "text, output a ranked differential as strict JSON matching: "
    '{"hypotheses":[{"cause": one of '
    "[nitrogen_deficiency,waterlogging,sulfur_deficiency,herbicide_damage,disease,frost,other], "
    '"likelihood":0-1 (sum ~1),"evidence_for":[...],"evidence_against":[...],"source":"chunk id"}]}. '
    "Use the guideline text to justify AND to reject hypotheses (e.g. sulfur shows on YOUNG leaves)."
)
INTV_SYSTEM = (
    "You are an input-decision engine. Given the leading cause, the planned application, and the "
    "derived weather signals, choose exactly one call and output strict JSON matching the Decision "
    "schema (call GO|WAIT|SWITCH|INSPECT, window, rate_change, zone_exceptions, rationale[], "
    "alternatives[], confidence 0-1, follow_up). Prefer WAIT to a specific window over GO when the "
    "input would be lost. Do NOT cut the N rate merely because the season is wet - fix timing. "
    "Do not enforce hard safety rules; a separate layer does that."
)


def _ctx(obs, sig, inp, retriever, ids):
    return (f"OBSERVATION: {obs.model_dump()}\n"
            f"SIGNALS: {sig.model_dump()}\n"
            f"CROP: {inp.crop} Zadoks {inp.zadoks_stage}; SOIL: {inp.soil.model_dump()}\n"
            f"PLAN: {inp.plan.model_dump()}\n"
            f"HISTORY: {[t.model_dump() for t in inp.history]}\n"
            f"CASES: {[c.model_dump() for c in inp.cases]}\n"
            f"FARMER_NOTE: {inp.farmer_note!r}\n"
            f"RETRIEVED GUIDELINES:\n{retriever.render(ids)}")


def llm_reason(obs, sig, inp, retriever, ids) -> Decision:
    ctx = _ctx(obs, sig, inp, retriever, ids)
    diff = llm.complete_json(DIFF_SYSTEM, ctx, Differential)
    lead = diff.leading
    lo, hi = cost_of_error(inp.plan)
    intv_ctx = (f"LEADING CAUSE: {lead.cause} (p={lead.likelihood})\n"
                f"PLAN: {inp.plan.model_dump()}\nSIGNALS: {sig.model_dump()}\n"
                f"cost_of_error range AUD/ha: {lo}-{hi}. Include it in the decision.")
    dec = llm.complete_json(INTV_SYSTEM, intv_ctx, Decision)
    dec.hypotheses = diff.hypotheses
    dec.cost_of_error_aud_per_ha_low = lo
    dec.cost_of_error_aud_per_ha_high = hi
    if not dec.confidence:
        dec.confidence = lead.likelihood
    return dec


# ============================================================ unified entry
def reason(obs: Observation, sig: DerivedSignals, inp: GreenlightInput,
           retriever: Retriever, ids: List[str], mode: str = "heuristic",
           use_retrieval: bool = True) -> Decision:
    """mode: 'heuristic' | 'llm'. use_retrieval False => ablation arm (a)."""
    if mode == "llm":
        try:
            return llm_reason(obs, sig, inp, retriever, ids if use_retrieval else [])
        except Exception:
            pass  # fall through to heuristic — never crash the demo
    diff = heuristic_differential(obs, sig, inp)
    return heuristic_intervention(diff, sig, inp)
