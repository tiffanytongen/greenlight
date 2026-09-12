/* Weather for the engine: live Open-Meteo when reachable, bundled snapshots
   otherwise. A demo override ("wet week" / "drying out") makes the live
   storyline reproducible on stage with no network. */

const E = require("./engine.js");

// Wimmera, Vic — same demo location as the Python repo (greenlight/config.py).
export const DEFAULT_LOC = { lat: -36.72, lon: 142.2, tz: "Australia/Melbourne" };

function series(past, future) {
  const days = [];
  past.forEach((d, i) => days.push({ day_offset: -(past.length - i), soil_vwc: null, ...d }));
  future.forEach((d, i) => days.push({ day_offset: i, soil_vwc: null, ...d }));
  return days;
}
const day = (precip_mm, tmax_c = 16, extra = {}) =>
  ({ precip_mm, tmax_c, rh_pct: 70, wind_kmh: 10, ...extra });

/* A soaked week: heavy recent rain, saturated probe, a big front in 2 days.
   Drives the waterlogging-vs-nitrogen flip (matches eval scenario S07). */
export const WET_WEEK = series(
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0].map(mm => day(mm)),
  [day(0, 16, { soil_vwc: 0.47 }), day(0), day(40), day(0), day(8), day(0), day(0)],
);

/* Same paddock a few days later: drained, mild, an 8 mm soak tomorrow. */
export const DRYING_OUT = series(
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0].map(mm => day(mm)),
  [day(0, 16, { soil_vwc: 0.31 }), day(8), day(0), day(0), day(4), day(0), day(0)],
);

let liveCache = { at: 0, days: null };

export async function fetchLive(loc = DEFAULT_LOC) {
  if (liveCache.days && Date.now() - liveCache.at < 30 * 60 * 1000) return liveCache.days;
  const base = `latitude=${loc.lat}&longitude=${loc.lon}&timezone=${encodeURIComponent(loc.tz)}`;
  const fcUrl = "https://api.open-meteo.com/v1/forecast?" + base +
    "&daily=precipitation_sum,temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max" +
    "&hourly=soil_moisture_0_to_7cm&forecast_days=7";
  const arUrl = "https://archive-api.open-meteo.com/v1/archive?" + base +
    "&daily=precipitation_sum,temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max" +
    `&start_date=${iso(-14)}&end_date=${iso(-1)}`;
  const [fc, ar] = await Promise.all([
    fetch(fcUrl).then(r => r.json()), fetch(arUrl).then(r => r.json()),
  ]);
  const days = [];
  const ap = (ar.daily && ar.daily.precipitation_sum) || [];
  for (let i = 0; i < ap.length; i++) {
    days.push({
      day_offset: -(ap.length - i), precip_mm: ap[i] || 0,
      tmax_c: pick(ar.daily.temperature_2m_max, i, 18),
      rh_pct: pick(ar.daily.relative_humidity_2m_mean, i, 60),
      wind_kmh: pick(ar.daily.wind_speed_10m_max, i, 8), soil_vwc: null,
    });
  }
  const fp = (fc.daily && fc.daily.precipitation_sum) || [];
  const sm = (fc.hourly && fc.hourly.soil_moisture_0_to_7cm) || [];
  for (let i = 0; i < fp.length; i++) {
    const chunk = sm.slice(i * 24, (i + 1) * 24).filter(v => v !== null && v !== undefined);
    days.push({
      day_offset: i, precip_mm: fp[i] || 0,
      tmax_c: pick(fc.daily.temperature_2m_max, i, 18),
      rh_pct: pick(fc.daily.relative_humidity_2m_mean, i, 60),
      wind_kmh: pick(fc.daily.wind_speed_10m_max, i, 8),
      soil_vwc: chunk.length ? chunk.reduce((a, b) => a + b, 0) / chunk.length : null,
    });
  }
  if (!days.length) throw new Error("empty weather");
  liveCache = { at: Date.now(), days };
  return days;
}

function pick(arr, i, dflt) { return (arr && arr[i] !== null && arr[i] !== undefined) ? arr[i] : dflt; }
function iso(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/* mode: "wet" | "drying" | "live". Live falls back to the wet snapshot. */
export async function getWeather(mode) {
  if (mode === "wet") return { days: WET_WEEK, source: "demo: wet week" };
  if (mode === "drying") return { days: DRYING_OUT, source: "demo: drying out" };
  try {
    return { days: await fetchLive(), source: "live forecast (Open-Meteo)" };
  } catch (e) {
    return { days: WET_WEEK, source: "offline — demo weather" };
  }
}

export function signalsFor(days, soil, plan) {
  return E.computeSignals(days, soil, plan);
}
