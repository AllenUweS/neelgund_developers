import React, { useState } from "react";
import { View, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { MapNativeView } from "@/components/MapNativeView";
import { EmployeeTrailView } from "@/components/EmployeeTrailView";
import { AdminFleetMap } from "@/components/AdminFleetMap";
import { EmployeePickerList } from "@/components/EmployeePickerList";
import { theme } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { listEmployeeLocationsByDate, getLocationTrail } from "@/lib/api";
import type { EmployeeLocation, LocationPoint } from "@/lib/types";
import { localDateStr } from "@/lib/utils";

const C = theme.light.colors;

function todayStr(): string {
  return localDateStr(new Date());
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager";
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  const employeesQ = useQuery<EmployeeLocation[]>({
    queryKey: ["location-employees-date", selectedDate],
    queryFn: async () => (await listEmployeeLocationsByDate(selectedDate)) as EmployeeLocation[],
    // FIX: Reduced from 60s to 15s so admin fleet map updates near-live.
    refetchInterval: selectedDate === todayStr() ? 15_000 : false,
    enabled: isAdminOrManager,
    staleTime: 15_000,
  });

  const effectiveEmployeeId = isAdminOrManager ? selectedEmployee : (user?.id ?? null);

  const isToday = selectedDate === todayStr();

  const trailQ = useQuery<LocationPoint[]>({
    queryKey: ["location-trail", effectiveEmployeeId, selectedDate],
    queryFn: async () => {
      if (!effectiveEmployeeId) return [];
      return await getLocationTrail(effectiveEmployeeId, selectedDate);
    },
    enabled: isAdminOrManager ? !!selectedEmployee : !!user?.id,
    // FIX: Refresh live trail every 30 s for today so employees and admins
    // see location updates without having to manually reload.
    refetchInterval: isToday ? 30_000 : false,
    staleTime: isToday ? 30_000 : Infinity,
  });

  const employees = employeesQ.data ?? [];
  const trail = trailQ.data ?? [];
  const matchedRoute = null;
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
        onDateChange={setSelectedDate}
        topPad={topPad}
        bottomPad={bottomPad}
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
            onDateChange={setSelectedDate}
            topPad={topPad + 56}
            bottomPad={bottomPad}
          />
        ) : (
          <AdminFleetMap
            employees={employees}
            onSelect={setSelectedEmployee}
            topPad={topPad + 56}
            bottomPad={bottomPad}
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
        onDateChange={setSelectedDate}
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
