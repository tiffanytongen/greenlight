"""Perception: image -> Observation. Outputs OBSERVATIONS ONLY, never a diagnosis
(that separation is what keeps the differential auditable and limits hallucination).

Mock mode: if the caller already supplied an Observation (e.g. from a scenario or a
structured field/voice form), we pass it through. This is also the graceful-degrade
path the blueprint recommends: if vision is garbage, let the farmer enter
observations directly and the rest of the pipeline is unchanged."""
from __future__ import annotations
from typing import Optional
from .schemas import Observation
from . import llm

PERCEPTION_SYSTEM = (
    "You are a crop-scouting perception module. Look at the leaf/canopy image and "
    "report ONLY what you observe as strict JSON matching the Observation schema. "
    "Do NOT diagnose a cause. Fields: leaf_position (older|younger|all|unknown), "
    "colour_pattern (uniform_chlorosis|interveinal|tip_burn|purpling|necrosis|none|unknown), "
    "distribution (patchy|uniform|along_lines|low_lying|unknown), vigour "
    "(poor|moderate|good|unknown), waterlogging_cues (bool), image_quality (0-1), notes."
)


def perceive(image_path: Optional[str], prior: Optional[Observation],
             farmer_note: str = "") -> Observation:
    # already have a structured observation (scenario / manual form / voice) -> use it
    if prior is not None:
        return prior
    if image_path is None or llm.provider() == "mock":
        # nothing to see; return unknowns (reasoner will lean on weather+history)
        return Observation(notes="no image / mock mode; observations entered elsewhere")
    user = ("Return the Observation JSON for this image. "
            f"Farmer note (context only, do not treat as ground truth): {farmer_note!r}")
    try:
        return llm.complete_json(PERCEPTION_SYSTEM, user, Observation, image_path=image_path)
    except Exception:
        return Observation(notes="perception failed; treat leaf features as unknown")
