/* Fields list + one paddock's timeline: checks, scheduled and done work, alerts. */
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { C, T } from "../theme";
import { CallBadge } from "../components";
import { useStore } from "../store";

const fmt = ts => {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function Fields({ go }) {
  const { state } = useStore();
  return (
    <View style={{ gap: 12 }}>
      {state.paddocks.map(p => {
        const checks = state.checks.filter(c => c.paddockId === p.id);
        const last = checks[0];
        const openWork = state.actions.filter(a => a.paddockId === p.id && a.status === "scheduled").length;
        return (
          <Pressable key={p.id} onPress={() => go("paddock", { id: p.id })} style={[T.card, s.row]}>
            <View style={{ flex: 1 }}>
              <Text style={T.h2}>{p.name}</Text>
              <Text style={T.tiny}>
                {p.soil.soil_type.replace("_", " ")}, {p.soil.internal_drainage} drainage
                {openWork ? ` · ${openWork} job${openWork > 1 ? "s" : ""} scheduled` : ""}
              </Text>
            </View>
            {last ? <CallBadge call={last.decision.call} /> : <Text style={T.tiny}>no checks</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Paddock({ params, go }) {
  const { state, dispatch } = useStore();
  const p = state.paddocks.find(x => x.id === params.id);
  if (!p) return <Text style={T.dim}>Paddock not found.</Text>;

  const events = [
    ...state.checks.filter(c => c.paddockId === p.id)
      .map(c => ({ ts: c.ts, kind: "check", c })),
    ...state.actions.filter(a => a.paddockId === p.id)
      .map(a => ({ ts: a.due, kind: "action", a })),
    ...state.alerts.filter(al => al.paddockId === p.id)
      .map(al => ({ ts: al.ts, kind: "alert", al })),
  ].sort((x, y) => y.ts - x.ts);

  return (
    <View style={{ gap: 12 }}>
      <View style={T.card}>
        <Text style={T.h1}>{p.name}</Text>
        <Text style={T.dim}>
          {p.soil.soil_type.replace("_", " ")}, {p.soil.internal_drainage} drainage
          {p.soil.low_lying_strip ? ", low-lying strip" : ""}
        </Text>
      </View>

      {events.length === 0 && (
        <View style={[T.card, { alignItems: "center", paddingVertical: 30 }]}>
          <Text style={T.dim}>No history yet.</Text>
        </View>
      )}

      {events.map((e, i) => {
        if (e.kind === "check") {
          return (
            <Pressable key={`c${i}`} style={[T.card, s.row]}
              onPress={() => go("result", { checkId: e.c.id })}>
              {e.c.photoUri
                ? <Image source={{ uri: e.c.photoUri }} style={s.thumb} />
                : <Text style={{ fontSize: 22 }}>📋</Text>}
              <View style={{ flex: 1 }}>
                <Text style={T.dim} numberOfLines={2}>
                  {e.c.text || "Field check (no note)"}
                </Text>
                <Text style={T.tiny}>{fmt(e.ts)} · checked</Text>
              </View>
              <CallBadge call={e.c.decision.call} />
            </Pressable>
          );
        }
        if (e.kind === "action") {
          const a = e.a;
          return (
            <View key={`a${i}`} style={[T.card, s.row]}>
              <Text style={{ fontSize: 22 }}>{a.status === "done" ? "✅" : "🗓"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={T.dim}>{a.title}</Text>
                <Text style={T.tiny}>{fmt(a.due)} · {a.status}</Text>
              </View>
              {a.status === "scheduled" && (
                <Pressable
                  onPress={() => dispatch({ type: "setActionStatus", id: a.id, status: "done" })}
                  style={s.doneBtn} hitSlop={6}>
                  <Text style={s.doneBtnText}>Done</Text>
                </Pressable>
              )}
            </View>
          );
        }
        return (
          <View key={`l${i}`} style={[T.card, s.row, { borderColor: C.WAIT }]}>
            <Text style={{ fontSize: 20 }}>⚠</Text>
            <View style={{ flex: 1 }}>
              <Text style={T.dim}>{e.al.message}</Text>
              <Text style={T.tiny}>{fmt(e.ts)} · alert</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  doneBtn: { borderWidth: 1.5, borderColor: C.accent, borderRadius: 10,
             paddingVertical: 8, paddingHorizontal: 14 },
  doneBtnText: { color: C.accent, fontWeight: "800", fontSize: 14 },
});
