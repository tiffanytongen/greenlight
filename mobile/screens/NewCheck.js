/* New field check: paddock → say/type what you see → optional photo/details
   → Analyse. AI structures the input; the deterministic engine makes the call. */
import React, { useState } from "react";
import {
  ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { C, T } from "../theme";
import { Chips } from "../components";
import { useStore, uid } from "../store";
import { interpret } from "../ai/interpret";
import { observePhoto, hasVision } from "../ai/vision";
import { transcribe, hasSTT } from "../ai/speech";
import { getWeather } from "../weather";

const E = require("../engine.js");

let ImagePicker = null;
try { ImagePicker = require("expo-image-picker"); } catch (e) { /* unavailable */ }
let AudioMod = null;
try { AudioMod = require("expo-audio"); } catch (e) { /* unavailable */ }

// ---------------------------------------------------------------- mic button
function MicButton({ onTranscript, onNoSTT }) {
  const recorder = AudioMod.useAudioRecorder(AudioMod.RecordingPresets.HIGH_QUALITY);
  const [recState, setRecState] = useState("idle"); // idle | rec | busy

  const start = async () => {
    try {
      const perm = await AudioMod.AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await AudioMod.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecState("rec");
    } catch (e) { setRecState("idle"); }
  };
  const stop = async () => {
    setRecState("busy");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri && hasSTT()) {
        const text = await transcribe(uri);
        if (text) onTranscript(text); else onNoSTT();
      } else if (uri) {
        onNoSTT();
      }
    } catch (e) { /* ignore */ }
    setRecState("idle");
  };

  return (
    <Pressable onPress={recState === "rec" ? stop : start} disabled={recState === "busy"}
      style={[s.squareBtn, recState === "rec" && { borderColor: C.INSPECT }]}>
      {recState === "busy"
        ? <ActivityIndicator color={C.accent} />
        : <Text style={s.squareBtnText}>{recState === "rec" ? "◼ Stop" : "🎤 Speak"}</Text>}
    </Pressable>
  );
}

// ---------------------------------------------------------------- screen
export default function NewCheck({ go }) {
  const { state, dispatch } = useStore();
  const [paddockId, setPaddockId] = useState(state.paddocks[0] && state.paddocks[0].id);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [more, setMore] = useState(false);
  const [zadoks, setZadoks] = useState(31);
  const [soilCond, setSoilCond] = useState(null);   // "wet" | "ok" | "dry"
  const [treatment, setTreatment] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const paddock = state.paddocks.find(p => p.id === paddockId) || state.paddocks[0];

  const pickPhoto = async (camera) => {
    if (!ImagePicker) return;
    try {
      const perm = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const opts = { quality: 0.5, allowsEditing: false };
      const res = camera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (!res.canceled && res.assets && res.assets[0]) setPhoto(res.assets[0].uri);
    } catch (e) { /* ignore */ }
  };

  const analyse = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      // 1. interpret free text (AI or local parser — structuring only)
      const interp = await interpret(text);
      // 2. photo → visual observations (never a diagnosis)
      let visionObs = null;
      if (photo && hasVision()) visionObs = await observePhoto(photo);
      // 3. merge: photo fills what the words didn't say; explicit detail wins
      const obs = {
        leaf_position: "unknown", colour_pattern: "unknown", distribution: "unknown",
        vigour: "unknown", waterlogging_cues: false, image_quality: photo ? 0.8 : 0.0,
        notes: "", ...(visionObs || {}), ...interp.observation,
      };
      if (soilCond === "wet" && !obs.waterlogging_cues) obs.waterlogging_cues = true;
      const anyObs = text.trim() || visionObs || soilCond;
      // 4. weather context
      const wx = await getWeather(state.weatherMode);
      // 5. the deterministic engine makes the call
      const input = {
        paddock: paddock.name, crop: "wheat", zadoks_stage: zadoks, soil: paddock.soil,
        plan: { kind: "nitrogen", product: "urea", rate_kg_ha: 130, n_rate_kg_ha: 60,
                intended_date_offset_days: 0 },
        observation: anyObs ? obs : null,
        farmer_note: [text.trim(), treatment.trim()].filter(Boolean).join(" | "),
        history: [], cases: [], weather: wx.days,
      };
      const res = E.runPipeline(input, { useRetrieval: true, applySafetyLayer: true });
      const check = {
        id: uid(), paddockId: paddock.id, ts: Date.now(), text: text.trim(),
        photoUri: photo, zadoks, observation: input.observation, signals: res.signals,
        retrieved_ids: res.retrieved_ids, trace: res.trace, decision: res.decision,
        weatherDays: wx.days, weatherSource: wx.source, interpSource: interp.source,
        visionUsed: !!visionObs,
      };
      dispatch({ type: "addCheck", check });
      go("result", { checkId: check.id, fresh: true });
    } catch (e) {
      setNote("Something went wrong — try again.");
    }
    setBusy(false);
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={T.card}>
        <Text style={T.kicker}>PADDOCK</Text>
        <View style={{ marginTop: 10 }}>
          <Chips big value={paddockId} onChange={setPaddockId}
            options={state.paddocks.map(p => [p.id, p.name])} />
        </View>
      </View>

      <View style={T.card}>
        <Text style={T.kicker}>WHAT'S GOING ON?</Text>
        <TextInput
          style={s.textBox} multiline value={text} onChangeText={setText}
          placeholder={"e.g. North paddock has gone yellow in the low spots after all that rain — spread urea today?"}
          placeholderTextColor={C.muted}
        />
        <View style={s.inputRow}>
          {AudioMod && (
            <MicButton
              onTranscript={t => setText(prev => (prev ? prev + " " : "") + t)}
              onNoSTT={() => setNote("Recorded — no transcription key set, so type what you said.")}
            />
          )}
          {ImagePicker && (
            <Pressable onPress={() => pickPhoto(true)} style={s.squareBtn}>
              <Text style={s.squareBtnText}>📷 Photo</Text>
            </Pressable>
          )}
          {ImagePicker && (
            <Pressable onPress={() => pickPhoto(false)} style={s.squareBtn}>
              <Text style={s.squareBtnText}>🖼 Upload</Text>
            </Pressable>
          )}
        </View>
        {photo && (
          <View style={s.photoRow}>
            <Image source={{ uri: photo }} style={s.thumb} />
            <Text style={[T.tiny, { flex: 1 }]}>
              {hasVision() ? "Photo will be read for visual signs." :
                "Photo saved with the check. (Add an AI key to read it automatically.)"}
            </Text>
            <Pressable onPress={() => setPhoto(null)} hitSlop={8}>
              <Text style={{ color: C.INSPECT, fontWeight: "700" }}>✕</Text>
            </Pressable>
          </View>
        )}
        {note && <Text style={[T.tiny, { color: C.WAIT, marginTop: 8 }]}>{note}</Text>}
      </View>

      <View style={T.card}>
        <Pressable onPress={() => setMore(!more)} style={T.between} hitSlop={8}>
          <Text style={T.kicker}>MORE DETAIL (OPTIONAL)</Text>
          <Text style={{ color: C.muted }}>{more ? "▾" : "▸"}</Text>
        </Pressable>
        {more && (
          <View style={{ marginTop: 12, gap: 12 }}>
            <View>
              <Text style={s.fieldLabel}>Crop stage</Text>
              <Chips value={zadoks} onChange={setZadoks} options={[
                [30, "Z30"], [31, "Z31"], [32, "Z32"], [37, "Z37"], [39, "Z39"],
              ]} />
            </View>
            <View>
              <Text style={s.fieldLabel}>Soil right now</Text>
              <Chips value={soilCond} onChange={v => setSoilCond(soilCond === v ? null : v)} options={[
                ["wet", "waterlogged"], ["ok", "moist"], ["dry", "dry"],
              ]} />
            </View>
            <View>
              <Text style={s.fieldLabel}>Recent treatment</Text>
              <TextInput style={s.smallBox} value={treatment} onChangeText={setTreatment}
                placeholder="e.g. sprayed pre-em, Group 2" placeholderTextColor={C.muted} />
            </View>
          </View>
        )}
      </View>

      <Pressable onPress={analyse} style={[T.bigBtn, { paddingVertical: 22 }]} disabled={busy}>
        {busy ? <ActivityIndicator color={C.accentInk} />
              : <Text style={T.bigBtnText}>Analyse</Text>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  textBox: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
             borderRadius: 12, color: C.ink, padding: 14, fontSize: 16, lineHeight: 22,
             minHeight: 96, textAlignVertical: "top", marginTop: 10 },
  smallBox: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2,
              borderRadius: 10, color: C.ink, paddingVertical: 10, paddingHorizontal: 12,
              fontSize: 15 },
  inputRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  squareBtn: { flex: 1, borderWidth: 1.5, borderColor: C.line2, borderRadius: 12,
               paddingVertical: 14, alignItems: "center", backgroundColor: C.surface2 },
  squareBtnText: { color: C.ink, fontSize: 15, fontWeight: "700" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  fieldLabel: { color: C.ink2, fontSize: 13, fontWeight: "600", marginBottom: 6 },
});
