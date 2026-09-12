"""Deterministic derived signals. PURE functions, no LLM, fully unit-tested.
This module is half the 'AI can be overruled by rules' story and the whole reason
the safety layer can be trusted. If a number here is wrong the whole system is
wrong, so this is the code to test hardest."""
from __future__ import annotations
import math
from typing import List, Optional
from .schemas import WeatherDay, SoilRecord, PlannedAction, DerivedSignals
from . import config


def _by_offset(days: List[WeatherDay], lo: int, hi: int) -> List[WeatherDay]:
    return [d for d in days if lo <= d.day_offset <= hi]


def _rain(days: List[WeatherDay], lo: int, hi: int) -> float:
    return round(sum(d.precip_mm for d in _by_offset(days, lo, hi)), 1)


def wet_bulb_stull(t_c: float, rh_pct: float) -> float:
    """Stull (2011) wet-bulb approximation. Valid for typical spraying conditions."""
    rh = max(1.0, min(100.0, rh_pct))
    tw = (t_c * math.atan(0.151977 * math.sqrt(rh + 8.313659))
          + math.atan(t_c + rh) - math.atan(rh - 1.676331)
          + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh) - 4.686035)
    return tw


def delta_t(t_c: float, rh_pct: float) -> float:
    return round(t_c - wet_bulb_stull(t_c, rh_pct), 1)


def compute_signals(weather: List[WeatherDay], soil: SoilRecord,
                    plan: PlannedAction) -> DerivedSignals:
    app = plan.intended_date_offset_days  # day the input would go on

    past7 = _rain(weather, -7, -1)
    past14 = _rain(weather, -14, -1)
    next2 = _rain(weather, app, app + 1)
    next3 = _rain(weather, app, app + 2)
    next7 = _rain(weather, app, app + 6)
    rain_72h = _rain(weather, app, app + 2)  # ~72h from application

    # --- saturation: prefer modelled/probe VWC on the application day ---
    app_day = next((d for d in weather if d.day_offset == app), None)
    if app_day and app_day.soil_vwc is not None:
        saturation = app_day.soil_vwc >= config.SATURATION_VWC
    else:  # fallback: heavy recent rain + poor drainage
        saturation = past7 >= 35.0 and soil.internal_drainage == "poor"

    light_soil = soil.soil_type in config.LEACHING_SOILS
    leaching = light_soil and rain_72h > config.LEACHING_RAIN_MM_72H

    # --- incorporation windows: forecast days (app .. app+4) with 5-15 mm ---
    windows = [d.day_offset for d in _by_offset(weather, app, app + 4)
               if config.INCORP_RAIN_MIN_MM <= d.precip_mm <= config.INCORP_RAIN_MAX_MM]

    # --- volatilisation: surface urea, no incorporating rain soon, warm ---
    warm = any(d.tmax_c >= config.VOLAT_TMAX_C for d in _by_offset(weather, app, app + 2))
    volat = (plan.kind == "nitrogen" and next3 < config.INCORP_RAIN_MIN_MM and warm)

    denit = saturation

    # --- herbicide-only signals ---
    dt = wind_ok = inversion = None
    if plan.kind == "herbicide" and app_day:
        dt = delta_t(app_day.tmax_c, app_day.rh_pct)
        wind_ok = config.WIND_MIN_KMH <= app_day.wind_kmh <= config.WIND_MAX_KMH
        # crude inversion proxy: very light wind + low overnight mixing (use low wind)
        inversion = app_day.wind_kmh < config.WIND_MIN_KMH

    return DerivedSignals(
        past7_rain_mm=past7, past14_rain_mm=past14,
        next2_rain_mm=next2, next3_rain_mm=next3, next7_rain_mm=next7,
        saturation_flag=saturation, leaching_risk=leaching,
        volatilisation_risk=volat, denitrification_risk=denit,
        incorporation_windows=windows,
        delta_t=dt, wind_ok=wind_ok, inversion_risk=inversion,
    )


def cost_of_error(plan: PlannedAction) -> tuple[float, float]:
    """Product $ at risk per ha if applied into a bad-timing window.
    [demo estimate] — shown as a range, clearly labelled in the UI/pitch."""
    urea_cost_per_ha = plan.rate_kg_ha * (config.UREA_PRICE_PER_T / 1000.0)
    return (round(urea_cost_per_ha * config.BAD_TIMING_LOSS_LOW, 1),
            round(urea_cost_per_ha * config.BAD_TIMING_LOSS_HIGH, 1))
