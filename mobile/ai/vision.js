/* Photo → observations, via the backend /vision endpoint (Anthropic key
   stays on the server). The model reports what it SEES — never a cause;
   the on-device engine does the diagnosing.

   Offline or backend down: returns null and the check runs on text alone. */

const api = require("./api");
const { sanitizeObservation } = require("./interpret");

let FileSystem = null;
try { FileSystem = require("expo-file-system/legacy"); } catch (e) {
  try { FileSystem = require("expo-file-system"); } catch (e2) { /* unavailable */ }
}

export const hasVision = () =>
  !!(api.hasBackend() && api.healthSnapshot().anthropic && FileSystem && FileSystem.readAsStringAsync);

export async function observePhoto(uri) {
  if (!hasVision()) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    const media = uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const r = await api.post("/vision", { image_base64: b64, media_type: media }, 25000);
    const keep = sanitizeObservation(r.observation);
    return Object.keys(keep).length ? keep : null;
  } catch (e) {
    return null;
  }
}
