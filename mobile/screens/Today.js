/* Today: what needs doing. Alerts on top, actions below, one big CTA. */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, T } from "../theme";
import { useStore } from "../store";

const HOUR = 3600000;

function when(due) {
  const now = Date.now();
  const d = new Date(due);
  const time = d.getHours() <= 11 ? "morning" : "afternoon";
  const days = Math.floor((due - new Date(now).setHours(0, 0, 0, 0)) / (24 * HOUR));
  if (days <= 0) return `today, ${time}`;
  if (days === 1) return `tomorrow, ${time}`;
  return `in ${days} days`;
}

export default function Today({ go }) {
  const { state, dispatch } = useStore();
  const paddock = id => state.paddocks.find(p => p.id === id) || { name: "?" };
  const unread = state.alerts.filter(a => !a.read);
  const open = state.actions.filter(a => a.status === "scheduled").sort((a, b) => a.due - b.due);
  const KIND_ICON = { apply: "🚜", recheck: "🔄", inspect: "👀" };

  return (
    <View style={{ gap: 12 }}>
      {unread.length > 0 && (
        <View style={[T.card, { borderColor: C.WAIT, gap: 10 }]}>
          {unread.map(a => (
            <Pressable key={a.id} onPress={() => go("paddock", { id: a.paddockId })}>
              <Text style={s.alertText}>⚠ {a.message}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => dispatch({ type: "readAlerts" })} hitSlop={8}>
            <Text style={[T.tiny, { color: C.accent }]}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      {open.length === 0 ? (
        <View style={[T.card, { alignItems: "center", paddingVertical: 36, gap: 6 }]}>
          <Text style={T.h2}>Nothing scheduled</Text>
          <Text style={T.dim}>Run a field check to get a call.</Text>
        </View>
      ) : (
        open.map(a => (
          <View key={a.id} style={[T.card, s.actionRow]}>
            <Text style={{ fontSize: 26 }}>{KIND_ICON[a.kind] || "•"}</Text>
            <Pressable style={{ flex: 1 }} onPress={() => go("paddock", { id: a.paddockId })}>
              <Text style={T.body} numberOfLines={2}>{a.title}</Text>
              <Text style={T.tiny}>{paddock(a.paddockId).name} · {when(a.due)}</Text>
            </Pressable>
            <Pressable onPress={() => dispatch({ type: "setActionStatus", id: a.id, status: "done" })}
              style={s.doneBtn} hitSlop={6}>
              <Text style={s.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        ))
      )}

      <Pressable onPress={() => go("check")} style={[T.bigBtn, { paddingVertical: 22 }]}>
        <Text style={T.bigBtnText}>+ New field check</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  alertText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  doneBtn: { borderWidth: 1.5, borderColor: C.accent, borderRadius: 10,
             paddingVertical: 10, paddingHorizontal: 16 },
  doneBtnText: { color: C.accent, fontWeight: "800", fontSize: 15 },
});
