/* Voice in / voice out.

   Speech-to-text: ElevenLabs Scribe when EXPO_PUBLIC_ELEVENLABS_KEY is set.
   Without a key the mic still records; the worker is asked to type instead.

   Text-to-speech: device voice via expo-speech by default (works offline in
   Expo Go); ElevenLabs TTS slot is stubbed below for when a key is added. */

let Speech = null;
try { Speech = require("expo-speech"); } catch (e) { /* unavailable */ }

const XI_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_KEY || null;

export const hasSTT = () => !!XI_KEY;

export async function transcribe(uri) {
  if (!XI_KEY) return null;
  try {
    const form = new FormData();
    form.append("file", { uri, name: "note.m4a", type: "audio/m4a" });
    form.append("model_id", "scribe_v1");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": XI_KEY },
      body: form,
    });
    const j = await res.json();
    return j.text || null;
  } catch (e) {
    return null;
  }
}

/* Spoken output. ElevenLabs TTS would stream higher-quality audio here when a
   key is present; the device voice keeps the demo fully offline. */
export function speak(text) {
  if (!Speech) return;
  try {
    Speech.stop();
    Speech.speak(text, { rate: 0.98 });
  } catch (e) { /* silent */ }
}

export function stopSpeaking() {
  if (Speech) { try { Speech.stop(); } catch (e) { /* silent */ } }
}
