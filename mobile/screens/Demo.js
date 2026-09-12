/* Demo & evaluation area (for judges): the 25 deterministic scenarios, the
   ablation numbers, and demo weather control for the live storyline. */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, MONO, T } from "../theme";
import { CallBadge, Chips } from "../components";
import { useStore } from "../store";

const E = require("../engine.js");
const DATA = require("../data.js");

const byId = {};
DATA.scenarios.forEach(s => { byId[s.id] = s; });

export default function Demo({ go, setDemoCheck }) {
  const { state, dispatch } = useStore();
  const [showAll, setShowAll] = useState(false);
  const r = useMemo(() => E.runEval(DATA.scenarios), []);

  const runScenario = (s) => {
    const res = E.runPipeline(s.input, { useRetrieval: true, applySafetyLayer: true });
    setDemoCheck({
      id: `demo-${s.id}`, paddockId: null, paddockName: s.title, ts: Date.now(),
      text: s.title, photoUri: null, observation: s.input.observation,
      signals: res.signals, retrieved_ids: res.retrieved_ids, trace: res.trace,
      decision: res.decision, weatherSource: "scenario weather",
      weatherDays: s.input.weather, interpSource: "scenario (structured)",
    });
    go("result", { demo: true });
  };

  const shown = showAll ? DATA.scenarios : DATA.scenarios.slice(0, 8);

  return (
    <View style={{ gap: 12 }}>
      <View style={T.card}>
        <Text style={T.kicker}>DEMO WEATHER</Text>
        <View style={{ marginTop: 10 }}>
          <Chips value={state.weatherMode}
            onChange={mode => dispatch({ type: "weatherMode", mode })}
            options={[["wet", "Wet week"], ["drying", "Drying out"], ["live", "Live"]]} />
        </View>
        <Text style={[T.tiny, { marginTop: 8 }]}>
          Storyline: check a soaked paddock on “Wet week” (→ WAIT, recheck scheduled),
          then switch to “Drying out” and pull down on Today — Greenlight flips to GO
          and raises the window-open alert.
        </Text>
      </View>

      <View style={T.card}>
        <Text style={T.kicker}>ACCURACY — 25 SCENARIOS, SCORED ON THIS PHONE</Text>
        <View style={[s.statRow, { marginTop: 10 }]}>
          <View style={s.stat}>
            <Text style={s.statVal}>{r.arms[2].decision_acc}%</Text>
            <Text style={T.tiny}>right call (naive {r.arms[0].decision_acc}%)</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statVal}>
              {r.safety_demo_naive_unsafe_before}%→<Text style={{ color: C.accent }}>{r.safety_demo_naive_unsafe_after}%</Text>
            </Text>
            <Text style={T.tiny}>unsafe calls, naive → with safety net</Text>
          </View>
        </View>
        <Text style={[T.tiny, { marginTop: 8 }]}>
          Scenarios were written with the rules — a consistency check, not field proof.
        </Text>
      </View>

      <View style={T.card}>
        <Text style={T.kicker}>RUN A SCENARIO</Text>
        <View style={{ marginTop: 6 }}>
          {shown.map(sc => {
            const det = r.detail.find(d => d.id === sc.id);
            return (
              <Pressable key={sc.id} onPress={() => runScenario(sc)} style={s.scRow}>
                <Text style={[T.dim, { flex: 1 }]} numberOfLines={1}>{sc.title}</Text>
                <CallBadge call={det.call} />
                <Text style={{ color: det.ok ? C.accent : C.INSPECT, fontWeight: "800" }}>
                  {det.ok ? "✓" : "✗"}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setShowAll(!showAll)} style={{ paddingVertical: 10 }}>
            <Text style={[T.tiny, { color: C.accent, fontWeight: "700" }]}>
              {showAll ? "Show fewer" : `Show all ${DATA.scenarios.length}`}
            </Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => dispatch({ type: "reset" })} style={s.resetBtn}>
        <Text style={[T.tiny, { color: C.INSPECT, fontWeight: "700" }]}>
          Reset app data (fresh demo)
        </Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  statRow: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: C.surface2, borderRadius: 10, padding: 12,
          borderWidth: 1, borderColor: C.line },
  statVal: { color: C.ink, fontSize: 20, fontWeight: "800", ...MONO },
  scRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
           borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  resetBtn: { alignItems: "center", paddingVertical: 10 },
});
