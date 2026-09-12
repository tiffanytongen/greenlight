"""The data contracts. Perception, reasoning and the safety layer all read/write
these. Strict schemas are what make the pipeline auditable AND evaluable — this
file is the backbone of the 'not a chatbot' argument."""
from __future__ import annotations
from enum import Enum
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator


# ---------------- perception ----------------
LeafPosition = Literal["older", "younger", "all", "unknown"]
ColourPattern = Literal[
    "uniform_chlorosis", "interveinal", "tip_burn", "purpling", "necrosis", "none", "unknown"
]
Distribution = Literal["patchy", "uniform", "along_lines", "low_lying", "unknown"]


class Observation(BaseModel):
    """Perception output. Deliberately contains NO diagnosis — only what is seen."""
    leaf_position: LeafPosition = "unknown"
    colour_pattern: ColourPattern = "unknown"
    distribution: Distribution = "unknown"
    vigour: Literal["poor", "moderate", "good", "unknown"] = "unknown"
    waterlogging_cues: bool = False
    image_quality: float = Field(0.0, ge=0.0, le=1.0)
    notes: str = ""


# ---------------- inputs ----------------
class SoilRecord(BaseModel):
    soil_type: Literal["sand", "loamy_sand", "sandy_loam", "duplex", "clay_loam", "clay"] = "duplex"
    internal_drainage: Literal["poor", "moderate", "good"] = "moderate"
    low_lying_strip: bool = False


class PlannedAction(BaseModel):
    kind: Literal["nitrogen", "herbicide"] = "nitrogen"
    product: str = "urea"
    rate_kg_ha: float = 130.0          # 130 kg urea/ha ~= 60 kg N/ha
    n_rate_kg_ha: float = 60.0
    intended_date_offset_days: int = 0  # 0 = "apply now"


class Treatment(BaseModel):
    date: str
    kind: str
    product: str
    moa_group: Optional[str] = None
    note: str = ""


class Case(BaseModel):
    """A past incident with an outcome — the case-based memory."""
    paddock: str
    season: str
    symptom: str
    antecedent_rain_mm_7d: float
    action_taken: str
    outcome: Literal["resolved", "persisted", "worsened"]
    note: str = ""


class WeatherDay(BaseModel):
    day_offset: int                    # negative = past, 0 = today, positive = forecast
    precip_mm: float = 0.0
    tmax_c: float = 18.0
    rh_pct: float = 60.0
    wind_kmh: float = 8.0
    soil_vwc: Optional[float] = None   # modelled/probe volumetric water content 0-1


class DerivedSignals(BaseModel):
    past7_rain_mm: float = 0.0
    past14_rain_mm: float = 0.0
    next2_rain_mm: float = 0.0
    next3_rain_mm: float = 0.0
    next7_rain_mm: float = 0.0
    saturation_flag: bool = False
    leaching_risk: bool = False
    volatilisation_risk: bool = False
    denitrification_risk: bool = False
    incorporation_windows: List[int] = Field(default_factory=list)  # day offsets w/ 5-15mm
    delta_t: Optional[float] = None
    wind_ok: Optional[bool] = None
    inversion_risk: Optional[bool] = None


class GreenlightInput(BaseModel):
    paddock: str
    crop: str = "wheat"
    zadoks_stage: int = 31
    soil: SoilRecord = Field(default_factory=SoilRecord)
    plan: PlannedAction = Field(default_factory=PlannedAction)
    observation: Optional[Observation] = None
    farmer_note: str = ""
    history: List[Treatment] = Field(default_factory=list)
    cases: List[Case] = Field(default_factory=list)
    weather: List[WeatherDay] = Field(default_factory=list)


# ---------------- reasoning ----------------
Cause = Literal[
    "nitrogen_deficiency", "waterlogging", "sulfur_deficiency",
    "herbicide_damage", "disease", "frost", "other",
]


class Hypothesis(BaseModel):
    cause: Cause
    likelihood: float = Field(ge=0.0, le=1.0)
    evidence_for: List[str] = Field(default_factory=list)
    evidence_against: List[str] = Field(default_factory=list)
    source: str = ""                    # which guideline chunk / rule supports it


class Differential(BaseModel):
    hypotheses: List[Hypothesis]

    @property
    def leading(self) -> Hypothesis:
        return max(self.hypotheses, key=lambda h: h.likelihood)

    @property
    def margin(self) -> float:
        ranked = sorted(self.hypotheses, key=lambda h: h.likelihood, reverse=True)
        return (ranked[0].likelihood - ranked[1].likelihood) if len(ranked) > 1 else 1.0


# ---------------- decision ----------------
class Call(str, Enum):
    GO = "GO"
    WAIT = "WAIT"
    SWITCH = "SWITCH"
    INSPECT = "INSPECT"


class Window(BaseModel):
    start_day_offset: int
    end_day_offset: int
    reason: str = ""


class Alternative(BaseModel):
    action: str
    why: str


class FollowUp(BaseModel):
    action: str
    in_days: int


class Decision(BaseModel):
    call: Call
    window: Optional[Window] = None
    rate_change: Optional[str] = None
    zone_exceptions: List[str] = Field(default_factory=list)
    hypotheses: List[Hypothesis] = Field(default_factory=list)
    rationale: List[str] = Field(default_factory=list)
    alternatives: List[Alternative] = Field(default_factory=list)
    cost_of_error_aud_per_ha_low: float = 0.0
    cost_of_error_aud_per_ha_high: float = 0.0
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    follow_up: Optional[FollowUp] = None
    safety_overrides: List[str] = Field(default_factory=list)
    clarifying_question: Optional[str] = None

    @field_validator("call", mode="before")
    @classmethod
    def _coerce(cls, v):
        return Call(v) if isinstance(v, str) else v
