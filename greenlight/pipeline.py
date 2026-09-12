"""Orchestrator. Wires perception -> signals -> hypothesis-driven retrieval ->
reasoning -> safety, emitting a stage trace so the UI can stream progress (the
'watch it think' demo beat) and so nothing looks hardcoded.

Return value bundles the decision plus every intermediate so the UI/eval can show
the observation JSON, the retrieved+rejected chunks, and the safety overrides."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, List, Optional
from .schemas import GreenlightInput, Observation, DerivedSignals, Decision
from .signals import compute_signals
from .perception import perceive
from .retrieval import Retriever
from .reasoning import reason, heuristic_differential
from .safety import apply_safety


@dataclass
class Result:
    observation: Observation
    signals: DerivedSignals
    retrieved_ids: List[str]
    decision: Decision
    trace: List[dict] = field(default_factory=list)


def run(inp: GreenlightInput, image_path: Optional[str] = None,
        mode: str = "heuristic", use_retrieval: bool = True,
        retriever: Optional[Retriever] = None,
        apply_safety_layer: bool = True,
        on_stage: Optional[Callable[[str, str], None]] = None) -> Result:
    retriever = retriever or Retriever()
    trace: List[dict] = []

    def stage(name: str, detail: str):
        trace.append({"stage": name, "detail": detail})
        if on_stage:
            on_stage(name, detail)

    # 1. perception
    obs = perceive(image_path, inp.observation, inp.farmer_note)
    stage("PERCEPTION", f"leaf={obs.leaf_position}, colour={obs.colour_pattern}, "
                        f"dist={obs.distribution}, waterlogging_cues={obs.waterlogging_cues}")

    # 2. deterministic signals
    sig = compute_signals(inp.weather, inp.soil, inp.plan)
    stage("SIGNALS", f"past7={sig.past7_rain_mm}mm next3={sig.next3_rain_mm}mm "
                     f"sat={sig.saturation_flag} leach={sig.leaching_risk} "
                     f"volat={sig.volatilisation_risk} incorp_windows={sig.incorporation_windows}")

    # 3. hypothesis-driven retrieval (retrieve for AND against candidate causes)
    candidates = [h.cause for h in heuristic_differential(obs, sig, inp).hypotheses]
    ids = retriever.for_hypotheses(candidates) if use_retrieval else []
    stage("RETRIEVAL", "retrieved: " + (", ".join(ids) if ids else "(none / ablation)"))

    # 4. reasoning (two-stage)
    decision = reason(obs, sig, inp, retriever, ids, mode=mode, use_retrieval=use_retrieval)
    lead = max(decision.hypotheses, key=lambda h: h.likelihood) if decision.hypotheses else None
    stage("REASONING", f"leading={lead.cause if lead else '?'} "
                       f"call(pre-safety)={decision.call.value} conf={decision.confidence}")

    # 5. safety layer (can overrule)
    if apply_safety_layer:
        pre = decision.call.value
        decision = apply_safety(decision, sig, inp)
        stage("SAFETY", (f"{pre} -> {decision.call.value}; overrides: " +
                         ("; ".join(decision.safety_overrides) if decision.safety_overrides else "none")))
    else:
        stage("SAFETY", "skipped (ablation)")

    return Result(observation=obs, signals=sig, retrieved_ids=ids,
                  decision=decision, trace=trace)
