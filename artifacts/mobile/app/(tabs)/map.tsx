import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MapNativeView } from "@/components/MapNativeView";
import { EmployeeTrailView } from "@/components/EmployeeTrailView";
import { AdminFleetMap } from "@/components/AdminFleetMap";
import { EmployeePickerList } from "@/components/EmployeePickerList";
import { theme } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { listEmployeeLocationsByDate, getLocationTrail } from "@/lib/api";
import { matchTrail } from "@/lib/googleRoadsMatching";
import type { EmployeeLocation, LocationPoint } from "@/lib/types";
import { localDateStr } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";

const C = theme.light.colors;

// ─── Persistence keys ──────────────────────────────────────────────────────
// FIX (Bug 2 – lines disappear after re-login/restart):
// selectedDate and the road-matched polyline are pure React state, so they reset
// to defaults every time MapScreen mounts (i.e. after every login). We persist
// them in AsyncStorage so the last-used date and the last-drawn trail survive
// across logouts, app kills, and reboots. On mount we restore them so the map
// immediately shows the path the user was looking at before, with no extra tap.
const MAP_DATE_KEY = "neelgund:map:selectedDate";
const MAP_MATCHED_ROUTE_PREFIX = "neelgund:map:matchedRoute:";

function matchedRouteKey(empId: string, date: string): string {
  return `${MAP_MATCHED_ROUTE_PREFIX}${empId}:${date}`;
}

async function loadPersistedDate(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(MAP_DATE_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return localDateStr(new Date());
}

async function savePersistedDate(date: string): Promise<void> {
  try { await AsyncStorage.setItem(MAP_DATE_KEY, date); } catch { /* ignore */ }
}

async function loadPersistedMatchedRoute(empId: string, date: string): Promise<number[][] | null> {
  try {
    const raw = await AsyncStorage.getItem(matchedRouteKey(empId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length >= 2) return parsed as number[][];
  } catch { /* ignore */ }
  return null;
}

async function savePersistedMatchedRoute(empId: string, date: string, route: number[][] | null): Promise<void> {
  try {
    const key = matchedRouteKey(empId, date);
    if (route && route.length >= 2) {
      await AsyncStorage.setItem(key, JSON.stringify(route));
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
// ───────────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return localDateStr(new Date());
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager" || user?.role === "hr";
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  // FIX (Bug 2): Initialise to today, then restore from AsyncStorage on mount.
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  // FIX (Bug 2): Restore persisted date on mount so after re-login the user
  // immediately sees the same date (and therefore the same trail) they had before.
  useEffect(() => {
    loadPersistedDate().then((date) => {
      // Don't reach into the future — clamp to today
      const today = todayStr();
      setSelectedDate(date <= today ? date : today);
    });
  }, []);

  // Persist whenever the user changes the date
  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    void savePersistedDate(date);
  };

  // Road-matched route — computed client-side from the GPS trail
  const [matchedRoute, setMatchedRoute] = useState<number[][] | null>(null);
  const matchKeyRef = useRef<string>("");

  // Must be declared before the useEffects that reference it
  const effectiveEmployeeId = isAdminOrManager ? selectedEmployee : (user?.id ?? null);
  const isToday = selectedDate === todayStr();

  // FIX (Bug 2): On mount, restore the last persisted matchedRoute for the
  // current employee+date so the polyline is visible immediately after re-login
  // without waiting for the trail fetch + road-matching round-trip.
  useEffect(() => {
    const empId = effectiveEmployeeId;
    if (!empId) return;
    loadPersistedMatchedRoute(empId, selectedDate).then((cached) => {
      if (cached) {
        setMatchedRoute(cached);
        // Also prime matchKeyRef so we don't redundantly re-match the same
        // trail length we already have cached (trail.length unknown here, so
        // use a sentinel that the real effect will overwrite once data loads).
        matchKeyRef.current = `${empId}:${selectedDate}:cached`;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveEmployeeId, selectedDate]);

  const employeesQ = useQuery<EmployeeLocation[]>({
    queryKey: ["location-employees-date", selectedDate],
    queryFn: async () => (await listEmployeeLocationsByDate(selectedDate)) as EmployeeLocation[],
    refetchInterval: selectedDate === todayStr() ? 5_000 : false,
    refetchOnWindowFocus: true,
    enabled: isAdminOrManager,
    staleTime: 5_000,
  });

  const trailQ = useQuery<LocationPoint[]>({
    queryKey: ["location-trail", effectiveEmployeeId, selectedDate],
    queryFn: async () => {
      if (!effectiveEmployeeId) return [];
      return await getLocationTrail(effectiveEmployeeId, selectedDate);
    },
    enabled: isAdminOrManager ? !!selectedEmployee : !!user?.id,
    refetchInterval: isToday ? 15_000 : false,   // reduced from 30s to 15s
    refetchOnWindowFocus: true,                    // immediate refetch on foreground
    staleTime: isToday ? 15_000 : Infinity,
  });

  const trail = trailQ.data ?? [];

  // BUG FIX: Run road matching whenever the trail or employee/date changes.
  // Previously matchedRoute was hardcoded to null — snapped paths were never used.
  // FIX (Bug 2): After computing the matched route, persist it to AsyncStorage
  // so the polyline is immediately available the next time the screen mounts
  // (e.g. after logout → login) without a fresh API round-trip.
  useEffect(() => {
    const empId = effectiveEmployeeId;
    if (!empId || trail.length < 2) {
      setMatchedRoute(null);
      return;
    }
    const matchKey = `${empId}:${selectedDate}:${trail.length}`;
    if (matchKey === matchKeyRef.current) return; // already matching/matched this set
    matchKeyRef.current = matchKey;
    let cancelled = false;
    matchTrail(trail, empId, selectedDate).then((result) => {
      if (cancelled) return;
      if (result?.coordinates && result.coordinates.length >= 2) {
        setMatchedRoute(result.coordinates);
        // Persist so next login restores this instantly
        void savePersistedMatchedRoute(empId, selectedDate, result.coordinates);
      } else {
        setMatchedRoute(null);
        void savePersistedMatchedRoute(empId, selectedDate, null);
      }
    });
    return () => { cancelled = true; };
  }, [trail, effectiveEmployeeId, selectedDate]);

  const employees = employeesQ.data ?? [];
  const topPad = insets.top + 8;
  const bottomPad = insets.bottom + 90;

  // Employee role: always show their own trail
  if (!isAdminOrManager) {
    if (trailQ.isError) {
      return (
        <View style={styles.loading}>
          <Text style={styles.errorTitle}>Couldn't load trail</Text>
          <Text style={styles.errorBody}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => trailQ.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <EmployeeTrailView
        trail={trail}
        matchedRoute={matchedRoute}
        isLoading={trailQ.isLoading}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
        topPad={topPad}
        bottomPad={bottomPad}
        employeeId={user?.id}
        employeeName={user?.name ?? null}
        profilePhotoUrl={user?.profilePhotoUrl ?? null}
      />
    );
  }

  // Super admin/manager without a chosen employee: show the picker list or fleet map
  if (!selectedEmployee) {
    return (
      <View style={styles.container}>
        {viewMode === "list" ? (
          <EmployeePickerList
            employees={employees}
            isLoading={employeesQ.isLoading}
            isError={employeesQ.isError}
            onRefetch={() => employeesQ.refetch()}
            onSelect={setSelectedEmployee}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            topPad={topPad + 56}
            bottomPad={bottomPad}
          />
        ) : (
          <AdminFleetMap
            employees={employees}
            onSelect={setSelectedEmployee}
            topPad={topPad + 56}
            bottomPad={bottomPad}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
          />
        )}
        <View style={[styles.viewToggleContainer, { top: topPad }]}>
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === "map" && styles.toggleBtnActive]}
              onPress={() => setViewMode("map")}
            >
              <Text style={[styles.toggleText, viewMode === "map" && styles.toggleTextActive]}>Map</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === "list" && styles.toggleBtnActive]}
              onPress={() => setViewMode("list")}
            >
              <Text style={[styles.toggleText, viewMode === "list" && styles.toggleTextActive]}>List</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{
          position: "absolute",
          top: topPad,
          right: 16,
          zIndex: 50,
          backgroundColor: C.card,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: C.border,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 4,
          padding: 2,
        }}>
          <NotificationBell />
        </View>
      </View>
    );
  }

  // Super admin/manager with chosen employee: show the map
  return (
    <View style={styles.container}>
      {trailQ.isError ? (
        <View style={[styles.inlineError, { top: topPad + 60 }]}>
          <Text style={styles.inlineErrorText} numberOfLines={2}>
            Trail failed to load — pin only. Tap to retry.
          </Text>
          <TouchableOpacity onPress={() => trailQ.refetch()}>
            <Text style={styles.retryInline}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <MapNativeView
        employees={employees}
        selectedEmployee={selectedEmployee}
        trail={trailQ.isError ? [] : trail}
        matchedRoute={matchedRoute}
        isLoading={trailQ.isLoading}
        onSelect={setSelectedEmployee}
        topPad={topPad}
        bottomPad={bottomPad}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  errorTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center" },
  errorBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: C.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  inlineError: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 20,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  retryInline: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.brand },
  viewToggleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 30,
    alignItems: "center",
  },
  viewToggle: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 999,
    padding: 4,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  toggleBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 999,
  },
  toggleBtnActive: {
    backgroundColor: C.brand,
  },
  toggleText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
  },
  toggleTextActive: {
    color: "#fff",
  },
});