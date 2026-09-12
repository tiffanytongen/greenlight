/* Shared UI pieces. Big targets, minimal text. */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { C, MONO, T } from "./theme";

export function Chips({ options, value, onChange, big }) {
  return (
    <View style={s.chipRow}>
      {options.map(([v, label]) => (
        <Pressable key={String(v)} onPress={() => onChange(v)}
          style={[s.chip, big && s.chipBig, value === v && s.chipOn]}>
          <Text style={[s.chipText, big && s.chipTextBig, value === v && s.chipTextOn]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Fold({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={s.fold}>
      <Pressable onPress={() => setOpen(!open)} style={s.foldHead} hitSlop={8}>
        <Text style={s.foldTitle}>{title}</Text>
        <Text style={{ color: C.muted, fontSize: 16 }}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open && <View style={{ paddingBottom: 12, gap: 10 }}>{children}</View>}
    </View>
  );
}

export function CallBadge({ call, size = "small" }) {
  const big = size === "big";
  return (
    <View style={[s.badge, big && s.badgeBig, { backgroundColor: C[call] }]}>
      <Text style={[s.badgeText, big && s.badgeTextBig]}>{call}</Text>
    </View>
  );
}

export function RainChart({ days, plan }) {
  const [tip, setTip] = useState(null);
  const sorted = [...days].sort((a, b) => a.day_offset - b.day_offset);
  const maxMM = Math.max(10, ...sorted.map(d => d.precip_mm));
  const app = plan ? plan.intended_date_offset_days : 0;
  return (
    <View>
      <View style={T.between}>
        <Text style={T.kicker}>RAIN · 14 BACK, 7 AHEAD</Text>
        <Text style={T.tiny}>▢ 5–15 mm soaks urea in</Text>
      </View>
      <View style={s.rainRow}>
        {sorted.map(d => {
          const h = Math.max(d.precip_mm > 0 ? 4 : 2, (d.precip_mm / maxMM) * 52);
          const incorp = d.day_offset >= app && d.day_offset <= app + 4 &&
            d.precip_mm >= 5 && d.precip_mm <= 15;
          return (
            <Pressable key={d.day_offset} style={s.rainCol} onPress={() => setTip(
              `Day ${d.day_offset >= 0 ? "+" : ""}${d.day_offset}: ${Math.round(d.precip_mm)} mm, ${Math.round(d.tmax_c)}°C` +
              (d.soil_vwc !== null && d.soil_vwc !== undefined ? `, probe ${Number(d.soil_vwc).toFixed(2)}` : ""))}>
              {d.day_offset === 0 && <View style={s.todayLine} />}
              <View style={{ flex: 1 }} />
              <View style={[
                s.rainBar,
                { height: h, backgroundColor: d.precip_mm > 0 ? (d.day_offset < 0 ? C.rainDim : C.rain) : C.line2 },
                incorp && { borderWidth: 2, borderColor: C.accent },
              ]} />
            </Pressable>
          );
        })}
      </View>
      <View style={s.rainAxis}>
        <Text style={s.axisText}>-14d</Text><Text style={s.axisText}>-7d</Text>
        <Text style={s.axisText}>today</Text><Text style={s.axisText}>+6d</Text>
      </View>
      {tip && <Text style={[T.dim, { marginTop: 6, fontSize: 13 }]}>{tip}</Text>}
    </View>
  );
}

export function Differential({ decision }) {
  const cap = x => String(x).replace(/_/g, " ");
  return (
    <View>
      {decision.hypotheses.map((h, i) => (
        <View key={h.cause} style={{ marginTop: i === 0 ? 0 : 12 }}>
          <View style={T.between}>
            <Text style={s.hypName}>{cap(h.cause)}</Text>
            <Text style={[s.hypName, MONO]}>{Math.round(h.likelihood * 100)}%</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, {
              width: `${Math.min(100, h.likelihood * 100)}%`,
              backgroundColor: i === 0 ? C.accent : C.line2,
            }]} />
          </View>
          {h.evidence_for.map(e => (
            <Text key={e} style={s.evFor}>+ <Text style={s.evText}>{e}</Text></Text>
          ))}
          {h.evidence_against.map(e => (
            <Text key={e} style={s.evAgainst}>− <Text style={s.evText}>{e}</Text></Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.line2,
          borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  chipBig: { paddingVertical: 13, paddingHorizontal: 20 },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.ink2, fontSize: 14 },
  chipTextBig: { fontSize: 16 },
  chipTextOn: { color: C.accentInk, fontWeight: "800" },

  fold: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  foldHead: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 13,
              alignItems: "center" },
  foldTitle: { color: C.ink2, fontSize: 15, fontWeight: "700" },

  badge: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 9, alignSelf: "flex-start" },
  badgeBig: { paddingVertical: 5, paddingHorizontal: 13, borderRadius: 8 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  badgeTextBig: { fontSize: 15 },

  rainRow: { flexDirection: "row", height: 60, alignItems: "flex-end", marginTop: 10 },
  rainCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center" },
  rainBar: { width: "62%", borderRadius: 3 },
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: C.muted,
               opacity: 0.6 },
  rainAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { color: C.muted, fontSize: 10, ...MONO },

  track: { height: 8, borderRadius: 4, backgroundColor: C.surface3, marginTop: 5 },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4 },
  hypName: { color: C.ink, fontSize: 14, fontWeight: "600", textTransform: "capitalize" },
  evFor: { color: C.accent, fontSize: 12.5, marginTop: 4, fontWeight: "700" },
  evAgainst: { color: C.INSPECT, fontSize: 12.5, marginTop: 4, fontWeight: "700" },
  evText: { color: C.ink2, fontWeight: "400" },
});
