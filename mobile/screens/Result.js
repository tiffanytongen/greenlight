/* Result: the call, one sentence, one action, one button. Everything
   technical lives in "Why?". */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, MONO, T } from "../theme";
import { Differential, Fold, RainChart } from "../components";
import { useStore, uid } from "../store";
import { explain, recommend, dueTimestamp } from "../recommend";
import { speak } from "../ai/speech";

const CALL_LINE = {
  GO: "Good to go.", WAIT: "Not today.", SWITCH: "Wrong tool.", INSPECT: "Go look first.",
};

export default function Result({ params, go, demoCheck }) {
  const { state, dispatch } = useStore();
  const check = demoCheck || state.checks.find(c => c.id === params.checkId);
  const [scheduled, setScheduled] = useState(false);
  if (!check) return <Text style={T.dim}>Check not found.</Text>;

  const paddock = state.paddocks.find(p => p.id === check.paddockId);
  const paddockName = paddock ? paddock.name : (check.paddockName || "Paddock");
  const d = check.decision;
  const sentence = explain(d);
  const rec = recommend(d, paddockName);
  const isDemo = !!demoCheck;

  const schedule = () => {
    if (scheduled || isDemo) return;
    dispatch({
      type: "addAction",
      action: {
        id: uid(), paddockId: check.paddockId, checkId: check.id, kind: rec.schedule.kind,
        title: rec.schedule.title, due: dueTimestamp(rec.schedule.dueOffsetDays, rec.schedule.hour),
        status: "scheduled",
      },
    });
    setScheduled(true);
  };

  const sayIt = () => speak(`${d.call}. ${sentence} ${rec.action}. ${rec.timing}.`);

  return (
    <View style={{ gap: 12 }}>
      <View style={[T.card, { padding: 0, overflow: "hidden" }]}>
        <View style={{ backgroundColor: C[d.call], padding: 20 }}>
          <View style={[T.between, { alignItems: "flex-start" }]}>
            <Text style={s.callWord}>{d.call}</Text>
            <Pressable onPress={sayIt} hitSlop={10}>
              <Text style={{ fontSize: 24 }}>🔊</Text>
            </Pressable>
          </View>
          <Text style={s.callLine}>{CALL_LINE[d.call]}</Text>
        </View>
        <View style={{ padding: 16, gap: 14 }}>
          <Text style={T.body}>{sentence}</Text>
          <View style={s.doRow}>
            <Text style={s.doLabel}>DO</Text>
            <View style={{ flex: 1 }}>
              <Text style={T.body}>{rec.action}</Text>
              <Text style={[T.dim, { marginTop: 2 }]}>{rec.timing}</Text>
            </View>
          </View>
          {d.clarifying_question && (
            <Text style={[T.dim, { fontStyle: "italic" }]}>{d.clarifying_question}</Text>
          )}
          <Pressable onPress={schedule}
            style={[T.bigBtn, (scheduled || isDemo) && { backgroundColor: C.surface3 }]}>
            <Text style={[T.bigBtnText, (scheduled || isDemo) && { color: C.ink2 }]}>
              {isDemo ? "Demo — not saved" : scheduled ? "✓ Scheduled" : "Schedule it"}
            </Text>
          </Pressable>
          {scheduled && (
            <Pressable onPress={() => go("today")} hitSlop={8} style={{ alignItems: "center" }}>
              <Text style={{ color: C.accent, fontWeight: "700", fontSize: 15 }}>See it on Today →</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={T.card}>
        <Fold title="Why?">
          {d.safety_overrides.length > 0 && (
            <View style={[s.alert, { backgroundColor: C.inspectTint, borderColor: C.INSPECT }]}>
              <Text style={s.alertTitle}>Safety rule overrode the model</Text>
              {d.safety_overrides.map(o => <Text key={o} style={s.alertText}>{o}</Text>)}
            </View>
          )}
          {d.rationale.map(r => <Text key={r} style={T.dim}>• {r}</Text>)}
          <View style={T.between}>
            <Text style={T.tiny}>Confidence</Text>
            <Text style={[T.tiny, MONO]}>{Math.round(d.confidence * 100)}%</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round(d.confidence * 100)}%`, backgroundColor: C[d.call] }]} />
            <View style={s.tick} />
          </View>
          <Text style={T.tiny}>Engine won't say GO under 55%.</Text>

          <Text style={[T.kicker, { marginTop: 8 }]}>LIKELY CAUSE</Text>
          <Differential decision={d} />

          {check.weatherDays && check.weatherDays.length > 0 && (
            <View>
              <Text style={[T.kicker, { marginBottom: 8 }]}>WEATHER USED</Text>
              <RainChart days={check.weatherDays} plan={null} />
              <Text style={T.tiny}>{check.weatherSource}</Text>
            </View>
          )}

          <Text style={[T.kicker, { marginTop: 8 }]}>HOW IT READ YOUR INPUT</Text>
          <Text style={T.tiny}>
            {describeObs(check)} Interpreted by {check.interpSource || "local parser"}
            {check.visionUsed ? " + photo analysis" : ""}. The GO/WAIT call itself is
            deterministic rules, not AI.
          </Text>
        </Fold>
      </View>
    </View>
  );
}

function describeObs(check) {
  const o = check.observation;
  if (!o) return "No visual observation — weather and paddock context only.";
  const bits = [];
  if (o.leaf_position !== "unknown") bits.push(`${o.leaf_position} leaves`);
  if (o.colour_pattern !== "unknown" && o.colour_pattern !== "none") bits.push(o.colour_pattern.replace(/_/g, " "));
  if (o.distribution !== "unknown") bits.push(o.distribution.replace(/_/g, " "));
  if (o.waterlogging_cues) bits.push("waterlogging cues");
  return bits.length ? `Read as: ${bits.join(", ")}.` : "No clear visual signals extracted.";
}
const s = StyleSheet.create({
  callWord: { color: "#fff", fontSize: 44, fontWeight: "800", letterSpacing: 1.5 },
  callLine: { color: "#fff", fontSize: 17, opacity: 0.95, marginTop: 2, fontWeight: "600" },
  doRow: { flexDirection: "row", gap: 12, alignItems: "flex-start",
           backgroundColor: C.surface2, borderRadius: 12, padding: 13 },
  doLabel: { color: C.accent, fontWeight: "800", fontSize: 13, marginTop: 3 },
  alert: { borderWidth: 1, borderRadius: 8, padding: 11 },
  alertTitle: { color: C.ink, fontWeight: "700", fontSize: 13, marginBottom: 3 },
  alertText: { color: C.ink2, fontSize: 12.5, lineHeight: 17 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surface3 },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  tick: { position: "absolute", left: "55%", top: -3, bottom: -3, width: 2, backgroundColor: C.muted },
});
