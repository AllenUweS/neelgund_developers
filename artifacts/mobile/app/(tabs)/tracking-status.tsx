import React from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { listTrackingStatus } from "@/lib/api";
import type { TrackingRow } from "@/lib/types";
import { formatWhen, isLive } from "@/lib/utils";

const C = Colors.light;

export default function TrackingStatusScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager";
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + 100;

  const trackingQ = useQuery<TrackingRow[]>({
    queryKey: ["tracking-status"],
    queryFn: async () => (await listTrackingStatus()) as TrackingRow[],
    enabled: isAdminOrManager,
    staleTime: 15_000,
    refetchInterval: 15_000, // FIX: was 60s, now 15s so offline status appears quickly
  });

  if (!isAdminOrManager) {
    return (
      <View style={[styles.center, { paddingTop: topPad }]}>
        <Ionicons name="lock-closed-outline" size={28} color={C.textSecondary} />
        <Text style={styles.lockText}>Only super admin and manager can view tracking status.</Text>
      </View>
    );
  }

  if (trackingQ.isLoading) {
    return (
      <View style={[styles.center, { paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  const rows = trackingQ.data ?? [];

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Tracking Status</Text>
        <Text style={styles.subtitle}>Live health of background tracking by employee</Text>
      </View>

      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryCount}>{rows.length}</Text>
          <Text style={styles.summaryLabel}>Employees</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: C.success }]}>
            {rows.filter((row) => row.trackerState === "running" && isLive(row.lastPingAt)).length}
          </Text>
          <Text style={styles.summaryLabel}>Live</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryCount, { color: C.danger }]}>
            {rows.filter((row) => !(row.trackerState === "running" && isLive(row.lastPingAt))).length}
          </Text>
          <Text style={styles.summaryLabel}>Needs Attention</Text>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.employeeId}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 12, paddingTop: 10 }}
        initialNumToRender={Platform.OS === "web" ? 20 : 10}
        maxToRenderPerBatch={Platform.OS === "web" ? 15 : 8}
        windowSize={Platform.OS === "web" ? 10 : 7}
        removeClippedSubviews={Platform.OS !== "web"}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={trackingQ.isRefetching} onRefresh={trackingQ.refetch} tintColor={C.brand} />}
        renderItem={({ item }) => {
          const live = item.trackerState === "running" && isLive(item.lastPingAt);
          const stateColor = live ? C.success : C.danger;
          const permissionColor =
            item.permissionState === "granted" ? C.success : item.permissionState === "denied" ? C.danger : C.textSecondary;
          return (
            <View style={styles.card}>
              <View style={styles.rowTop}>
                <View>
                  <Text style={styles.name}>{item.employeeName}</Text>
                  <Text style={styles.meta}>
                    {item.role} {item.platform ? `· ${item.platform}` : ""}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: stateColor + "18" }]}>
                  <View style={[styles.dot, { backgroundColor: stateColor }]} />
                  <Text style={[styles.badgeText, { color: stateColor }]}>{live ? "Running" : "Stopped"}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.label}>Permission</Text>
                <Text style={[styles.value, { color: permissionColor }]}>{item.permissionState}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Last ping</Text>
                <Text style={styles.value}>{formatWhen(item.lastPingAt)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Last update</Text>
                <Text style={styles.value}>{formatWhen(item.updatedAt)}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="pulse-outline" size={28} color={C.textSecondary} />
            <Text style={styles.emptyText}>No tracking status records yet.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 16, paddingBottom: 6 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  summaryCount: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: C.brand,
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: C.border,
  },
  center: { flex: 1, backgroundColor: C.background, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  lockText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, textAlign: "center" },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 13, gap: 9 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  value: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.text },
  empty: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
});