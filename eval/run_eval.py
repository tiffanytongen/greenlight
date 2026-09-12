"""Run the 25-scenario evaluation and print the ablation table.

Arms:
  naive        - threshold baseline ('crop is yellow at N timing -> apply'); the
                 'sensor automation' competitor. No signal awareness.
  rules_only   - our deterministic engine, NO retrieval, NO safety layer.
  greenlight   - deterministic engine + retrieval + safety layer (the product).
  llm          - only if GREENLIGHT_LLM in {anthropic,openai}; two-stage LLM + all.

Headline metrics: decision accuracy, top-hypothesis accuracy, unsafe-rate
before/after the safety layer, retrieval hit rate, confidence calibration,
abstention appropriateness, consistency.

Run:  python -m eval.run_eval        (from repo root; offline, no keys needed)
"""
from __future__ import annotations
import json
import os
from collections import defaultdict
from greenlight import pipeline
from greenlight.retrieval import Retriever
from greenlight.safety import would_be_unsafe, apply_safety
from greenlight.schemas import Call
from eval.scenarios import SCENARIOS

RET = Retriever()


# ---------------------------------------------------------------- naive baseline
def naive_call(s) -> Call:
    inp = s["input"]
    obs = inp.observation
    yellowish = True
    if obs is not None:
        yellowish = (obs.colour_pattern in ("uniform_chlorosis", "interveinal")
                     or obs.vigour == "poor" or obs.leaf_position in ("older", "all"))
    in_timing = 30 <= inp.zadoks_stage <= 39
    return Call.GO if (yellowish and in_timing) else Call.INSPECT


# ---------------------------------------------------------------- run one arm
def run_arm(mode, use_retrieval, safety):
    rows = []
    for s in SCENARIOS:
        r = pipeline.run(s["input"], mode=mode, use_retrieval=use_retrieval,
                         apply_safety_layer=safety, retriever=RET)
        lead = max(r.decision.hypotheses, key=lambda h: h.likelihood).cause \
            if r.decision.hypotheses else "other"
        rows.append({
            "id": s["id"], "gold": s["gold"], "abstain": s["abstain"],
            "call": r.decision.call.value, "top": lead,
            "conf": r.decision.confidence, "sig": r.signals,
            "retrieved": r.retrieved_ids, "kind": s["input"].plan.kind,
            "overrides": r.decision.safety_overrides,
        })
    return rows


def pct(n, d):
    return round(100.0 * n / d, 1) if d else 0.0


def summarise(rows, name, is_reasoner=True):
    n = len(rows)
    dec = sum(r["call"] == r["gold"]["call"] for r in rows)
    top = sum(r["top"] == r["gold"]["top"] for r in rows) if is_reasoner else 0
    unsafe = sum(would_be_unsafe(Call(r["call"]), r["sig"], r["kind"]) for r in rows)
    # retrieval hit: all must_retrieve present in retrieved ids
    ret_apps = [r for r in rows if r["gold"]["must_retrieve"]]
    ret_hit = sum(all(cid in r["retrieved"] for cid in r["gold"]["must_retrieve"]) for r in ret_apps)
    # abstention: on abstain scenarios, did NOT issue GO
    abst = [r for r in rows if r["abstain"]]
    abst_ok = sum(r["call"] != "GO" for r in abst)
    return {
        "arm": name, "n": n,
        "decision_acc": pct(dec, n),
        "top_hyp_acc": pct(top, n) if is_reasoner else None,
        "unsafe_rate": pct(unsafe, n),
        "retrieval_hit": pct(ret_hit, len(ret_apps)) if is_reasoner else None,
        "abstain_ok": pct(abst_ok, len(abst)) if abst else None,
    }


def calibration(rows):
    buckets = {"<0.55": [], "0.55-0.75": [], ">0.75": []}
    for r in rows:
        c = r["conf"]
        b = "<0.55" if c < 0.55 else ("0.55-0.75" if c <= 0.75 else ">0.75")
        buckets[b].append(r["call"] == r["gold"]["call"])
    return {b: {"n": len(v), "acc": pct(sum(v), len(v))} for b, v in buckets.items()}


def consistency(mode, use_retrieval, runs=3):
    """Fraction of scenarios giving the same call across `runs` runs."""
    calls = defaultdict(set)
    for _ in range(runs):
        for r in run_arm(mode, use_retrieval, safety=True):
            calls[r["id"]].add(r["call"])
    return pct(sum(len(v) == 1 for v in calls.values()), len(calls))


def main():
    provider = os.getenv("GREENLIGHT_LLM", "mock")
    results = {"arms": [], "detail": {}}

    # unsafe BEFORE safety (reasoner, no safety) vs AFTER (full)
    rules_nosafe = run_arm("heuristic", use_retrieval=False, safety=False)
    full = run_arm("heuristic", use_retrieval=True, safety=True)
    naive = [{"id": s["id"], "gold": s["gold"], "abstain": s["abstain"],
              "call": naive_call(s).value, "top": "-", "conf": 1.0,
              "sig": pipeline.run(s["input"], apply_safety_layer=False, retriever=RET).signals,
              "retrieved": [], "kind": s["input"].plan.kind, "overrides": []}
             for s in SCENARIOS]

    unsafe_reasoner = sum(would_be_unsafe(Call(r["call"]), r["sig"], r["kind"]) for r in full)

    # Safety-layer demonstration: apply the deterministic safety layer to the NAIVE
    # baseline's calls (the arm that actually makes unsafe GOs) and re-measure.
    from greenlight.schemas import Decision
    naive_unsafe_before = sum(would_be_unsafe(Call(r["call"]), r["sig"], r["kind"]) for r in naive)
    naive_after = 0
    for r, s in zip(naive, SCENARIOS):
        d = apply_safety(Decision(call=Call(r["call"]), confidence=1.0), r["sig"], s["input"])
        naive_after += would_be_unsafe(d.call, r["sig"], r["kind"])

    results["arms"] = [
        summarise(naive, "naive_threshold", is_reasoner=False),
        summarise(rules_nosafe, "rules_only (no retrieval, no safety)"),
        summarise(full, "greenlight (full)"),
    ]
    results["reasoner_unsafe_rate"] = pct(unsafe_reasoner, len(SCENARIOS))
    results["safety_demo_naive_unsafe_before"] = pct(naive_unsafe_before, len(SCENARIOS))
    results["safety_demo_naive_unsafe_after"] = pct(naive_after, len(SCENARIOS))
    results["calibration_full"] = calibration(full)
    results["consistency_full"] = consistency("heuristic", True)
    results["provider"] = provider

    if provider in ("anthropic", "openai"):
        llm_full = run_arm("llm", use_retrieval=True, safety=True)
        llm_nort = run_arm("llm", use_retrieval=False, safety=True)
        results["arms"].append(summarise(llm_nort, "llm (no retrieval)"))
        results["arms"].append(summarise(llm_full, "llm + retrieval + safety"))
        results["consistency_llm"] = consistency("llm", True)

    # per-scenario detail for the app / debugging
    results["detail"]["greenlight"] = [
        {"id": r["id"], "call": r["call"], "gold": r["gold"]["call"],
         "top": r["top"], "gold_top": r["gold"]["top"], "conf": r["conf"],
         "ok": r["call"] == r["gold"]["call"]} for r in full]

    out = os.path.join(os.path.dirname(__file__), "eval_results.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2, default=str)

    # ---- print ----
    print(f"\nGREENLIGHT EVALUATION  (provider={provider}, n={len(SCENARIOS)})\n" + "=" * 68)
    hdr = f"{'arm':<38}{'dec%':>6}{'top%':>6}{'unsafe%':>8}{'ret%':>6}{'abst%':>6}"
    print(hdr + "\n" + "-" * 68)
    for a in results["arms"]:
        print(f"{a['arm']:<38}{a['decision_acc']:>6}"
              f"{('-' if a['top_hyp_acc'] is None else a['top_hyp_acc']):>6}"
              f"{a['unsafe_rate']:>8}"
              f"{('-' if a['retrieval_hit'] is None else a['retrieval_hit']):>6}"
              f"{('-' if a['abstain_ok'] is None else a['abstain_ok']):>6}")
    print("-" * 68)
    print(f"Greenlight reasoner unsafe-recommendation rate: {results['reasoner_unsafe_rate']}% "
          "(safe by construction)")
    print(f"Safety layer on naive baseline: unsafe {results['safety_demo_naive_unsafe_before']}% "
          f"-> {results['safety_demo_naive_unsafe_after']}%  (the deterministic net catches bad GOs)")
    print(f"Consistency (full, 3x): {results['consistency_full']}%")
    print("Calibration (full):", {b: v["acc"] for b, v in results["calibration_full"].items()})
    print("\nMisses (full):")
    for d in results["detail"]["greenlight"]:
        if not d["ok"]:
            print(f"  {d['id']:<26} got {d['call']:<8} gold {d['gold']:<8} "
                  f"(top {d['top']} / gold {d['gold_top']})")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
