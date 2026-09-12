/* App state: paddocks, checks, scheduled actions, alerts. Persisted as one
   JSON blob in AsyncStorage; React context + reducer on top. */
import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "greenlight-state-v1";

export const SEED_PADDOCKS = [
  { id: "north", name: "North paddock",
    soil: { soil_type: "duplex", internal_drainage: "poor", low_lying_strip: true } },
  { id: "creek", name: "Creek flat",
    soil: { soil_type: "sandy_loam", internal_drainage: "moderate", low_lying_strip: false } },
  { id: "backhill", name: "Back hill",
    soil: { soil_type: "clay_loam", internal_drainage: "good", low_lying_strip: false } },
];

const INITIAL = {
  loaded: false,
  weatherMode: "wet",          // "wet" | "drying" | "live"  (Demo screen toggles)
  paddocks: SEED_PADDOCKS,
  checks: [],                  // {id, paddockId, ts, text, photoUri, observation, signals, decision, weatherSource, interpSource}
  actions: [],                 // {id, paddockId, checkId, kind, title, due, status}
  alerts: [],                  // {id, ts, paddockId, type, message, read}
};

let idc = 0;
export const uid = () => `${Date.now().toString(36)}-${(idc++).toString(36)}`;

function reducer(state, a) {
  switch (a.type) {
    case "load": return { ...a.state, loaded: true };
    case "weatherMode": return { ...state, weatherMode: a.mode };
    case "addPaddock": return { ...state, paddocks: [...state.paddocks, a.paddock] };
    case "addCheck": return { ...state, checks: [a.check, ...state.checks] };
    case "addAction": return { ...state, actions: [a.action, ...state.actions] };
    case "setActionStatus":
      return { ...state, actions: state.actions.map(x => x.id === a.id ? { ...x, status: a.status } : x) };
    case "addAlerts":
      return a.alerts.length ? { ...state, alerts: [...a.alerts, ...state.alerts] } : state;
    case "readAlerts":
      return { ...state, alerts: state.alerts.map(x => ({ ...x, read: true })) };
    case "reset": return { ...INITIAL, loaded: true };
    default: return state;
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const persistable = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => {
      let s = INITIAL;
      if (raw) { try { s = { ...INITIAL, ...JSON.parse(raw) }; } catch (e) { /* fresh */ } }
      persistable.current = true;
      dispatch({ type: "load", state: s });
    }).catch(() => dispatch({ type: "load", state: INITIAL }));
  }, []);

  useEffect(() => {
    if (!state.loaded || !persistable.current) return;
    const { loaded, ...rest } = state;
    AsyncStorage.setItem(KEY, JSON.stringify(rest)).catch(() => {});
  }, [state]);

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
