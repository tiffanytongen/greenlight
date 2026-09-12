"""Deterministic guardrails that run AFTER the LLM and can overrule it. This is
the liability story and a top judging beat: show 'Safety rule X overrode the
model' on screen. Every override is recorded on the Decision so the UI can
surface it and the eval can measure unsafe-rate before/after."""
from __future__ import annotations
from typing import Tuple
from .schemas import Decision, Call, DerivedSignals, GreenlightInput, Window, FollowUp
from . import config


def apply_safety(decision: Decision, sig: DerivedSignals,
                 inp: GreenlightInput) -> Decision:
    overrides = list(decision.safety_overrides)
    plan = inp.plan

    def veto_go(reason: str, window: Window | None = None):
        nonlocal decision
        if decision.call == Call.GO:
            decision.call = Call.WAIT if window else Call.INSPECT
            if window:
                decision.window = window
            overrides.append(reason)

    if plan.kind == "nitrogen":
        # 1. never GO onto saturated / waterlogged soil (denitrification)
        if sig.saturation_flag:
            w = _next_incorp_window(sig)
            veto_go("Soil saturated -> denitrification loss; GO blocked.", w)
        # 2. never GO if heavy rain within 72h on light/duplex soils (leaching)
        if sig.leaching_risk:
            w = _next_incorp_window(sig)
            veto_go(f">{config.LEACHING_RAIN_MM_72H:.0f} mm forecast within 72 h on "
                    f"{inp.soil.soil_type}; leaching risk; GO blocked.", w)

    if plan.kind == "herbicide":
        if sig.wind_ok is False:
            veto_go("Wind outside label range; spray blocked.")
        if sig.delta_t is not None and not (config.DELTA_T_MIN <= sig.delta_t <= config.DELTA_T_MAX):
            veto_go(f"Delta T {sig.delta_t} outside {config.DELTA_T_MIN}-{config.DELTA_T_MAX}; blocked.")
        if sig.inversion_risk:
            veto_go("Likely temperature inversion; drift risk; spray blocked.")

    # 3. rate deviation beyond +-30% of plan requires INSPECT sign-off
    if decision.rate_change and _big_rate_deviation(decision.rate_change):
        if decision.call == Call.GO:
            decision.call = Call.INSPECT
            overrides.append("Rate change >30% of plan requires human INSPECT sign-off.")

    # 4. confidence gating: no GO below threshold
    if decision.call == Call.GO and decision.confidence < config.CONFIDENCE_GO_MIN:
        decision.call = Call.INSPECT
        overrides.append(f"Confidence {decision.confidence:.2f} < "
                         f"{config.CONFIDENCE_GO_MIN}; downgraded GO -> INSPECT.")

    # ensure a follow-up always exists
    if decision.follow_up is None:
        decision.follow_up = FollowUp(
            action="Re-photograph and re-check soil moisture; escalate if worse.", in_days=7)

    decision.safety_overrides = overrides
    return decision


def _next_incorp_window(sig: DerivedSignals) -> Window | None:
    if sig.incorporation_windows:
        s = min(sig.incorporation_windows)
        e = max(sig.incorporation_windows)
        return Window(start_day_offset=s, end_day_offset=e,
                      reason="Light rain window incorporates urea without leaching.")
    return None


def _big_rate_deviation(rate_change: str) -> bool:
    # rate_change is free text like "-40%"; parse a leading signed percentage if present
    import re
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", rate_change)
    if not m:
        return False
    return abs(float(m.group(1))) > config.RATE_DEVIATION_ALLOWED * 100


def would_be_unsafe(call: Call, sig: DerivedSignals, plan_kind: str) -> bool:
    """Used by eval: is issuing this call unsafe GIVEN the signals? (pre-safety check)"""
    if call != Call.GO:
        return False
    if plan_kind == "nitrogen":
        return sig.saturation_flag or sig.leaching_risk
    if plan_kind == "herbicide":
        return (sig.wind_ok is False) or bool(sig.inversion_risk) or (
            sig.delta_t is not None and not (config.DELTA_T_MIN <= sig.delta_t <= config.DELTA_T_MAX))
    return False
