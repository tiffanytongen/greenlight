/* Shared palette + a few cross-screen styles. High contrast, outdoor-readable. */
import { StyleSheet } from "react-native";

export const C = {
  bg: "#121814", surface: "#1A211C", surface2: "#222B24", surface3: "#2A342C",
  ink: "#E8EDE7", ink2: "#B7C2B8", muted: "#8B978E", line: "#2C362E", line2: "#3A463C",
  accent: "#66B77E", accentInk: "#0D130E", accentSoft: "#21301F",
  rain: "#6FA8CF", rainDim: "#3C566B",
  GO: "#2E8747", WAIT: "#B58B2A", SWITCH: "#8E70C4", INSPECT: "#D05548",
  waitTint: "#2E2818", inspectTint: "#331F1C",
};

export const MONO = { fontFamily: "Menlo", fontVariant: ["tabular-nums"] };

export const T = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1,
          borderColor: C.line, padding: 16 },
  kicker: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  body: { color: C.ink, fontSize: 16, lineHeight: 22 },
  dim: { color: C.ink2, fontSize: 14 },
  tiny: { color: C.muted, fontSize: 12, lineHeight: 17 },
  h1: { color: C.ink, fontSize: 24, fontWeight: "800" },
  h2: { color: C.ink, fontSize: 17, fontWeight: "700" },
  bigBtn: { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 18,
            alignItems: "center" },
  bigBtnText: { color: C.accentInk, fontSize: 18, fontWeight: "800" },
  ghostBtn: { borderWidth: 1.5, borderColor: C.line2, borderRadius: 14,
              paddingVertical: 14, alignItems: "center" },
  ghostBtnText: { color: C.ink2, fontSize: 15, fontWeight: "700" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
