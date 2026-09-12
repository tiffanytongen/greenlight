/* Greenlight mobile (Expo Go). Same deterministic engine as the Python
   pipeline (engine.js, verified on all 25 eval scenarios). No extra deps. */
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
  waitTint: "#2E2818", inspectTint: "#331F1C",
};
const CALL_EXPL = {
  GO: "Spread as planned.",
  WAIT: "Hold. You'd lose most of it.",
  SWITCH: "Wrong product for the cause.",
  INSPECT: "Check in person first.",
};
const MONO = { fontFamily: "Menlo", fontVariant: ["tabular-nums"] };
const cap = s => String(s).replace(/_/g, " ");

const byId = {};
DATA.scenarios.forEach(s => { byId[s.id] = s; });

const EXAMPLES = [
  { id: "S07_adversarial_waterlog", name: "Waterlogged lookalike" },
  { id: "S02_true_N_go", name: "Clean go" },
  { id: "S03_N_leaching_wait", name: "Big rain coming" },
  { id: "S05_sulfur", name: "Sulfur, not N" },
  { id: "S24_volat_hot_windy", name: "Hot and dry" },
  { id: "S09_missing_obs_saturated", name: "No photo, wet probe" },
];

// ---------------------------------------------------------------- form → engine input
const FORM_DEFAULTS = {
  seen: true, leaf: "older", pattern: "uniform_chlorosis", where: "uniform",
  vigour: "moderate", wet_look: false,
  soil: "duplex", drainage: "moderate", lowlying: false,
  past7: "10", futmm: "8", futday: "1", tmax: "17", vwc: "", rate: "130",
};

function buildInput(f) {
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const tmax = num(f.tmax, 17), past7 = num(f.past7, 0), futmm = num(f.futmm, 0);
  const futday = Math.min(6, Math.max(0, Math.round(num(f.futday, 1))));
  const rate = num(f.rate, 130);
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
    wind_kmh: 8, soil_vwc: i === 0 && f.vwc.trim() !== "" ? num(f.vwc, null) : null,
  });
  return {
    paddock: "yours", crop: "wheat", zadoks_stage: 31,
    soil: { soil_type: f.soil, internal_drainage: f.drainage, low_lying_strip: f.lowlying },
    plan: { kind: "nitrogen", product: "urea", rate_kg_ha: rate,
            n_rate_kg_ha: rate * 0.46, intended_date_offset_days: 0 },
    observation: f.seen ? {
      leaf_position: f.leaf, colour_pattern: f.pattern, distribution: f.where,
      vigour: f.vigour, waterlogging_cues: f.wet_look, image_quality: 0.8, notes: "",
    } : null,
    farmer_note: "", history: [], cases: [], weather,
  };
}

// ---------------------------------------------------------------- small pieces
function Chips({ options, value, onChange }) {
  return (
    <View style={st.chipRow}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)}
          style={[st.chipOpt, value === v && st.chipOptOn]}>
          <Text style={[st.chipOptText, value === v && st.chipOptTextOn]}>{label}</Text>
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

function Num({ value, onChange }) {
  return (
    <TextInput value={value} onChangeText={onChange} keyboardType="numeric"
      style={st.numInput} placeholderTextColor={C.muted} />
  );
}

function Row({ label, value, onChange }) {
  return (
    <View style={st.switchRow}>
      <Text style={st.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: C.surface3, true: C.accent }}
        thumbColor="#F5F7F2" ios_backgroundColor={C.surface3} />
    </View>
  );
}

function Fold({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={st.fold}>
      <Pressable onPress={() => setOpen(!open)} style={st.foldHead}>
        <Text style={st.foldTitle}>{title}</Text>
        <Text style={{ color: C.muted }}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && <View style={{ paddingBottom: 12 }}>{children}</View>}
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
      <View style={st.rainHead}>
        <Text style={st.kicker}>RAIN · 14 DAYS BACK, 7 AHEAD</Text>
        <Text style={st.legendText}>▢ 5–15 mm soaks urea in</Text>
      </View>
      <View style={st.rainRow}>
        {days.map(d => {
          const h = Math.max(d.precip_mm > 0 ? 4 : 2, (d.precip_mm / maxMM) * 56);
          const incorp = d.day_offset >= app && d.day_offset <= app + 4 &&
            d.precip_mm >= 5 && d.precip_mm <= 15;
          return (
            <Pressable key={d.day_offset} style={st.rainCol} onPress={() => setTip(
              `Day ${d.day_offset >= 0 ? "+" : ""}${d.day_offset}: ${d.precip_mm} mm, ${d.tmax_c}°C` +
              (d.soil_vwc !== null && d.soil_vwc !== undefined ? `, probe ${d.soil_vwc}` : ""))}>
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
      {tip && <Text style={st.rainTip}>{tip}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------- result
function Result({ res, reveal }) {
  const d = res.decision;
  const confPct = Math.round(d.confidence * 100);
  const callColor = C[d.call];
  const done = reveal >= res.trace.length;
  return (
    <View style={{ gap: 12 }}>
      <View style={st.card}>
        {res.trace.map((t, i) => (
          <View key={t.stage} style={[st.traceRow, i >= reveal && { opacity: 0.15 }]}>
            <Text style={st.traceName}>{t.stage}</Text>
            <Text style={[st.traceDetail, MONO]}>{t.detail}</Text>
          </View>
        ))}
      </View>

      {done && (
        <View style={[st.card, { padding: 0, overflow: "hidden" }]}>
          <View style={{ backgroundColor: callColor, padding: 16 }}>
            <Text style={st.callWord}>{d.call}</Text>
            <Text style={st.callExpl}>{CALL_EXPL[d.call]}</Text>
          </View>
          <View style={{ padding: 14, gap: 12 }}>
            <View>
              <View style={st.between}>
                <Text style={st.dim}>Confidence</Text>
                <Text style={[st.dim, MONO]}>{confPct}%</Text>
              </View>
              <View style={st.track}>
                <View style={[st.fill, { width: `${confPct}%`, backgroundColor: callColor }]} />
                <View style={st.tick} />
              </View>
            </View>

            {d.safety_overrides.length > 0 && (
              <View style={[st.alert, { backgroundColor: C.inspectTint, borderColor: C.INSPECT }]}>
                <Text style={st.alertTitle}>Safety override</Text>
                {d.safety_overrides.map(o => <Text key={o} style={st.alertText}>{o}</Text>)}
              </View>
            )}
            {d.window && (
              <View style={[st.alert, { backgroundColor: C.accentSoft, borderColor: C.accent }]}>
                <Text style={st.alertText}>
                  <Text style={st.alertTitle}>Window: </Text>
                  day {d.window.start_day_offset}
                  {d.window.end_day_offset !== d.window.start_day_offset
                    ? `–${d.window.end_day_offset}` : ""} — {d.window.reason}
                </Text>
              </View>
            )}
            {d.clarifying_question && (
              <View style={[st.alert, { backgroundColor: C.waitTint, borderColor: C.WAIT }]}>
                <Text style={st.alertText}>{d.clarifying_question}</Text>
              </View>
            )}

            {d.rationale.map(r => <Text key={r} style={st.body}>• {r}</Text>)}

            <View style={st.tileRow}>
              <View style={st.tile}>
                <Text style={st.tileLabel}>$ AT RISK IF MISTIMED</Text>
                <Text style={[st.tileValue, MONO]}>
                  ${Math.round(d.cost_of_error_aud_per_ha_low)}–{Math.round(d.cost_of_error_aud_per_ha_high)}
                  <Text style={st.tiny}> /ha</Text>
                </Text>
              </View>
              {d.follow_up && (
                <View style={st.tile}>
                  <Text style={st.tileLabel}>RECHECK IN</Text>
                  <Text style={st.tileValue}>{d.follow_up.in_days} days</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {done && (
        <View style={st.card}>
          <Text style={st.kicker}>LIKELY CAUSE</Text>
          {d.hypotheses.map((h, i) => (
            <View key={h.cause} style={{ marginTop: i === 0 ? 10 : 14 }}>
              <View style={st.between}>
                <Text style={st.hypName}>{cap(h.cause)}</Text>
                <Text style={[st.hypPct, MONO]}>{Math.round(h.likelihood * 100)}%</Text>
              </View>
              <View style={st.track}>
                <View style={[st.fill, {
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
            <Fold title="Signals">
              <Text style={[st.json, MONO]}>{JSON.stringify(res.signals, null, 2)}</Text>
            </Fold>
            <Fold title={`Guidelines used (${res.retrieved_ids.length})`}>
              {res.retrieved_ids.map(cid => (
                <View key={cid} style={st.guideline}>
                  <Text style={st.body}>{E.CORPUS[cid].text}</Text>
                </View>
              ))}
            </Fold>
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- check screen
function Check() {
  const [f, setF] = useState(FORM_DEFAULTS);
  const [result, setResult] = useState(null);
  const [source, setSource] = useState(null); // null = your paddock, else example name
  const [input, setInput] = useState(null);
  const [reveal, setReveal] = useState(0);
  const timers = useRef([]);

  const set = patch => { setF({ ...f, ...patch }); setResult(null); };

  const run = (inp, label) => {
    timers.current.forEach(clearTimeout); timers.current = [];
    const res = E.runPipeline(inp, { useRetrieval: true, applySafetyLayer: true });
    setInput(inp); setSource(label); setResult(res); setReveal(0);
    res.trace.forEach((_, i) => {
      timers.current.push(setTimeout(() => setReveal(i + 1), 100 + i * 240));
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={st.card}>
        <Text style={st.kicker}>CROP</Text>
        <View style={{ marginTop: 8 }}>
          <Row label="I've looked at the crop" value={f.seen} onChange={v => set({ seen: v })} />
          {f.seen && (
            <View>
              <Field label="Yellowing shows on">
                <Chips value={f.leaf} onChange={v => set({ leaf: v })} options={[
                  ["older", "old leaves"], ["younger", "new leaves"], ["all", "all"], ["unknown", "not sure"],
                ]} />
              </Field>
              <Field label="Pattern">
                <Chips value={f.pattern} onChange={v => set({ pattern: v })} options={[
                  ["uniform_chlorosis", "even yellow"], ["interveinal", "between veins"],
                  ["necrosis", "dead patches"], ["none", "none"],
                ]} />
              </Field>
              <Field label="Where">
                <Chips value={f.where} onChange={v => set({ where: v })} options={[
                  ["uniform", "whole paddock"], ["patchy", "patches"],
                  ["low_lying", "low spots"], ["along_lines", "spray lines"],
                ]} />
              </Field>
              <Field label="Crop condition">
                <Chips value={f.vigour} onChange={v => set({ vigour: v })} options={[
                  ["poor", "poor"], ["moderate", "ok"], ["good", "good"],
                ]} />
              </Field>
              <Row label="Ponding or waterlogged look" value={f.wet_look}
                onChange={v => set({ wet_look: v })} />
            </View>
          )}
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.kicker}>PADDOCK</Text>
        <View style={{ marginTop: 8 }}>
          <Field label="Soil">
            <Chips value={f.soil} onChange={v => set({ soil: v })} options={[
              ["sand", "sand"], ["sandy_loam", "sandy loam"], ["duplex", "duplex"],
              ["clay_loam", "clay loam"], ["clay", "clay"],
            ]} />
          </Field>
          <Field label="Drainage">
            <Chips value={f.drainage} onChange={v => set({ drainage: v })} options={[
              ["poor", "poor"], ["moderate", "ok"], ["good", "good"],
            ]} />
          </Field>
          <Row label="Trouble spot is low-lying" value={f.lowlying}
            onChange={v => set({ lowlying: v })} />
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.kicker}>WEATHER + PLAN</Text>
        <View style={[st.numGrid, { marginTop: 10 }]}>
          <Field label="Rain last 7 days, mm">
            <Num value={f.past7} onChange={v => set({ past7: v })} />
          </Field>
          <Field label="Rain forecast, mm">
            <Num value={f.futmm} onChange={v => set({ futmm: v })} />
          </Field>
          <Field label="In how many days">
            <Num value={f.futday} onChange={v => set({ futday: v })} />
          </Field>
          <Field label="Max temp, °C">
            <Num value={f.tmax} onChange={v => set({ tmax: v })} />
          </Field>
          <Field label="Probe moisture (if any)">
            <Num value={f.vwc} onChange={v => set({ vwc: v })} />
          </Field>
          <Field label="Urea, kg/ha">
            <Num value={f.rate} onChange={v => set({ rate: v })} />
          </Field>
        </View>
      </View>

      <Pressable onPress={() => run(buildInput(f), null)} style={st.runBtn}>
        <Text style={st.runBtnText}>Get the call</Text>
      </Pressable>

      <View style={st.exampleRow}>
        <Text style={st.tiny}>or try: </Text>
        {EXAMPLES.map(ex => (
          <Pressable key={ex.id} onPress={() => run(byId[ex.id].input, ex.name)}>
            <Text style={st.exampleLink}>{ex.name}</Text>
          </Pressable>
        ))}
      </View>

      {result && (
        <View style={{ gap: 12 }}>
          {source && <Text style={st.sourceNote}>Example: {source}</Text>}
          <RainChart input={input} />
          <Result res={result} reveal={reveal} />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- accuracy screen
function Accuracy() {
  const r = useMemo(() => E.runEval(DATA.scenarios), []);
  return (
    <View style={{ gap: 12 }}>
      <View style={st.tileRow}>
        <View style={st.tile}>
          <Text style={st.tileLabel}>RIGHT CALL</Text>
          <Text style={st.tileValue}>{r.arms[2].decision_acc}%</Text>
          <Text style={st.tiny}>naive rule: {r.arms[0].decision_acc}%</Text>
        </View>
        <View style={st.tile}>
          <Text style={st.tileLabel}>UNSAFE CALLS</Text>
          <Text style={st.tileValue}>
            {r.safety_demo_naive_unsafe_before}% → <Text style={{ color: C.accent }}>
            {r.safety_demo_naive_unsafe_after}%</Text>
          </Text>
          <Text style={st.tiny}>naive rule, then with the safety net</Text>
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.kicker}>25 TEST PADDOCKS, SCORED ON THIS PHONE</Text>
        {r.detail.map(d => (
          <View key={d.id} style={st.detailRow}>
            <Text style={st.detailTitle} numberOfLines={1}>{byId[d.id].title}</Text>
            <View style={[st.badge, { backgroundColor: C[d.call] }]}>
              <Text style={st.badgeText}>{d.call}</Text>
            </View>
            <Text style={{ color: d.ok ? C.accent : C.INSPECT, fontWeight: "700" }}>
              {d.ok ? "✓" : "✗"}
            </Text>
          </View>
        ))}
        <Text style={[st.tiny, { marginTop: 10 }]}>
          Test paddocks were written with the rules, so treat this as a consistency
          check. Field validation with agronomist-labelled cases is next.
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- root
export default function App() {
  const [view, setView] = useState("check");
  return (
    <SafeAreaView style={st.safe}>
      <ExpoStatusBar style="light" />
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <View style={st.header}>
          <View>
            <Text style={st.wordmark}>greenlight<Text style={{ color: C.accent }}>.</Text></Text>
            <Text style={st.tagline}>Spread urea today, or wait?</Text>
          </View>
          <View style={st.tabs}>
            {[["check", "Check"], ["acc", "Accuracy"]].map(([v, label]) => (
              <Pressable key={v} onPress={() => setView(v)}
                style={[st.tab, view === v && st.tabOn]}>
                <Text style={[st.tabText, view === v && st.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {view === "check" ? <Check /> : <Accuracy />}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- styles
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: StatusBar.currentHeight || 0 },
  scroll: { padding: 14, paddingBottom: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
            marginBottom: 14, flexWrap: "wrap", gap: 10 },
  wordmark: { color: C.ink, fontSize: 26, fontWeight: "800" },
  tagline: { color: C.ink2, fontSize: 13, marginTop: 1 },
  tabs: { flexDirection: "row", backgroundColor: C.surface2, borderRadius: 999,
          padding: 3, borderWidth: 1, borderColor: C.line },
  tab: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999 },
  tabOn: { backgroundColor: C.accent },
  tabText: { color: C.ink2, fontWeight: "600", fontSize: 13 },
  tabTextOn: { color: C.accentInk },

  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
          borderColor: C.line, padding: 14 },
  kicker: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  body: { color: C.ink, fontSize: 14, lineHeight: 20 },
  dim: { color: C.ink2, fontSize: 13 },
  tiny: { color: C.muted, fontSize: 11.5, lineHeight: 16 },

  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
               paddingVertical: 6 },
  switchLabel: { color: C.ink2, fontSize: 14, flexShrink: 1, paddingRight: 10 },
  fieldLabel: { color: C.ink2, fontSize: 12, fontWeight: "600", marginBottom: 5 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chipOpt: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
             borderRadius: 999, paddingVertical: 6, paddingHorizontal: 13 },
  chipOptOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipOptText: { color: C.ink2, fontSize: 13 },
  chipOptTextOn: { color: C.accentInk, fontWeight: "700" },
  numInput: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
              borderRadius: 8, color: C.ink, paddingVertical: 7, paddingHorizontal: 10,
              fontSize: 14, width: 100 },
  numGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 18 },

  runBtn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 13,
            alignItems: "center" },
  runBtnText: { color: C.accentInk, fontSize: 16, fontWeight: "700" },
  exampleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center",
                columnGap: 10, rowGap: 4, paddingHorizontal: 2 },
  exampleLink: { color: C.accent, fontSize: 12.5, textDecorationLine: "underline" },
  sourceNote: { color: C.muted, fontSize: 12, fontStyle: "italic" },

  rainHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
              flexWrap: "wrap", gap: 4 },
  legendText: { color: C.muted, fontSize: 11 },
  rainRow: { flexDirection: "row", height: 64, alignItems: "flex-end", marginTop: 10 },
  rainCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center" },
  rainBar: { width: "62%", borderRadius: 3 },
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: C.muted,
               opacity: 0.6 },
  rainAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { color: C.muted, fontSize: 10, fontFamily: "Menlo" },
  rainTip: { color: C.ink2, fontSize: 12, marginTop: 8 },

  traceRow: { flexDirection: "row", gap: 10, paddingVertical: 6, alignItems: "flex-start" },
  traceName: { color: C.ink, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, width: 88 },
  traceDetail: { color: C.ink2, fontSize: 11, flex: 1, lineHeight: 15 },

  callWord: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: 1 },
  callExpl: { color: "#fff", fontSize: 14, opacity: 0.95, marginTop: 2 },
  between: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surface3 },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  tick: { position: "absolute", left: "55%", top: -3, bottom: -3, width: 2,
          backgroundColor: C.muted },

  alert: { borderWidth: 1, borderRadius: 8, padding: 11 },
  alertTitle: { color: C.ink, fontWeight: "700", fontSize: 13 },
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

  fold: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  foldHead: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  foldTitle: { color: C.ink2, fontSize: 13, fontWeight: "600" },
  json: { color: C.ink2, fontSize: 11, lineHeight: 16, backgroundColor: C.surface2,
          borderRadius: 8, padding: 10 },
  guideline: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10,
               marginTop: 8 },

  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7,
               borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  detailTitle: { color: C.ink2, fontSize: 12, flex: 1 },
  badge: { borderRadius: 5, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
