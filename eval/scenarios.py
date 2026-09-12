"""25 hand-built scenarios with gold labels written from published agronomic logic.
Scope: nitrogen top-dress on wheat (the MVP). Includes GO-correct cases so the
system isn't 'always wait', and ~6 adversarial/abstention cases.

HONESTY (put this on the slide): gold labels were written by the team from public
guidance, NOT by agronomists. First post-hackathon step = 50 agronomist-labelled
cases. Weather is synthetic but shaped to real agronomic relationships; guidelines
are real-in-spirit placeholders to be replaced with cited GRDC/AgVic text."""
from __future__ import annotations
from typing import List, Optional
from greenlight.schemas import (GreenlightInput, Observation, SoilRecord,
                                PlannedAction, Treatment, Case)
from greenlight.weather import synthetic_series


def wx(past7: float, fut: List[float], tmax: float = 18, rh: float = 60,
       wind: float = 8, app_vwc: Optional[float] = None, past_older: float = 0.0):
    past = [{"precip_mm": past_older / 7.0, "tmax_c": tmax, "rh_pct": rh, "wind_kmh": wind}
            for _ in range(7)]  # days -14..-8
    for off in range(-7, 0):    # days -7..-1, lump past7 on day -3
        past.append({"precip_mm": past7 if off == -3 else 0.0,
                     "tmax_c": tmax, "rh_pct": rh, "wind_kmh": wind})
    future = []
    for i, mm in enumerate(fut):
        d = {"precip_mm": mm, "tmax_c": tmax, "rh_pct": rh, "wind_kmh": wind}
        if i == 0 and app_vwc is not None:
            d["soil_vwc"] = app_vwc
        future.append(d)
    return synthetic_series(past, future)


def scn(id, title, gold, obs=None, soil=None, plan=None, weather=None,
        history=None, cases=None, note="", stage=31, abstain=False):
    return {
        "id": id, "title": title, "abstain": abstain, "gold": gold,
        "input": GreenlightInput(
            paddock=id, crop="wheat", zadoks_stage=stage,
            soil=soil or SoilRecord(),
            plan=plan or PlannedAction(),
            observation=obs, farmer_note=note,
            history=history or [], cases=cases or [],
            weather=weather or wx(10, [0, 8, 0, 0, 0, 0, 0]),
        ),
    }


def gold(call, top, must=None, unsafe=None):
    return {"call": call, "top": top, "must_retrieve": must or [], "unsafe_if": unsafe or []}


O = Observation
DUPLEX_POOR = SoilRecord(soil_type="duplex", internal_drainage="poor", low_lying_strip=True)
SANDY = SoilRecord(soil_type="sandy_loam", internal_drainage="moderate")
CLAY = SoilRecord(soil_type="clay_loam", internal_drainage="moderate")
SAND = SoilRecord(soil_type="sand", internal_drainage="good")

SCENARIOS = [
    # 1 — the killer flip
    scn("S01_waterlog_flip", "Older-leaf yellow, low-lying, saturated, front coming",
        gold("WAIT", "waterlogging", ["waterlog_symptom", "denitrification"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="low_lying",
              waterlogging_cues=True, vigour="poor", image_quality=0.8),
        soil=DUPLEX_POOR, weather=wx(48, [0, 0, 35, 0, 8, 0, 0], app_vwc=0.46)),

    # 2 — true N deficiency, clean GO
    scn("S02_true_N_go", "Older-leaf uniform yellow, moist, incorporation window",
        gold("GO", "nitrogen_deficiency", ["n_symptom", "incorporation"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform",
              vigour="moderate", image_quality=0.8),
        soil=SANDY, weather=wx(10, [0, 8, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.30)),

    # 3 — N deficiency but heavy rain -> leaching
    scn("S03_N_leaching_wait", "N-like symptom but 40 mm in 72 h on sandy loam",
        gold("WAIT", "nitrogen_deficiency", ["leaching"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform",
              image_quality=0.7),
        soil=SANDY, weather=wx(12, [0, 40, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.30)),

    # 4 — N deficiency but warm/dry -> volatilisation (WAIT, but GO not "unsafe")
    scn("S04_N_volat_wait", "N-like symptom but warm/dry, no incorporating rain",
        gold("WAIT", "nitrogen_deficiency", ["incorporation"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(8, [0, 0, 0, 0, 0, 0, 0], tmax=26, app_vwc=0.20)),

    # 5 — sulfur (young leaves) -> INSPECT
    scn("S05_sulfur", "Youngest-leaf uniform paling",
        gold("INSPECT", "sulfur_deficiency", ["s_symptom"], []),
        obs=O(leaf_position="younger", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(10, [0, 8, 0, 0, 0, 0, 0], app_vwc=0.28)),

    # 6 — herbicide damage along spray runs + Group 2 history
    scn("S06_herbicide_damage", "Damage along spray runs, Group 2 residual in history",
        gold("INSPECT", "herbicide_damage", ["herbicide_damage"], []),
        obs=O(leaf_position="all", colour_pattern="necrosis", distribution="along_lines"),
        soil=SANDY, history=[Treatment(date="pre-sow", kind="herbicide", product="sulfonylurea",
                                       moa_group="B", note="residual")]),

    # 7 — adversarial: looks like N, is waterlogging
    scn("S07_adversarial_waterlog", "Looks like N (older uniform) but low-lying + saturated + rain",
        gold("WAIT", "waterlogging", ["waterlog_symptom", "denitrification"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="low_lying",
              waterlogging_cues=True),
        soil=DUPLEX_POOR, weather=wx(50, [0, 0, 40, 0, 0, 0, 0], app_vwc=0.47),
        note="looks hungry to me"),

    # 8 — GO on clay loam, later window
    scn("S08_N_go_clay", "Older/all uniform yellow on clay loam, window day 2",
        gold("GO", "nitrogen_deficiency", ["n_symptom"], []),
        obs=O(leaf_position="all", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=CLAY, weather=wx(6, [0, 0, 10, 0, 0, 0, 0], tmax=15, app_vwc=0.25)),

    # 9 — no image, saturated -> waterlogging via signals
    scn("S09_missing_obs_saturated", "No photo; probe saturated in low strip",
        gold("WAIT", "waterlogging", ["denitrification"], ["GO"]),
        obs=None, soil=DUPLEX_POOR, weather=wx(45, [0, 0, 30, 0, 0, 0, 0], app_vwc=0.45),
        abstain=True),

    # 10 — genuinely ambiguous -> INSPECT (abstain)
    scn("S10_ambiguous_abstain", "Weak, non-specific symptom, benign weather",
        gold("INSPECT", "other", [], []),
        obs=O(leaf_position="unknown", colour_pattern="none", distribution="patchy",
              vigour="moderate"),
        soil=CLAY, weather=wx(8, [0, 3, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.26), abstain=True),

    # 11 — frost
    scn("S11_frost", "Necrosis after a cold night; farmer mentions frost",
        gold("INSPECT", "frost", [], []),
        obs=O(leaf_position="all", colour_pattern="necrosis", distribution="patchy"),
        soil=CLAY, note="hard frost last night", weather=wx(5, [0, 0, 0, 0, 0, 0, 0], tmax=12)),

    # 12 — disease (bare patches)
    scn("S12_disease", "Patchy poor-vigour zones, not saturated",
        gold("INSPECT", "disease", [], []),
        obs=O(leaf_position="unknown", colour_pattern="none", distribution="patchy", vigour="poor"),
        soil=CLAY, weather=wx(10, [0, 6, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.25)),

    # 13 — case memory: same strip recovered before
    scn("S13_case_memory", "Saturated low strip; paddock recovered from this before",
        gold("WAIT", "waterlogging", ["waterlog_symptom"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="low_lying"),
        soil=DUPLEX_POOR, weather=wx(46, [0, 0, 20, 0, 0, 0, 0], app_vwc=0.45),
        cases=[Case(paddock="S13_case_memory", season="2yrs ago", symptom="yellow low strip waterlogged",
                    antecedent_rain_mm_7d=52, action_taken="waited", outcome="resolved",
                    note="recovered without extra N")]),

    # 14 — GO with window on day 3, cool
    scn("S14_N_go_day3", "Older uniform yellow, cool, 12 mm forecast day 3",
        gold("GO", "nitrogen_deficiency", ["n_symptom"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(8, [0, 0, 0, 12, 0, 0, 0], tmax=16, app_vwc=0.28)),

    # 15 — saturation via VWC on clay (denitrification), leaching should NOT fire
    scn("S15_sat_clay", "Clay, saturated (probe), older uniform",
        gold("WAIT", "waterlogging", ["denitrification"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SoilRecord(soil_type="clay", internal_drainage="poor", low_lying_strip=False),
        weather=wx(30, [0, 0, 15, 0, 0, 0, 0], app_vwc=0.44)),

    # 16 — leaching on pure sand
    scn("S16_leaching_sand", "Sand, 30 mm within 72 h",
        gold("WAIT", "nitrogen_deficiency", ["leaching"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SAND, weather=wx(10, [0, 30, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.25)),

    # 17 — heavy rain but clay -> leaching gating off -> GO
    scn("S17_clay_heavy_rain_go", "Clay loam, 40 mm forecast but not a light soil",
        gold("GO", "nitrogen_deficiency", ["n_symptom"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=CLAY, weather=wx(10, [0, 40, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.30)),

    # 18 — window AND saturation -> saturation dominates
    scn("S18_window_vs_sat", "Saturated but an 8 mm window also present",
        gold("WAIT", "waterlogging", ["denitrification"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="low_lying"),
        soil=DUPLEX_POOR, weather=wx(40, [0, 0, 8, 0, 0, 0, 0], app_vwc=0.45)),

    # 19 — moderate GO
    scn("S19_N_go_moderate", "Older uniform yellow, moderate moisture, 6 mm window",
        gold("GO", "nitrogen_deficiency", ["n_symptom"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(15, [0, 6, 0, 0, 0, 0, 0], tmax=18, app_vwc=0.32)),

    # 20 — sulfur (interveinal, young)
    scn("S20_sulfur_2", "Youngest-leaf interveinal paling",
        gold("INSPECT", "sulfur_deficiency", ["s_symptom"], []),
        obs=O(leaf_position="younger", colour_pattern="interveinal", distribution="uniform"),
        soil=SANDY, weather=wx(10, [0, 8, 0, 0, 0, 0, 0], app_vwc=0.28)),

    # 21 — Group 2 in history but NO damage pattern -> still N, GO
    scn("S21_history_no_pattern", "Older uniform yellow; Group 2 used pre-sow but no line pattern",
        gold("GO", "nitrogen_deficiency", ["n_symptom"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(10, [0, 8, 0, 0, 0, 0, 0], tmax=16, app_vwc=0.30),
        history=[Treatment(date="pre-sow", kind="herbicide", product="sulfonylurea", moa_group="B")]),

    # 22 — waterlogging via fallback (no probe reading at all)
    scn("S22_waterlog_no_probe", "No probe; heavy recent rain + poor drainage",
        gold("WAIT", "waterlogging", ["waterlog_symptom"], ["GO"]),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="low_lying"),
        soil=DUPLEX_POOR, weather=wx(40, [0, 0, 10, 0, 0, 0, 0], app_vwc=None), abstain=True),

    # 23 — dry spell then forecast rain -> GO into the window
    scn("S23_dry_then_rain_go", "Dry spell, older uniform yellow, 10 mm forecast day 1",
        gold("GO", "nitrogen_deficiency", ["incorporation"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(2, [0, 10, 0, 0, 0, 0, 0], tmax=18, app_vwc=0.18)),

    # 24 — hot, windy, dry -> volatilisation WAIT
    scn("S24_volat_hot_windy", "Hot, windy, dry -> ammonia volatilisation",
        gold("WAIT", "nitrogen_deficiency", ["incorporation"], []),
        obs=O(leaf_position="older", colour_pattern="uniform_chlorosis", distribution="uniform"),
        soil=SANDY, weather=wx(6, [0, 0, 0, 0, 0, 0, 0], tmax=28, wind=20, app_vwc=0.20)),

    # 25 — low-confidence escalation
    scn("S25_low_conf_escalate", "Non-specific symptom, no probe, thin evidence",
        gold("INSPECT", "other", [], []),
        obs=O(leaf_position="unknown", colour_pattern="unknown", distribution="unknown"),
        soil=CLAY, weather=wx(9, [0, 4, 0, 0, 0, 0, 0], tmax=17, app_vwc=0.27), abstain=True),
]

assert len(SCENARIOS) == 25, len(SCENARIOS)
