/* Voice in / voice out — through the backend so ElevenLabs keys never
   touch the phone.

   In:  mic recording → backend /transcribe → ElevenLabs STT (scribe_v1)
   Out: result text  → backend /speak → ElevenLabs TTS (eleven_turbo_v2_5)
        → played on-device; falls back to the phone's offline voice
        (expo-speech) whenever the backend is unreachable. */

const api = require("./api");

let Speech = null;
try { Speech = require("expo-speech"); } catch (e) { /* unavailable */ }
let FileSystem = null;
try { FileSystem = require("expo-file-system/legacy"); } catch (e) {
  try { FileSystem = require("expo-file-system"); } catch (e2) { /* unavailable */ }
}
let AudioMod = null;
try { AudioMod = require("expo-audio"); } catch (e) { /* unavailable */ }

export const hasSTT = () =>
  !!(api.hasBackend() && api.healthSnapshot().elevenlabs && FileSystem && FileSystem.readAsStringAsync);

export async function transcribe(uri) {
  if (!hasSTT()) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    const mime = uri.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/m4a";
    const r = await api.post("/transcribe", { audio_base64: b64, mime }, 30000);
    return r.text || null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- voice out
let player = null;

function deviceSpeak(text) {
  if (!Speech) return;
  try { Speech.stop(); Speech.speak(text, { rate: 0.98 }); } catch (e) { /* silent */ }
}

export async function speak(text) {
  const online = api.hasBackend() && api.healthSnapshot().elevenlabs &&
    FileSystem && FileSystem.writeAsStringAsync && AudioMod && AudioMod.createAudioPlayer;
  if (online) {
    try {
      const r = await api.post("/speak", { text }, 25000);
      const file = `${FileSystem.cacheDirectory}gl-tts-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(file, r.audio_base64, { encoding: "base64" });
      if (AudioMod.setAudioModeAsync) {
        await AudioMod.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      }
      if (player && player.remove) { try { player.remove(); } catch (e) { /* old player */ } }
      player = AudioMod.createAudioPlayer({ uri: file });
      player.play();
      return "elevenlabs";
    } catch (e) { /* fall through to device voice */ }
  }
  deviceSpeak(text);
  return "device";
}

export function stopSpeaking() {
  if (player) { try { player.pause(); } catch (e) { /* silent */ } }
  if (Speech) { try { Speech.stop(); } catch (e) { /* silent */ } }
}
