import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import Colors from "@/constants/colors";
import { getAttendanceByMonthForEmployee } from "@/lib/api";
import type { AttendanceRecord } from "@/lib/types";
import { formatTime, formatDate, calcDuration, totalHoursWorked, thisMonthLocal } from "@/lib/utils";

const C = Colors.light;

function StatusBadge({
  status,
  checkInTime,
  checkOutTime,
}: {
  status: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}) {
  const isInProgress = !!checkInTime && !checkOutTime;
  const config = isInProgress
    ? { color: C.accent, label: "In Progress", icon: "time" as const }
    : ({
        present: { color: C.success, label: "Present", icon: "checkmark-circle" },
        half_day: { color: C.warning, label: "Half Day", icon: "time" },
        absent: { color: C.danger, label: "Absent", icon: "close-circle" },
      }[status ?? ""] ?? { color: C.textSecondary, label: "Unknown", icon: "help-circle" });

  return (
    <View style={[styles.badge, { backgroundColor: config.color + "18" }]}>
      <Ionicons name={config.icon as "checkmark-circle"} size={12} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const HistoryRow = React.memo(function HistoryRow({ record }: { record: AttendanceRecord }) {
  const duration = calcDuration(record.checkInTime, record.checkOutTime);
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyDate}>
        <Text style={styles.historyDateNum}>{new Date(record.date + "T00:00:00").getDate()}</Text>
        <Text style={styles.historyDateMon}>{new Date(record.date + "T00:00:00").toLocaleDateString("en-IN", { month: "short" })}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyLabel}>{formatDate(record.date)}</Text>
        <View style={styles.historyTimes}>
          <Text style={styles.historyTime}>
            <Text style={{ color: C.success }}>In</Text> {formatTime(record.checkInTime)}
          </Text>
          <Text style={styles.historyTimeDot}>·</Text>
          <Text style={styles.historyTime}>
            <Text style={{ color: C.danger }}>Out</Text> {formatTime(record.checkOutTime)}
          </Text>
          {duration ? <Text style={styles.historyDur}> · {duration}</Text> : null}
        </View>
      </View>
      <StatusBadge status={record.status} checkInTime={record.checkInTime} checkOutTime={record.checkOutTime} />
    </View>
  );
});

export default function EmployeeAttendanceDetailScreen() {
  const { employeeId, name, month: initialMonth } = useLocalSearchParams<{ employeeId: string; name?: string; month?: string }>();
  const [selectedMonth, setSelectedMonth] = useState(() => (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : thisMonthLocal()));
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const historyQ = useQuery<AttendanceRecord[]>({
    queryKey: ["attendance-employee-month", employeeId, selectedMonth],
    queryFn: () => getAttendanceByMonthForEmployee(employeeId, selectedMonth),
    enabled: !!employeeId,
    staleTime: 60_000,
  });

  const historyRecords = historyQ.data ?? [];

  const monthAttendanceSummary = {
    present: historyRecords.filter((r) => r.status === "present").length,
    halfDay: historyRecords.filter((r) => r.status === "half_day").length,
    absent: historyRecords.filter((r) => r.status === "absent").length,
    totalHours: totalHoursWorked(historyRecords),
  };

  const shiftMonth = (delta: number) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const d = new Date(year, month - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["attendance-employee-month", employeeId, selectedMonth] });
    setRefreshing(false);
  }, [qc, employeeId, selectedMonth]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 12 }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {name ? name : "Employee"}
          </Text>
          <Text style={styles.subtitle}>Attendance History</Text>
        </View>
      </View>

      {/* Month Navigator */}
      <View style={styles.monthNav}>
        <TouchableOpacity style={styles.monthNavBtn} onPress={() => shiftMonth(-1)}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>
          {new Date(selectedMonth + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </Text>
        <TouchableOpacity style={styles.monthNavBtn} onPress={() => shiftMonth(1)} disabled={selectedMonth >= thisMonthLocal()}>
          <Ionicons name="chevron-forward" size={20} color={selectedMonth >= thisMonthLocal() ? C.border : C.text} />
        </TouchableOpacity>
      </View>

      {/* Summary pills */}
      <View style={styles.monthlySummary}>
        <View style={[styles.summaryPill, { backgroundColor: C.success + "15" }]}>
          <Ionicons name="checkmark-circle" size={12} color={C.success} />
          <Text style={[styles.summaryPillText, { color: C.success }]}>{monthAttendanceSummary.present}P</Text>
        </View>
        <View style={[styles.summaryPill, { backgroundColor: C.warning + "15" }]}>
          <Ionicons name="time" size={12} color={C.warning} />
          <Text style={[styles.summaryPillText, { color: C.warning }]}>{monthAttendanceSummary.halfDay}H</Text>
        </View>
        <View style={[styles.summaryPill, { backgroundColor: C.danger + "15" }]}>
          <Ionicons name="close-circle" size={12} color={C.danger} />
          <Text style={[styles.summaryPillText, { color: C.danger }]}>{monthAttendanceSummary.absent}A</Text>
        </View>
        <View style={[styles.summaryPill, { backgroundColor: C.brand + "12" }]}>
          <Ionicons name="timer-outline" size={12} color={C.brand} />
          <Text style={[styles.summaryPillText, { color: C.brand }]}>{monthAttendanceSummary.totalHours}</Text>
        </View>
      </View>

      {/* Records */}
      <View style={styles.section}>
        {historyQ.isLoading ? (
          <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />
        ) : historyRecords.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={36} color={C.border} />
            <Text style={styles.emptyText}>No records this month</Text>
          </View>
        ) : (
          historyRecords.map((record) => <HistoryRow key={record.id} record={record} />)
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 8 },
  backBtn: { padding: 4, marginLeft: -4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12, marginTop: 4 },
  monthNavBtn: { padding: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  monthLabel: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },

  monthlySummary: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  summaryPill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 12 },
  summaryPillText: { fontSize: 11, fontFamily: "Inter_700Bold" },

  section: { paddingHorizontal: 16, gap: 8 },

  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  historyRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: C.border },
  historyDate: { width: 44, height: 48, backgroundColor: C.brand + "10", borderRadius: 12, alignItems: "center", justifyContent: "center" },
  historyDateNum: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.brand },
  historyDateMon: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.brand },
  historyLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  historyTimes: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: 4 },
  historyTime: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  historyTimeDot: { fontSize: 12, color: C.border },
  historyDur: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.brand },

  emptyState: { alignItems: "center", padding: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
});
