"""Greenlight demo UI.  Run from repo root:  streamlit run app/streamlit_app.py

Two tabs:
  Advisor    - pick a paddock, hit 'Check this application', watch the pipeline
               stages resolve, then read the decision card (call, confidence,
               window, evidence, cost-of-error, and any SAFETY overrides).
  Evaluation - the ablation table + safety-layer demonstration from eval_results.json.
"""
from __future__ import annotations
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamlit as st
from greenlight import pipeline, llm
from greenlight.retrieval import Retriever, CORPUS
from greenlight.schemas import Call
from data.seed import demo_paddocks

st.set_page_config(page_title="Greenlight", page_icon="🌱", layout="wide")
RET = Retriever()

CALL_STYLE = {
    "GO": ("#1a7f37", "GO — apply as planned"),
    "WAIT": ("#b8860b", "WAIT — hold for a better window"),
    "SWITCH": ("#8250df", "SWITCH — change the input"),
    "INSPECT": ("#cf222e", "INSPECT — get more information first"),
}


def decision_card(dec):
    colour, label = CALL_STYLE[dec.call.value]
    st.markdown(
        f"<div style='background:{colour};color:white;padding:18px 22px;border-radius:12px;'>"
        f"<div style='font-size:30px;font-weight:800;'>{dec.call.value}</div>"
        f"<div style='font-size:15px;opacity:.95;'>{label}</div></div>",
        unsafe_allow_html=True)
    st.caption(f"Confidence {dec.confidence:.0%}")
    st.progress(min(1.0, max(0.0, dec.confidence)))

    if dec.safety_overrides:
        st.error("**Safety layer overruled the model:**\n\n- " +
                 "\n- ".join(dec.safety_overrides))
    if dec.window:
        st.info(f"**Window:** days {dec.window.start_day_offset}–{dec.window.end_day_offset} "
                f"from now — {dec.window.reason}")
    if dec.clarifying_question:
        st.warning(f"**Clarifying question:** {dec.clarifying_question}")

    st.markdown("**Why**")
    for r in dec.rationale:
        st.markdown(f"- {r}")
    if dec.alternatives:
        st.markdown("**Alternatives**")
        for a in dec.alternatives:
            st.markdown(f"- *{a.action}* — {a.why}")

    c1, c2 = st.columns(2)
    c1.metric("Input $ at risk if mistimed (AUD/ha)",
              f"{dec.cost_of_error_aud_per_ha_low:.0f}–{dec.cost_of_error_aud_per_ha_high:.0f}")
    if dec.follow_up:
        c2.metric("Follow-up", f"in {dec.follow_up.in_days} d")
        c2.caption(dec.follow_up.action)


def differential_block(hyps):
    st.markdown("**Differential (retrieved for AND against each cause)**")
    for h in sorted(hyps, key=lambda x: x.likelihood, reverse=True):
        st.markdown(f"**{h.cause.replace('_', ' ')}** — {h.likelihood:.0%}")
        st.progress(min(1.0, h.likelihood))
        if h.evidence_for:
            st.caption("for: " + "; ".join(h.evidence_for))
        if h.evidence_against:
            st.caption("against: " + "; ".join(h.evidence_against))


def advisor():
    pads = demo_paddocks()
    labels = [f"{s['id']} — {s['title']}" for s in pads]
    with st.sidebar:
        st.header("Paddock")
        idx = st.selectbox("Demo paddock", range(len(pads)), format_func=lambda i: labels[i])
        st.divider()
        st.header("Engine")
        prov = llm.provider()
        st.caption(f"Reasoner: **{prov}**  (set GREENLIGHT_LLM to switch)")
        use_ret = st.toggle("Use retrieval (RAG)", value=True)
        use_safety = st.toggle("Apply safety layer", value=True)
        mode = "llm" if prov in ("anthropic", "openai") else "heuristic"

    s = pads[idx]
    inp = s["input"]
    st.subheader(s["title"])
    a, b, c = st.columns(3)
    a.metric("Crop", f"{inp.crop} (Z{inp.zadoks_stage})")
    b.metric("Soil", inp.soil.soil_type)
    c.metric("Planned", f"{inp.plan.product} {inp.plan.rate_kg_ha:.0f} kg/ha")
    if inp.farmer_note:
        st.caption(f"Farmer note: {inp.farmer_note!r}")

    if st.button("Check this application", type="primary"):
        steps = []
        with st.status("Running Greenlight pipeline…", expanded=True) as status:
            def on_stage(name, detail):
                steps.append((name, detail))
                st.write(f"**{name}** — {detail}")
            res = pipeline.run(inp, mode=mode, use_retrieval=use_ret,
                               apply_safety_layer=use_safety, retriever=RET, on_stage=on_stage)
            status.update(label="Done", state="complete", expanded=False)

        left, right = st.columns([1, 1])
        with left:
            decision_card(res.decision)
        with right:
            differential_block(res.decision.hypotheses)
            with st.expander("Observation (perception output — no diagnosis)"):
                st.json(res.observation.model_dump())
            with st.expander("Derived signals (deterministic)"):
                st.json(res.signals.model_dump())
            with st.expander("Retrieved guidelines"):
                for cid in res.retrieved_ids:
                    st.markdown(f"**[{cid}]** {CORPUS[cid]['text']}")
                    st.caption(CORPUS[cid]["source"])


def evaluation():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "eval", "eval_results.json")
    if not os.path.exists(path):
        st.info("Run `python -m eval.run_eval` first to generate eval_results.json.")
        return
    res = json.load(open(path))
    st.subheader(f"Evaluation — {res['n'] if 'n' in res else len(res['detail']['greenlight'])} "
                 f"scenarios (provider={res.get('provider')})")
    st.dataframe(res["arms"], use_container_width=True)
    c1, c2, c3 = st.columns(3)
    c1.metric("Reasoner unsafe rate", f"{res['reasoner_unsafe_rate']}%")
    c2.metric("Naive unsafe (before → after safety)",
              f"{res['safety_demo_naive_unsafe_before']}% → {res['safety_demo_naive_unsafe_after']}%")
    c3.metric("Consistency (3×)", f"{res['consistency_full']}%")
    st.markdown("**Calibration (accuracy by confidence bucket)**")
    st.json(res["calibration_full"])
    st.markdown("**Per-scenario (full pipeline)**")
    st.dataframe(res["detail"]["greenlight"], use_container_width=True)
    st.caption("Note: rules-only scores high partly because these scenarios were authored "
               "alongside the heuristic. The generalisation test is the LLM arm + "
               "agronomist-labelled cases (future work).")


st.title("🌱 Greenlight")
st.caption("The go / wait / switch / inspect layer for farm input decisions. "
           "Automation executes; Greenlight judges whether the intervention is warranted.")
tab1, tab2 = st.tabs(["Advisor", "Evaluation"])
with tab1:
    advisor()
with tab2:
    evaluation()
