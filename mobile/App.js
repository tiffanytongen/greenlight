/* Greenlight — field decisions for farm workers.
   Speak/type/photograph what you see; AI structures the input; the
   deterministic engine (verified against the Python pipeline) makes the call. */
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, View,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { C, T } from "./theme";
import { StoreProvider, useStore } from "./store";
import { getWeather } from "./weather";
import { evaluateAlerts } from "./alerts";
const api = require("./ai/api");
import Today from "./screens/Today";
import NewCheck from "./screens/NewCheck";
import Result from "./screens/Result";
import { Fields, Paddock } from "./screens/Paddock";
import Demo from "./screens/Demo";

const TABS = [
  ["today", "Today", "☀️"],
  ["check", "Check", "➕"],
  ["fields", "Fields", "🌾"],
  ["demo", "Demo", "🧪"],
];
const TITLES = {
  today: "Today", check: "New field check", fields: "Fields",
  demo: "Demo & evaluation", result: "Result", paddock: "Paddock",
};

function Shell() {
  const { state, dispatch } = useStore();
  const [screen, setScreen] = useState("today");
  const [params, setParams] = useState({});
  const [stack, setStack] = useState([]);
  const [demoCheck, setDemoCheck] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const go = useCallback((next, p = {}) => {
    setStack(st => [...st, { screen, params }]);
    setScreen(next); setParams(p);
  }, [screen, params]);

  const back = () => {
    const prev = stack[stack.length - 1];
    if (!prev) { setScreen("today"); return; }
    setStack(st => st.slice(0, -1));
    setScreen(prev.screen); setParams(prev.params);
  };

  const tab = (t) => { setStack([]); setParams({}); setScreen(t); };

  const [aiOnline, setAiOnline] = useState(false);

  const refreshAlerts = useCallback(async () => {
    try {
      const h = await api.refreshHealth(true);
      setAiOnline(h.ok);
      const wx = await getWeather(state.weatherMode);
      const fresh = evaluateAlerts(state, wx.days);
      if (fresh.length) dispatch({ type: "addAlerts", alerts: fresh });
    } catch (e) { /* offline is fine */ }
  }, [state, dispatch]);

  useEffect(() => {
    if (state.loaded) refreshAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded, state.weatherMode]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAlerts();
    setRefreshing(false);
  };

  if (!state.loaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const unread = state.alerts.filter(a => !a.read).length;
  const isTab = TABS.some(([t]) => t === screen);

  return (
    <SafeAreaView style={s.safe}>
      <ExpoStatusBar style="light" />
      <View style={s.header}>
        {!isTab ? (
          <Pressable onPress={back} hitSlop={12} style={s.backBtn}>
            <Text style={s.backText}>‹ Back</Text>
          </Pressable>
        ) : (
          <Text style={s.wordmark}>greenlight<Text style={{ color: C.accent }}>.</Text></Text>
        )}
        <View style={{ flex: 1 }} />
        <View style={[s.aiPill, { borderColor: aiOnline ? C.accent : C.line2 }]}>
          <Text style={[s.aiPillText, aiOnline && { color: C.accent }]}>
            {aiOnline ? "AI online" : "offline"}
          </Text>
        </View>
        <Text style={s.headerTitle}>{TITLES[screen] || ""}</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          screen === "today"
            ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
                tintColor={C.accent} />
            : undefined
        }>
        {screen === "today" && <Today go={go} />}
        {screen === "check" && <NewCheck go={go} />}
        {screen === "fields" && <Fields go={go} />}
        {screen === "demo" && <Demo go={go} setDemoCheck={setDemoCheck} />}
        {screen === "result" && (
          <Result params={params} go={go} demoCheck={params.demo ? demoCheck : null} />
        )}
        {screen === "paddock" && <Paddock params={params} go={go} />}
      </ScrollView>

      <View style={s.tabbar}>
        {TABS.map(([t, label, icon]) => (
          <Pressable key={t} onPress={() => tab(t)} style={s.tabBtn} hitSlop={4}>
            <View>
              <Text style={{ fontSize: 22 }}>{icon}</Text>
              {t === "today" && unread > 0 && <View style={s.dot} />}
            </View>
            <Text style={[s.tabLabel, screen === t && { color: C.accent }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: StatusBar.currentHeight || 0 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16,
            paddingVertical: 10, gap: 12 },
  wordmark: { color: C.ink, fontSize: 20, fontWeight: "800" },
  headerTitle: { color: C.ink2, fontSize: 16, fontWeight: "600" },
  aiPill: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9,
            marginRight: 10 },
  aiPillText: { color: C.muted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 },
  backBtn: { paddingVertical: 2 },
  backText: { color: C.accent, fontSize: 17, fontWeight: "700" },
  scroll: { padding: 14, paddingBottom: 28 },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line,
            backgroundColor: C.surface, paddingBottom: 4 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 },
  tabLabel: { color: C.muted, fontSize: 11, fontWeight: "700" },
  dot: { position: "absolute", right: -6, top: -2, width: 10, height: 10,
         borderRadius: 5, backgroundColor: C.INSPECT },
});
