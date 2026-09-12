# greenlight

**The go / wait / switch / inspect layer for farm input decisions.**
Automation is good at *executing* a spray or spread. It is bad at *judging whether
the intervention is warranted right now*. The same yellow patch can be nitrogen
deficiency, waterlogging, sulfur deficiency or herbicide damage — which need
**opposite** actions — and the right timing depends on the forecast. Greenlight is
the judgement layer: it runs a differential diagnosis, checks the weather-driven
loss pathways, and returns **GO / WAIT / SWITCH / INSPECT** with evidence, a
confidence, a cost-of-error, and a deterministic safety net that can overrule the
model.

Scope of this build: **nitrogen top-dress on wheat** (Australian broadacre). The
herbicide path is scaffolded in the safety layer but deliberately out of the
evaluated MVP.

---

## Quick start (offline, no API keys)

```bash
pip install -r requirements.txt          # core needs only pydantic (+ streamlit for UI)
python -m data.seed                       # writes weather_snapshot.json + demo paddocks
python -m pytest tests/ -q                # 13 tests on the deterministic core
python -m eval.run_eval                   # 25-scenario ablation table (mock reasoner)
streamlit run app/streamlit_app.py        # the demo UI
```

Everything above runs with **zero credentials**: the reasoner falls back to a
deterministic heuristic (which also serves as the *rules-only* ablation arm) and
weather comes from the synthetic snapshot.

## Turning on the real LLM / live weather

```bash
cp .env.example .env        # then edit:
export GREENLIGHT_LLM=anthropic     # or openai   (needs the matching API key)
export GREENLIGHT_WEATHER=live      # Open-Meteo, no key; falls back to snapshot on failure
python -m eval.run_eval             # now also runs the LLM arms + LLM consistency
```

The LLM path is provider-agnostic, temperature 0, Pydantic-validated with one
retry, and **falls back to the heuristic on any failure** so the demo never
crashes mid-pitch.

---

## Architecture (one pass, five stages)

```
image/among structured input
      │
      ▼
1. PERCEPTION  ── outputs OBSERVATIONS ONLY, never a diagnosis  (limits hallucination)
      ▼
2. SIGNALS     ── deterministic, weather-driven: saturation, leaching, volatilisation,
                  denitrification, incorporation windows, ΔT   (pure, unit-tested)
      ▼
3. RETRIEVAL   ── hypothesis-driven RAG: retrieve FOR and AGAINST each candidate cause
      ▼
4. REASONING   ── stage 1 differential  →  stage 2 intervention  (heuristic or LLM)
      ▼
5. SAFETY      ── deterministic guardrails that can OVERRULE the model; every
                  override is recorded and shown on screen
      ▼
   Decision: call · window · rationale · hypotheses · confidence · cost-of-error ·
             follow-up · safety_overrides
```

Two design choices worth defending to judges:
- **Perception → observations, not a diagnosis.** The cause is decided in the
  reasoning stage from observations + signals + retrieved guidelines, so it is
  auditable and the vision model can't smuggle in a wrong conclusion.
- **Hypothesis-driven retrieval.** Queries are built per candidate cause including
  a counter-evidence query, so the system retrieves the guideline that lets it
  *reject* sulfur — the memorable demo beat.

---

## The evaluation (this is the hero slide)

`python -m eval.run_eval` on 25 hand-built scenarios (offline, mock reasoner):

| arm | decision acc | top-hyp acc | unsafe rate | retrieval hit |
|---|---|---|---|---|
| naive threshold ("yellow at N timing → apply") | 36% | – | 36% | – |
| rules-only (no retrieval, no safety) | 100% | 100% | 0% | – |
| **greenlight (full)** | **100%** | **100%** | **0%** | **100%** |

- **Safety layer, demonstrated:** apply it to the naive baseline's calls and the
  unsafe-recommendation rate goes **36% → 0%**. The Greenlight reasoner is 0% unsafe
  by construction; the safety layer is the belt-and-braces net for when a *model*
  (LLM arm) errs.
- **Calibration** and **3× consistency** are reported too.
- Turn on `GREENLIGHT_LLM` to add the `llm` and `llm (no retrieval)` arms — that
  ablation is where retrieval and the safety net visibly earn their place.

**Honesty note (say this out loud):** rules-only scores 100% partly because these
scenarios were authored alongside the heuristic — it is a consistency/architecture
check, not proof of field accuracy. The generalisation test is (a) the LLM arm and
(b) ≥50 **agronomist-labelled** cases, which is the first post-hackathon task.

---

## The four things to show live

1. **Observation JSON** — perception emits structured observations with no cause.
2. **Retrieved-and-rejected guideline** — the sulfur chunk is retrieved, then
   ranked near-zero with "evidence against: shows on younger leaves".
3. **The flip** — the adversarial paddock *looks* like nitrogen (older-leaf
   yellowing) but the probe + forecast make it waterlogging → **WAIT**, not GO.
4. **Ablation table** — naive 36% → Greenlight 100%, unsafe 36% → 0%.

Spoken line for the flip stays simple: *"Don't apply now — you'd lose most of it."*
Keep the "don't cut the rate, fix the timing" sophistication in the written
rationale, not the headline.

---

## File map

```
greenlight/config.py      all tunable prices + agronomic thresholds (cite/adjust here)
greenlight/schemas.py     Pydantic contracts (Observation, Differential, Decision, …)
greenlight/weather.py     Open-Meteo fetch + snapshot + synthetic series
greenlight/signals.py     deterministic derived signals  ← test this hardest
greenlight/safety.py      guardrails that overrule the model + would_be_unsafe()
greenlight/retrieval.py   guideline corpus + hypothesis-driven retriever (pgvector stub)
greenlight/llm.py         provider-agnostic structured output (mock/anthropic/openai)
greenlight/perception.py  image → Observation (+ graceful degrade to structured input)
greenlight/reasoning.py   two-stage differential + intervention (heuristic AND llm)
greenlight/pipeline.py    orchestrator with stage trace + apply_safety_layer flag
eval/scenarios.py         25 scenarios with gold labels
eval/run_eval.py          ablation table + safety demo + calibration + consistency
data/seed.py              demo paddocks + weather snapshot
app/streamlit_app.py      Advisor + Evaluation UI
tests/test_signals.py     13 unit tests on signals + safety
```