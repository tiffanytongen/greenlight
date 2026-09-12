"""Weather = the demo's proof it isn't hardcoded. Real path uses Open-Meteo
(free, no key: forecast + archive + modelled soil moisture). Synthetic path lets
scenarios/seed build deterministic daily series that tell a specific story.

IMPORTANT for the pitch: Open-Meteo's modelled soil moisture is our stand-in for a
probe where none exists — say that honestly; a real probe feed slots into the same
WeatherDay.soil_vwc field."""
from __future__ import annotations
import json
import os
from typing import List, Optional
from .schemas import WeatherDay
from . import config


# ---------------------------------------------------------------- synthetic
def synthetic_series(past: List[dict], future: List[dict]) -> List[WeatherDay]:
    """past/future are lists of dicts with any WeatherDay fields except day_offset.
    past[0] is 14 days ago ... past[-1] is yesterday; future[0] is today (offset 0)."""
    days: List[WeatherDay] = []
    n_past = len(past)
    for i, d in enumerate(past):
        days.append(WeatherDay(day_offset=-(n_past - i), **d))
    for i, d in enumerate(future):
        days.append(WeatherDay(day_offset=i, **d))
    return days


# ---------------------------------------------------------------- real (Open-Meteo)
def fetch_openmeteo(lat: float = config.DEMO_LAT, lon: float = config.DEMO_LON,
                    tz: str = config.DEMO_TZ) -> List[WeatherDay]:
    """Live fetch. Not exercised in offline/mock runs. Requires network egress to
    api.open-meteo.com + archive-api.open-meteo.com."""
    import requests  # local import so the package imports without requests present
    from datetime import date, timedelta

    today = date.today()
    start_past = today - timedelta(days=config.PAST_WINDOW_DAYS)
    # archive (past) — daily precip + tmax; hourly soil moisture summarised to daily mean
    arch = requests.get(
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": lat, "longitude": lon, "timezone": tz,
            "start_date": start_past.isoformat(), "end_date": (today - timedelta(days=1)).isoformat(),
            "daily": "precipitation_sum,temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max",
        }, timeout=20).json().get("daily", {})
    # forecast (today + next 7) incl modelled soil moisture 0-7cm as VWC proxy
    fc = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat, "longitude": lon, "timezone": tz,
            "forecast_days": config.FORECAST_HORIZON_DAYS,
            "daily": "precipitation_sum,temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max",
            "hourly": "soil_moisture_0_to_7cm",
        }, timeout=20).json()

    days: List[WeatherDay] = []
    ap = arch.get("precipitation_sum", []) or []
    for i in range(len(ap)):
        days.append(WeatherDay(
            day_offset=-(len(ap) - i),
            precip_mm=ap[i] or 0.0,
            tmax_c=(arch.get("temperature_2m_max") or [18])[i] or 18.0,
            rh_pct=(arch.get("relative_humidity_2m_mean") or [60])[i] or 60.0,
            wind_kmh=(arch.get("wind_speed_10m_max") or [8])[i] or 8.0,
        ))
    fd = fc.get("daily", {})
    fp = fd.get("precipitation_sum", []) or []
    # daily-mean soil moisture from hourly (24 values/day)
    sm_hourly = (fc.get("hourly", {}) or {}).get("soil_moisture_0_to_7cm", []) or []
    for i in range(len(fp)):
        chunk = sm_hourly[i * 24:(i + 1) * 24]
        vwc = (sum(chunk) / len(chunk)) if chunk else None
        days.append(WeatherDay(
            day_offset=i,
            precip_mm=fp[i] or 0.0,
            tmax_c=(fd.get("temperature_2m_max") or [18])[i] or 18.0,
            rh_pct=(fd.get("relative_humidity_2m_mean") or [60])[i] or 60.0,
            wind_kmh=(fd.get("wind_speed_10m_max") or [8])[i] or 8.0,
            soil_vwc=vwc,
        ))
    return days


# ---------------------------------------------------------------- snapshot cache
def save_snapshot(days: List[WeatherDay], path: str) -> None:
    with open(path, "w") as f:
        json.dump([d.model_dump() for d in days], f, indent=2)


def load_snapshot(path: str) -> List[WeatherDay]:
    with open(path) as f:
        return [WeatherDay(**d) for d in json.load(f)]


def get_weather(mode: Optional[str] = None, snapshot_path: str = "weather_snapshot.json",
                **kw) -> List[WeatherDay]:
    """mode: 'live' | 'snapshot'. Defaults to env GREENLIGHT_WEATHER or 'snapshot'.
    On live failure, falls back to snapshot if present — never crash the demo."""
    mode = mode or os.getenv("GREENLIGHT_WEATHER", "snapshot")
    if mode == "live":
        try:
            days = fetch_openmeteo(**kw)
            save_snapshot(days, snapshot_path)
            return days
        except Exception as e:  # noqa
            if os.path.exists(snapshot_path):
                return load_snapshot(snapshot_path)
            raise RuntimeError(f"live weather failed and no snapshot at {snapshot_path}: {e}")
    return load_snapshot(snapshot_path)
