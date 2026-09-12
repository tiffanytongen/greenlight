"""Seed the demo: writes a weather snapshot and a set of named demo paddocks the
UI can load. Uses the eval scenarios as ready-made, agronomically-shaped paddocks
so the demo and the eval share the same ground truth.

Run:  python -m data.seed
"""
from __future__ import annotations
import json
import os
from greenlight.weather import synthetic_series, save_snapshot
from eval.scenarios import SCENARIOS

HERE = os.path.dirname(__file__)

# a curated demo order — lead with the killer flip, then a clean GO, then variety
DEMO_ORDER = ["S07_adversarial_waterlog", "S02_true_N_go", "S03_N_leaching_wait",
              "S05_sulfur", "S24_volat_hot_windy", "S13_case_memory",
              "S09_missing_obs_saturated", "S17_clay_heavy_rain_go"]


def demo_paddocks():
    by_id = {s["id"]: s for s in SCENARIOS}
    ordered = [by_id[i] for i in DEMO_ORDER if i in by_id]
    ordered += [s for s in SCENARIOS if s["id"] not in DEMO_ORDER]
    return ordered


def main():
    # a plausible snapshot for the demo location (used by the 'snapshot' weather mode)
    past = [{"precip_mm": (12 if d in (3, 6) else 0), "tmax_c": 17, "rh_pct": 68, "wind_kmh": 9}
            for d in range(7)]
    past += [{"precip_mm": (26 if d == 4 else 0), "tmax_c": 16, "rh_pct": 72, "wind_kmh": 10}
             for d in range(7)]
    future = [{"precip_mm": mm, "tmax_c": 16, "rh_pct": 70, "wind_kmh": 10,
               **({"soil_vwc": 0.40} if i == 0 else {})}
              for i, mm in enumerate([0, 0, 8, 0, 0, 4, 0])]
    days = synthetic_series(past, future)
    snap = os.path.join(os.path.dirname(HERE), "weather_snapshot.json")
    save_snapshot(days, snap)

    manifest = [{"id": s["id"], "title": s["title"], "crop": s["input"].crop,
                 "soil": s["input"].soil.soil_type} for s in demo_paddocks()]
    with open(os.path.join(HERE, "paddocks.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote {snap} and data/paddocks.json ({len(manifest)} demo paddocks)")


if __name__ == "__main__":
    main()
