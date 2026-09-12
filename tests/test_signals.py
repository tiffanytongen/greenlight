"""Test the deterministic core hardest — if signals/safety are wrong, everything is.
Run: pytest -q"""
from greenlight.schemas import SoilRecord, PlannedAction, Decision, Call, DerivedSignals, GreenlightInput
from greenlight.signals import compute_signals, delta_t, cost_of_error
from greenlight.safety import apply_safety, would_be_unsafe
from greenlight.weather import synthetic_series
from greenlight import config


def _wx(past7, fut, tmax=18, app_vwc=None, wind=8, rh=60):
    past = [{"precip_mm": 0} for _ in range(7)]
    for off in range(-7, 0):
        past.append({"precip_mm": past7 if off == -3 else 0.0, "tmax_c": tmax, "wind_kmh": wind, "rh_pct": rh})
    fut2 = []
    for i, mm in enumerate(fut):
        d = {"precip_mm": mm, "tmax_c": tmax, "wind_kmh": wind, "rh_pct": rh}
        if i == 0 and app_vwc is not None:
            d["soil_vwc"] = app_vwc
        fut2.append(d)
    return synthetic_series(past, fut2)


def test_saturation_from_vwc():
    s = compute_signals(_wx(10, [0, 0, 0], app_vwc=0.46), SoilRecord(), PlannedAction())
    assert s.saturation_flag and s.denitrification_risk


def test_saturation_fallback_no_probe():
    soil = SoilRecord(soil_type="duplex", internal_drainage="poor")
    s = compute_signals(_wx(40, [0, 0, 0]), soil, PlannedAction())
    assert s.saturation_flag  # heavy recent rain + poor drainage


def test_leaching_only_on_light_soil():
    light = compute_signals(_wx(5, [0, 40, 0], app_vwc=0.2),
                            SoilRecord(soil_type="sandy_loam"), PlannedAction())
    clay = compute_signals(_wx(5, [0, 40, 0], app_vwc=0.2),
                           SoilRecord(soil_type="clay_loam"), PlannedAction())
    assert light.leaching_risk and not clay.leaching_risk


def test_incorporation_window_detected():
    s = compute_signals(_wx(5, [0, 8, 0], app_vwc=0.2), SoilRecord(), PlannedAction())
    assert 1 in s.incorporation_windows


def test_volatilisation_warm_dry():
    s = compute_signals(_wx(5, [0, 0, 0], tmax=26, app_vwc=0.2),
                        SoilRecord(soil_type="sandy_loam"), PlannedAction())
    assert s.volatilisation_risk


def test_no_volatilisation_when_cool():
    s = compute_signals(_wx(5, [0, 0, 0], tmax=14, app_vwc=0.2),
                        SoilRecord(soil_type="sandy_loam"), PlannedAction())
    assert not s.volatilisation_risk


def test_delta_t_reasonable():
    # warm dry air -> larger delta T than cool humid
    assert delta_t(30, 20) > delta_t(15, 90)


def test_cost_of_error_range():
    lo, hi = cost_of_error(PlannedAction(rate_kg_ha=130))
    assert 0 < lo < hi


def _inp(soil):
    return GreenlightInput(paddock="t", soil=soil)


def test_safety_blocks_go_on_saturation():
    sig = DerivedSignals(saturation_flag=True, denitrification_risk=True)
    d = Decision(call=Call.GO, confidence=0.9)
    d = apply_safety(d, sig, _inp(SoilRecord()))
    assert d.call != Call.GO and d.safety_overrides


def test_safety_blocks_go_on_leaching():
    sig = DerivedSignals(leaching_risk=True)
    d = Decision(call=Call.GO, confidence=0.9)
    d = apply_safety(d, sig, _inp(SoilRecord(soil_type="sandy_loam")))
    assert d.call != Call.GO


def test_confidence_gate():
    sig = DerivedSignals()
    d = Decision(call=Call.GO, confidence=0.4)
    d = apply_safety(d, sig, _inp(SoilRecord()))
    assert d.call == Call.INSPECT


def test_go_survives_when_safe_and_confident():
    sig = DerivedSignals(incorporation_windows=[1])
    d = Decision(call=Call.GO, confidence=0.8)
    d = apply_safety(d, sig, _inp(SoilRecord()))
    assert d.call == Call.GO


def test_would_be_unsafe():
    assert would_be_unsafe(Call.GO, DerivedSignals(saturation_flag=True), "nitrogen")
    assert not would_be_unsafe(Call.WAIT, DerivedSignals(saturation_flag=True), "nitrogen")
