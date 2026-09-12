/* Greenlight mobile (Expo Go) — the same deterministic engine as the Python
   pipeline and the web app (engine.js is verified against Python on all 25
   evaluation scenarios). Pure React Native core components, no extra deps. */
import React, { useMemo, useRef, useState } from "react";
import {
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Switch, Text,
  TextInput, View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

const E = require("./engine.js");
const DATA = require("./data.js");

// ---------------------------------------------------------------- theme
const C = {
  bg: "#121814", surface: "#1A211C", surface2: "#222B24", surface3: "#2A342C",
  ink: "#E8EDE7", ink2: "#B7C2B8", muted: "#8B978E", line: "#2C362E", line2: "#3A463C",
  accent: "#66B77E", accentInk: "#0D130E", accentSoft: "#21301F",
  rain: "#6FA8CF", rainDim: "#3C566B",
  GO: "#2E8747", WAIT: "#B58B2A", SWITCH: "#8E70C4", INSPECT: "#D05548",
  goTint: "#1C2B1F", waitTint: "#2E2818", switchTint: "#262133", inspectTint: "#331F1C",
};
const CALL_EXPL = {
  GO: "Apply as planned — conditions favour uptake without loss.",
  WAIT: "Hold for a better window — applying now would lose the input.",
  SWITCH: "Change the input — this product won't fix the diagnosed cause.",
  INSPECT: "Get more information first — don't spend inputs on an unconfirmed cause.",
};
const MONO = { fontFamily: "Menlo", fontVariant: ["tabular-nums"] };
const cap = s => String(s).replace(/_/g, " ");

const byId = {};
DATA.scenarios.forEach(s => { byId[s.id] = s; });
const TOUR = DATA.demo_order.filter(id => byId[id]);
const REST = DATA.scenarios.map(s => s.id).filter(id => !TOUR.includes(id));

// ---------------------------------------------------------------- custom paddock
const CUSTOM_DEFAULTS = {
  hasObs: true, leaf: "older", colour: "uniform_chlorosis", dist: "uniform",
  vigour: "moderate", cues: false, soil: "duplex", drainage: "moderate",
  lowlying: false, past7: "10", futmm: "8", futday: "1", tmax: "17",
  vwc: "0.30", rate: "130",
};

function buildCustomInput(c) {
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const tmax = num(c.tmax, 17), past7 = num(c.past7, 0), futmm = num(c.futmm, 0);
  const futday = Math.min(6, Math.max(0, Math.round(num(c.futday, 1))));
  const rate = num(c.rate, 130);
  const weather = [];
  for (let i = 0; i < 7; i++) weather.push({
    day_offset: -(14 - i), precip_mm: 0, tmax_c: tmax, rh_pct: 60, wind_kmh: 8, soil_vwc: null,
  });
  for (let off = -7; off < 0; off++) weather.push({
    day_offset: off, precip_mm: off === -3 ? past7 : 0, tmax_c: tmax, rh_pct: 60,
    wind_kmh: 8, soil_vwc: null,
  });
  for (let i = 0; i < 7; i++) weather.push({
    day_offset: i, precip_mm: i === futday ? futmm : 0, tmax_c: tmax, rh_pct: 60,
    wind_kmh: 8, soil_vwc: i === 0 && c.vwc.trim() !== "" ? num(c.vwc, null) : null,
  });
  return {
    paddock: "custom", crop: "wheat", zadoks_stage: 31,
    soil: { soil_type: c.soil, internal_drainage: c.drainage, low_lying_strip: c.lowlying },
    plan: { kind: "nitrogen", product: "urea", rate_kg_ha: rate,
            n_rate_kg_ha: rate * 0.46, intended_date_offset_days: 0 },
    observation: c.hasObs ? {
      leaf_position: c.leaf, colour_pattern: c.colour, distribution: c.dist,
      vigour: c.vigour, waterlogging_cues: c.cues, image_quality: 0.8, notes: "entered in app",
    } : null,
    farmer_note: "", history: [], cases: [], weather,
  };
}

// ---------------------------------------------------------------- small pieces
function SectionLabel({ children }) {
  return <Text style={st.sectionLabel}>{children}</Text>;
}

function Chip({ children }) {
  return <View style={st.chip}><Text style={st.chipText}>{children}</Text></View>;
}

function ChipSelect({ options, value, onChange }) {
  return (
    <View style={st.chipSelectRow}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)}
          style={[st.chipOpt, value === o && st.chipOptOn]}>
          <Text style={[st.chipOptText, value === o && st.chipOptTextOn]}>{cap(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function NumInput({ value, onChange, width = 90 }) {
  return (
    <TextInput value={value} onChangeText={onChange} keyboardType="numeric"
      style={[st.numInput, { width }]} placeholderTextColor={C.muted} />
  );
}

function SwitchRow({ label, value, onChange }) {
  return (
    <View style={st.switchRow}>
      <Text style={st.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: C.surface3, true: C.accent }}
        thumbColor="#F5F7F2" ios_backgroundColor={C.surface3} />
    </View>
  );
}

function Collapsible({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={st.collapse}>
      <Pressable onPress={() => setOpen(!open)} style={st.collapseHead}>
        <Text style={st.collapseTitle}>{title}</Text>
        <Text style={{ color: C.muted }}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && <View style={st.collapseBody}>{children}</View>}
    </View>
  );
}

// ---------------------------------------------------------------- rain chart
function RainChart({ input }) {
  const [tip, setTip] = useState(null);
  const days = [...input.weather].sort((a, b) => a.day_offset - b.day_offset);
  const maxMM = Math.max(10, ...days.map(d => d.precip_mm));
  const app = input.plan.intended_date_offset_days;
  return (
    <View style={st.card}>
      <Text style={st.cardKicker}>RAIN · PAST 14 DAYS → 7-DAY FORECAST</Text>
      <View style={st.rainLegend}>
        <View style={[st.legendSwatch, { backgroundColor: C.rainDim }]} />
        <Text style={st.legendText}>past</Text>
        <View style={[st.legendSwatch, { backgroundColor: C.rain }]} />
        <Text style={st.legendText}>forecast</Text>
        <View style={[st.legendSwatch, { borderWidth: 2, borderColor: C.accent }]} />
        <Text style={st.legendText}>5–15 mm window</Text>
      </View>
      <View style={st.rainRow}>
        {days.map(d => {
          const h = Math.max(d.precip_mm > 0 ? 4 : 2, (d.precip_mm / maxMM) * 56);
          const incorp = d.day_offset >= app && d.day_offset <= app + 4 &&
            d.precip_mm >= 5 && d.precip_mm <= 15;
          return (
            <Pressable key={d.day_offset} style={st.rainCol} onPress={() => setTip(
              `Day ${d.day_offset >= 0 ? "+" : ""}${d.day_offset}: ${d.precip_mm} mm · ${d.tmax_c}°C` +
              (d.soil_vwc !== null && d.soil_vwc !== undefined ? ` · probe VWC ${d.soil_vwc}` : "") +
              (incorp ? " · possible incorporation window" : ""))}>
              {d.day_offset === 0 && <View style={st.todayLine} />}
              <View style={{ flex: 1 }} />
              <View style={[
                st.rainBar,
                { height: h, backgroundColor: d.precip_mm > 0 ? (d.day_offset < 0 ? C.rainDim : C.rain) : C.line2 },
                incorp && { borderWidth: 2, borderColor: C.accent },
              ]} />
            </Pressable>
          );
        })}
      </View>
      <View style={st.rainAxis}>
        <Text style={st.axisText}>-14d</Text><Text style={st.axisText}>-7d</Text>
        <Text style={st.axisText}>today</Text><Text style={st.axisText}>+6d</Text>
      </View>
      <Text style={st.rainTip}>{tip || "Tap a bar for the day's detail."}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- pipeline trace
function Trace({ trace, reveal }) {
  return (
    <View style={st.card}>
      {trace.map((t, i) => (
        <View key={t.stage} style={[st.traceRow, i >= reveal && { opacity: 0.15 }]}>
          <Text style={[st.traceNum, MONO]}>{i + 1}</Text>
          <Text style={st.traceName}>{t.stage}</Text>
          <Text style={[st.traceDetail, MONO]}>{t.detail}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- decision card
function Decision({ res }) {
  const d = res.decision;
  const confPct = Math.round(d.confidence * 100);
  const callColor = C[d.call];
  return (
    <View style={[st.card, { padding: 0, overflow: "hidden" }]}>
      <View style={{ backgroundColor: callColor, padding: 16 }}>
        <Text style={st.callWord}>{d.call}</Text>
        <Text style={st.callExpl}>{CALL_EXPL[d.call]}</Text>
      </View>
      <View style={{ padding: 14, gap: 12 }}>
        <View>
          <View style={st.confRow}>
            <Text style={st.dim}>Confidence</Text>
            <Text style={[st.dim, MONO]}>{confPct}%</Text>
          </View>
          <View style={st.confTrack}>
            <View style={[st.confFill, { width: `${confPct}%`, backgroundColor: callColor }]} />
            <View style={st.confTick} />
          </View>
          <Text style={st.tiny}>tick = 0.55 GO gate: below it the safety layer blocks GO</Text>
        </View>

        {d.safety_overrides.length > 0 && (
          <View style={[st.alert, { backgroundColor: C.inspectTint, borderColor: C.INSPECT }]}>
            <Text style={st.alertTitle}>Safety layer overruled the model</Text>
            {d.safety_overrides.map(o => <Text key={o} style={st.alertText}>• {o}</Text>)}
          </View>
        )}
        {d.window && (
          <View style={[st.alert, { backgroundColor: C.accentSoft, borderColor: C.accent }]}>
            <Text style={st.alertTitle}>Window</Text>
            <Text style={st.alertText}>
              days {d.window.start_day_offset}–{d.window.end_day_offset} from now — {d.window.reason}
            </Text>
          </View>
        )}
        {d.clarifying_question && (
          <View style={[st.alert, { backgroundColor: C.waitTint, borderColor: C.WAIT }]}>
            <Text style={st.alertTitle}>Clarifying question</Text>
            <Text style={st.alertText}>{d.clarifying_question}</Text>
          </View>
        )}

        <View>
          <SectionLabel>WHY</SectionLabel>
          {d.rationale.map(r => <Text key={r} style={st.body}>• {r}</Text>)}
        </View>
        {d.zone_exceptions.length > 0 && (
          <View>
            <SectionLabel>ZONE EXCEPTIONS</SectionLabel>
            {d.zone_exceptions.map(z => <Text key={z} style={st.body}>• {z}</Text>)}
          </View>
        )}
        {d.alternatives.length > 0 && (
          <View>
            <SectionLabel>ALTERNATIVES</SectionLabel>
            {d.alternatives.map(a => (
              <Text key={a.action} style={st.body}>
                • <Text style={{ fontWeight: "700" }}>{a.action}</Text> — {a.why}
              </Text>
            ))}
          </View>
        )}
        <View style={st.tileRow}>
          <View style={st.tile}>
            <Text style={st.tileLabel}>INPUT $ AT RISK IF MISTIMED</Text>
            <Text style={[st.tileValue, MONO]}>
              ${Math.round(d.cost_of_error_aud_per_ha_low)}–{Math.round(d.cost_of_error_aud_per_ha_high)}
            </Text>
            <Text style={st.tiny}>AUD/ha, demo estimate</Text>
          </View>
          {d.follow_up && (
            <View style={st.tile}>
              <Text style={st.tileLabel}>FOLLOW-UP</Text>
              <Text style={st.tileValue}>in {d.follow_up.in_days} d</Text>
              <Text style={st.tiny}>{d.follow_up.action}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- differential
function Differential({ res }) {
  return (
    <View style={st.card}>
      <Text style={st.cardKicker}>DIFFERENTIAL — RETRIEVED FOR AND AGAINST EACH CAUSE</Text>
      {res.decision.hypotheses.map((h, i) => (
        <View key={h.cause} style={{ marginTop: i === 0 ? 10 : 14 }}>
          <View style={st.confRow}>
            <Text style={st.hypName}>{cap(h.cause)}</Text>
            <Text style={[st.hypPct, MONO]}>{Math.round(h.likelihood * 100)}%</Text>
          </View>
          <View style={st.confTrack}>
            <View style={[st.confFill, {
              width: `${Math.min(100, h.likelihood * 100)}%`,
              backgroundColor: i === 0 ? C.accent : C.line2,
            }]} />
          </View>
          {h.evidence_for.map(e => (
            <Text key={e} style={st.evFor}>+ <Text style={st.evText}>{e}</Text></Text>
          ))}
          {h.evidence_against.map(e => (
            <Text key={e} style={st.evAgainst}>− <Text style={st.evText}>{e}</Text></Text>
          ))}
        </View>
      ))}
      <View style={{ marginTop: 14 }}>
        <Collapsible title="Observation — perception output, no diagnosis">
          <Text style={[st.json, MONO]}>{JSON.stringify(res.observation, null, 2)}</Text>
        </Collapsible>
        <Collapsible title="Derived signals — deterministic">
          <Text style={[st.json, MONO]}>{JSON.stringify(res.signals, null, 2)}</Text>
        </Collapsible>
        <Collapsible title={`Retrieved guidelines (${res.retrieved_ids.length})`}>
          <Text style={st.tiny}>
            Hypothesis-driven retrieval pulls the chunk that lets the system reject a
            lookalike cause — not just the one that confirms the leader.
          </Text>
          {res.retrieved_ids.map(cid => (
            <View key={cid} style={st.guideline}>
              <Text style={st.body}>
                <Text style={[MONO, { fontWeight: "700" }]}>[{cid}]</Text> {E.CORPUS[cid].text}
              </Text>
              <Text style={st.tiny}>{E.CORPUS[cid].source}</Text>
            </View>
          ))}
        </Collapsible>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- advisor screen
function Advisor() {
  const [sel, setSel] = useState(TOUR[0]);
  const [showAll, setShowAll] = useState(false);
  const [useRet, setUseRet] = useState(true);
  const [useSafety, setUseSafety] = useState(true);
  const [custom, setCustom] = useState(CUSTOM_DEFAULTS);
  const [result, setResult] = useState(null);
  const [reveal, setReveal] = useState(0);
  const timers = useRef([]);

  const input = sel === "custom" ? buildCustomInput(custom) : byId[sel].input;
  const title = sel === "custom" ? "Custom paddock" : byId[sel].title;

  const pick = id => {
    setSel(id); setResult(null); setReveal(0);
    timers.current.forEach(clearTimeout); timers.current = [];
  };
  const setC = patch => { setCustom({ ...custom, ...patch }); setResult(null); };

  const run = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    const res = E.runPipeline(input, { useRetrieval: useRet, applySafetyLayer: useSafety });
    setResult(res); setReveal(0);
    res.trace.forEach((_, i) => {
      timers.current.push(setTimeout(() => setReveal(i + 1), 120 + i * 260));
    });
  };

  const obs = input.observation;
  const probe = input.weather.find(d => d.day_offset === 0);
  const vwc = probe && probe.soil_vwc !== null && probe.soil_vwc !== undefined ? probe.soil_vwc : null;

  const padBtn = id => (
    <Pressable key={id} onPress={() => pick(id)}
      style={[st.padBtn, sel === id && st.padBtnOn]}>
      <Text style={[st.padBtnId, MONO]}>{id === "custom" ? "CUSTOM" : id}</Text>
      <Text style={[st.padBtnTitle, sel === id && { color: C.ink }]}>
        {id === "custom" ? "Describe a paddock and run the engine on it" : byId[id].title}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={st.card}>
        <Text style={st.cardKicker}>PADDOCKS · DEMO TOUR</Text>
        <View style={{ marginTop: 8 }}>
          {TOUR.map(padBtn)}
          {padBtn("custom")}
          <Pressable onPress={() => setShowAll(!showAll)} style={st.moreBtn}>
            <Text style={st.moreBtnText}>
              {showAll ? "▾ Hide" : "▸ Show"} the other {REST.length} evaluation scenarios
            </Text>
          </Pressable>
          {showAll && REST.map(padBtn)}
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.cardKicker}>ENGINE</Text>
        <SwitchRow label="Use retrieval (RAG)" value={useRet}
          onChange={v => { setUseRet(v); setResult(null); }} />
        <SwitchRow label="Apply safety layer" value={useSafety}
          onChange={v => { setUseSafety(v); setResult(null); }} />
        <Text style={st.tiny}>
          Reasoner: deterministic — runs entirely on this phone. Turning a toggle off
          shows the ablation the evaluation measures.
        </Text>
      </View>

      {sel === "custom" && (
        <View style={st.card}>
          <Text style={st.cardKicker}>CUSTOM PADDOCK — WHEAT, Z31, UREA TOP-DRESS</Text>
          <View style={{ marginTop: 10 }}>
            <SwitchRow label="Field observation available" value={custom.hasObs}
              onChange={v => setC({ hasObs: v })} />
            {custom.hasObs && (
              <View>
                <Field label="Yellowing on which leaves">
                  <ChipSelect options={["older", "younger", "all", "unknown"]}
                    value={custom.leaf} onChange={v => setC({ leaf: v })} />
                </Field>
                <Field label="Colour pattern">
                  <ChipSelect options={["uniform_chlorosis", "interveinal", "necrosis", "none", "unknown"]}
                    value={custom.colour} onChange={v => setC({ colour: v })} />
                </Field>
                <Field label="Where in the paddock">
                  <ChipSelect options={["patchy", "uniform", "along_lines", "low_lying", "unknown"]}
                    value={custom.dist} onChange={v => setC({ dist: v })} />
                </Field>
                <Field label="Crop vigour">
                  <ChipSelect options={["poor", "moderate", "good", "unknown"]}
                    value={custom.vigour} onChange={v => setC({ vigour: v })} />
                </Field>
                <SwitchRow label="Visible waterlogging cues" value={custom.cues}
                  onChange={v => setC({ cues: v })} />
              </View>
            )}
            <Field label="Soil type">
              <ChipSelect options={["sand", "loamy_sand", "sandy_loam", "duplex", "clay_loam", "clay"]}
                value={custom.soil} onChange={v => setC({ soil: v })} />
            </Field>
            <Field label="Internal drainage">
              <ChipSelect options={["poor", "moderate", "good"]}
                value={custom.drainage} onChange={v => setC({ drainage: v })} />
            </Field>
            <SwitchRow label="Symptom sits in a low-lying strip" value={custom.lowlying}
              onChange={v => setC({ lowlying: v })} />
            <View style={st.numGrid}>
              <Field label="Rain last 7 d (mm)">
                <NumInput value={custom.past7} onChange={v => setC({ past7: v })} />
              </Field>
              <Field label="Daytime max (°C)">
                <NumInput value={custom.tmax} onChange={v => setC({ tmax: v })} />
              </Field>
              <Field label="Forecast rain (mm)">
                <NumInput value={custom.futmm} onChange={v => setC({ futmm: v })} />
              </Field>
              <Field label="…on day (0–6)">
                <NumInput value={custom.futday} onChange={v => setC({ futday: v })} />
              </Field>
              <Field label="Probe VWC (blank = none)">
                <NumInput value={custom.vwc} onChange={v => setC({ vwc: v })} />
              </Field>
              <Field label="Urea rate (kg/ha)">
                <NumInput value={custom.rate} onChange={v => setC({ rate: v })} />
              </Field>
            </View>
          </View>
        </View>
      )}

      <View style={st.card}>
        <Text style={st.padTitle}>{title}</Text>
        <View style={st.chipsWrap}>
          <Chip>wheat · Z{input.zadoks_stage}</Chip>
          <Chip>{cap(input.soil.soil_type)} · {input.soil.internal_drainage} drainage</Chip>
          <Chip>{input.plan.product} {Math.round(input.plan.rate_kg_ha)} kg/ha</Chip>
          {vwc !== null && <Chip>probe VWC {vwc.toFixed(2)}{vwc >= 0.42 ? " · saturated" : ""}</Chip>}
          {input.soil.low_lying_strip && <Chip>low-lying strip</Chip>}
          {obs === null && <Chip>no photo — signals only</Chip>}
        </View>
        {!!input.farmer_note && <Text style={st.note}>Farmer note: “{input.farmer_note}”</Text>}
      </View>

      <RainChart input={input} />

      <Pressable onPress={run} style={st.runBtn}>
        <Text style={st.runBtnText}>Check this application</Text>
      </Pressable>

      {result && (
        <View style={{ gap: 14 }}>
          <Trace trace={result.trace} reveal={reveal} />
          {reveal >= result.trace.length && (
            <View style={{ gap: 14 }}>
              <Decision res={result} />
              <Differential res={result} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- evaluation screen
function Evaluation() {
  const r = useMemo(() => E.runEval(DATA.scenarios), []);
  const fmt = v => (v === null ? "–" : String(v));
  return (
    <View style={{ gap: 14 }}>
      <View style={st.tileRow}>
        <View style={[st.tile, { flex: 1 }]}>
          <Text style={st.tileLabel}>NAIVE BASELINE, UNSAFE GOs</Text>
          <Text style={st.tileValue}>
            {r.safety_demo_naive_unsafe_before}% → <Text style={{ color: C.accent }}>
            {r.safety_demo_naive_unsafe_after}%</Text>
          </Text>
          <Text style={st.tiny}>after the deterministic safety layer</Text>
        </View>
        <View style={[st.tile, { flex: 1 }]}>
          <Text style={st.tileLabel}>REASONER UNSAFE RATE</Text>
          <Text style={[st.tileValue, { color: C.accent }]}>{r.reasoner_unsafe_rate}%</Text>
          <Text style={st.tiny}>safe by construction</Text>
        </View>
      </View>
      <View style={st.tileRow}>
        <View style={[st.tile, { flex: 1 }]}>
          <Text style={st.tileLabel}>DECISION ACCURACY (FULL)</Text>
          <Text style={st.tileValue}>{r.arms[2].decision_acc}%</Text>
          <Text style={st.tiny}>vs {r.arms[0].decision_acc}% naive threshold</Text>
        </View>
        <View style={[st.tile, { flex: 1 }]}>
          <Text style={st.tileLabel}>CONSISTENCY, 3 RUNS</Text>
          <Text style={st.tileValue}>{r.consistency_full}%</Text>
          <Text style={st.tiny}>same call every run</Text>
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.cardKicker}>ABLATION — 25 SCENARIOS, COMPUTED ON THIS PHONE</Text>
        {r.arms.map((a, i) => (
          <View key={a.arm} style={[st.armRow, i === 2 && { backgroundColor: C.accentSoft }]}>
            <Text style={[st.armName, i === 2 && { fontWeight: "700", color: C.ink }]}>{a.arm}</Text>
            <View style={st.armStats}>
              <Text style={[st.armStat, MONO]}>dec {a.decision_acc}%</Text>
              <Text style={[st.armStat, MONO]}>top {fmt(a.top_hyp_acc)}%</Text>
              <Text style={[st.armStat, MONO]}>unsafe {a.unsafe_rate}%</Text>
              <Text style={[st.armStat, MONO]}>ret {fmt(a.retrieval_hit)}%</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={st.card}>
        <Text style={st.cardKicker}>PER-SCENARIO — FULL PIPELINE</Text>
        {r.detail.map(d => (
          <View key={d.id} style={st.detailRow}>
            <Text style={[st.detailId, MONO]}>{d.id}</Text>
            <View style={[st.badge, { backgroundColor: C[d.call] }]}>
              <Text style={st.badgeText}>{d.call}</Text>
            </View>
            <Text style={[st.detailConf, MONO]}>{d.conf.toFixed(2)}</Text>
            <Text style={{ color: d.ok ? C.accent : C.INSPECT, fontWeight: "700" }}>
              {d.ok ? "✓" : "✗"}
            </Text>
          </View>
        ))}
      </View>

      <View style={[st.alert, { backgroundColor: C.waitTint, borderColor: C.WAIT }]}>
        <Text style={st.alertTitle}>Honesty note</Text>
        <Text style={st.alertText}>
          Rules-only scores 100% partly because these scenarios were authored alongside
          the heuristic — this is a consistency and architecture check, not proof of field
          accuracy. The generalisation test is the LLM arm plus ≥50 agronomist-labelled
          cases, the first post-hackathon task.
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- root
export default function App() {
  const [view, setView] = useState("advisor");
  return (
    <SafeAreaView style={st.safe}>
      <ExpoStatusBar style="light" />
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <View style={st.header}>
          <Text style={st.wordmark}>greenlight<Text style={{ color: C.accent }}>.</Text></Text>
          <Text style={st.tagline}>
            The go / wait / switch / inspect layer for farm input decisions.
          </Text>
          <View style={st.tabs}>
            {["advisor", "eval"].map(v => (
              <Pressable key={v} onPress={() => setView(v)}
                style={[st.tab, view === v && st.tabOn]}>
                <Text style={[st.tabText, view === v && st.tabTextOn]}>
                  {v === "advisor" ? "Advisor" : "Evaluation"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {view === "advisor" ? <Advisor /> : <Evaluation />}
        <Text style={st.footer}>
          Full deterministic Greenlight engine running on-device — the same reasoner,
          retrieval and safety net as the Python pipeline, verified to reproduce its
          decisions on all 25 evaluation scenarios. Prices and thresholds are demo
          defaults; guideline chunks are placeholders for cited GRDC / AgVic text.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- styles
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: StatusBar.currentHeight || 0 },
  scroll: { padding: 14, paddingBottom: 48 },
  header: { marginBottom: 14 },
  wordmark: { color: C.ink, fontSize: 28, fontWeight: "800" },
  tagline: { color: C.ink2, fontSize: 13, marginTop: 2, marginBottom: 12 },
  tabs: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: 999,
          padding: 3, alignSelf: "flex-start", borderWidth: 1, borderColor: C.line },
  tab: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 999 },
  tabOn: { backgroundColor: C.accent },
  tabText: { color: C.ink2, fontWeight: "600", fontSize: 13 },
  tabTextOn: { color: C.accentInk },

  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
          borderColor: C.line, padding: 14 },
  cardKicker: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  sectionLabel: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1,
                  marginBottom: 4 },
  body: { color: C.ink, fontSize: 14, lineHeight: 20, marginBottom: 3 },
  dim: { color: C.ink2, fontSize: 13 },
  tiny: { color: C.muted, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  note: { color: C.muted, fontSize: 13, fontStyle: "italic", marginTop: 8 },

  padBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 2 },
  padBtnOn: { backgroundColor: C.accentSoft },
  padBtnId: { color: C.muted, fontSize: 10.5, letterSpacing: 0.5 },
  padBtnTitle: { color: C.ink2, fontSize: 13.5, lineHeight: 18 },
  moreBtn: { paddingVertical: 9, paddingHorizontal: 10 },
  moreBtnText: { color: C.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
               paddingVertical: 7 },
  switchLabel: { color: C.ink2, fontSize: 14, flexShrink: 1, paddingRight: 10 },

  padTitle: { color: C.ink, fontSize: 17, fontWeight: "700", lineHeight: 23, marginBottom: 10 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
          borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  chipText: { color: C.ink2, fontSize: 12 },

  fieldLabel: { color: C.ink2, fontSize: 12, fontWeight: "600", marginBottom: 5 },
  chipSelectRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chipOpt: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
             borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  chipOptOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipOptText: { color: C.ink2, fontSize: 12.5 },
  chipOptTextOn: { color: C.accentInk, fontWeight: "700" },
  numInput: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
              borderRadius: 8, color: C.ink, paddingVertical: 7, paddingHorizontal: 10,
              fontSize: 14 },
  numGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 16 },

  rainLegend: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8,
                flexWrap: "wrap" },
  legendSwatch: { width: 9, height: 9, borderRadius: 2, marginLeft: 8 },
  legendText: { color: C.muted, fontSize: 11 },
  rainRow: { flexDirection: "row", height: 64, alignItems: "flex-end", marginTop: 10 },
  rainCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center" },
  rainBar: { width: "62%", borderRadius: 3 },
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: C.muted,
               opacity: 0.6 },
  rainAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { color: C.muted, fontSize: 10, fontFamily: "Menlo" },
  rainTip: { color: C.ink2, fontSize: 12, marginTop: 8, minHeight: 16 },

  runBtn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 13,
            alignItems: "center" },
  runBtnText: { color: C.accentInk, fontSize: 16, fontWeight: "700" },

  traceRow: { flexDirection: "row", gap: 10, paddingVertical: 7, alignItems: "flex-start",
              borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  traceNum: { color: C.muted, fontSize: 11, width: 14, marginTop: 1 },
  traceName: { color: C.ink, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, width: 92 },
  traceDetail: { color: C.ink2, fontSize: 11.5, flex: 1, lineHeight: 16 },

  callWord: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: 1 },
  callExpl: { color: "#fff", fontSize: 13.5, opacity: 0.95, marginTop: 3 },
  confRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  confTrack: { height: 8, borderRadius: 4, backgroundColor: C.surface3 },
  confFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  confTick: { position: "absolute", left: "55%", top: -3, bottom: -3, width: 2,
              backgroundColor: C.muted },

  alert: { borderWidth: 1, borderRadius: 8, padding: 11 },
  alertTitle: { color: C.ink, fontWeight: "700", fontSize: 13.5, marginBottom: 3 },
  alertText: { color: C.ink2, fontSize: 13, lineHeight: 18 },

  tileRow: { flexDirection: "row", gap: 10 },
  tile: { flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
          borderRadius: 8, padding: 11 },
  tileLabel: { color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  tileValue: { color: C.ink, fontSize: 19, fontWeight: "800", marginTop: 3 },

  hypName: { color: C.ink, fontSize: 14, fontWeight: "600", textTransform: "capitalize" },
  hypPct: { color: C.ink, fontSize: 14, fontWeight: "700" },
  evFor: { color: C.accent, fontSize: 12.5, marginTop: 4, fontWeight: "700" },
  evAgainst: { color: C.INSPECT, fontSize: 12.5, marginTop: 4, fontWeight: "700" },
  evText: { color: C.ink2, fontWeight: "400" },

  collapse: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  collapseHead: { flexDirection: "row", justifyContent: "space-between",
                  paddingVertical: 11 },
  collapseTitle: { color: C.ink2, fontSize: 13, fontWeight: "600" },
  collapseBody: { paddingBottom: 12 },
  json: { color: C.ink2, fontSize: 11, lineHeight: 16, backgroundColor: C.surface2,
          borderRadius: 8, padding: 10 },
  guideline: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10,
               marginTop: 8 },

  armRow: { paddingVertical: 9, paddingHorizontal: 8, borderRadius: 8, marginTop: 6 },
  armName: { color: C.ink2, fontSize: 13.5, marginBottom: 4 },
  armStats: { flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
  armStat: { color: C.ink2, fontSize: 12 },

  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6,
               borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  detailId: { color: C.ink2, fontSize: 11.5, flex: 1 },
  badge: { borderRadius: 5, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  detailConf: { color: C.muted, fontSize: 12, width: 40, textAlign: "right" },

  footer: { color: C.muted, fontSize: 11.5, lineHeight: 17, marginTop: 22 },
});
