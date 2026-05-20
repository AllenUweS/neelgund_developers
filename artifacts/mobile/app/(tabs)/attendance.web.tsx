import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { getAttendanceByDate, listUsers } from "@/lib/api";
import type { AttendanceRecord, UserBasic } from "@/lib/types";
import { formatTime, formatDate, calcDuration, todayISODate } from "@/lib/utils";

const C = {
  brand: "#1B4F8A",
  accent: "#F4A820",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  background: "#F0F4F9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F1923",
  textSecondary: "#64748B",
};

function StatusBadge({ record }: { record: AttendanceRecord }) {
  const hasIn = !!record.checkInTime;
  const hasOut = !!record.checkOutTime;
  if (!hasIn) return (
    <View style={[styles.badge, { backgroundColor: C.danger + "15" }]}>
      <View style={[styles.badgeDot, { backgroundColor: C.danger }]} />
      <Text style={[styles.badgeText, { color: C.danger }]}>Absent</Text>
    </View>
  );
  if (hasIn && !hasOut) return (
    <View style={[styles.badge, { backgroundColor: C.accent + "18" }]}>
      <View style={[styles.badgeDot, { backgroundColor: C.accent }]} />
      <Text style={[styles.badgeText, { color: C.accent }]}>In Progress</Text>
    </View>
  );
  return (
    <View style={[styles.badge, { backgroundColor: C.success + "15" }]}>
      <View style={[styles.badgeDot, { backgroundColor: C.success }]} />
      <Text style={[styles.badgeText, { color: C.success }]}>Present</Text>
    </View>
  );
}

export default function AttendanceWebScreen() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(todayISODate());

  const isAdmin = user?.role === "admin" || user?.role === "super_admin" || user?.role === "hr" || user?.role === "manager";

  const attendanceQ = useQuery<AttendanceRecord[]>({
    queryKey: ["attendance-by-date", selectedDate],
    queryFn: () => getAttendanceByDate(selectedDate),
    staleTime: 30_000,
  });

  const records: AttendanceRecord[] = attendanceQ.data ?? [];

  const presentCount = records.filter(r => r.checkInTime).length;
  const checkedOutCount = records.filter(r => r.checkOutTime).length;
  const absentCount = records.filter(r => !r.checkInTime).length;

  const displayDate = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  function shiftDate(days: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split("T")[0]);
  }

  const isToday = selectedDate === todayISODate();

  return (
    <View style={styles.root}>

      <View style={styles.main}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.pageTitle}>Attendance</Text>
            <Text style={styles.pageSubtitle}>{displayDate}</Text>
          </View>
          <View style={styles.dateNav}>
            <TouchableOpacity style={styles.dateNavBtn} onPress={() => shiftDate(-1)}>
              <Ionicons name="chevron-back" size={16} color={C.brand} />
            </TouchableOpacity>
            <View style={styles.datePill}>
              <Ionicons name="calendar-outline" size={14} color={C.brand} />
              <Text style={styles.datePillText}>{selectedDate}</Text>
            </View>
            <TouchableOpacity style={[styles.dateNavBtn, isToday && styles.dateNavBtnDisabled]} onPress={() => !isToday && shiftDate(1)}>
              <Ionicons name="chevron-forward" size={16} color={isToday ? C.border : C.brand} />
            </TouchableOpacity>
            {!isToday && (
              <TouchableOpacity style={styles.todayBtn} onPress={() => setSelectedDate(todayISODate())}>
                <Text style={styles.todayBtnText}>Today</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.summaryRow}>
            {[
              { label: "Total Staff", value: records.length, color: C.brand, icon: "people" as const },
              { label: "Present", value: presentCount, color: C.success, icon: "checkmark-circle" as const },
              { label: "Checked Out", value: checkedOutCount, color: C.accent, icon: "log-out" as const },
              { label: "Absent / No Data", value: absentCount, color: C.danger, icon: "close-circle" as const },
            ].map((tile) => (
              <View key={tile.label} style={[styles.summaryTile, { borderTopColor: tile.color }]}>
                <View style={[styles.summaryIcon, { backgroundColor: tile.color + "15" }]}>
                  <Ionicons name={tile.icon} size={18} color={tile.color} />
                </View>
                <Text style={[styles.summaryVal, { color: tile.value > 0 ? C.text : C.textSecondary }]}>{tile.value}</Text>
                <Text style={styles.summaryLbl}>{tile.label}</Text>
              </View>
            ))}
          </View>

          {/* Table */}
          <View style={styles.tableCard}>
            <View style={styles.tableCardHeader}>
              <Text style={styles.tableCardTitle}>Attendance Log</Text>
              <View style={[styles.livePill, { backgroundColor: isToday ? C.success + "15" : C.border }]}>
                <View style={[styles.livePillDot, { backgroundColor: isToday ? C.success : C.textSecondary }]} />
                <Text style={[styles.livePillText, { color: isToday ? C.success : C.textSecondary }]}>
                  {isToday ? "Live" : "Historical"}
                </Text>
              </View>
            </View>

            {/* Table Head */}
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2 }]}>EMPLOYEE</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>CHECK-IN</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>CHECK-OUT</Text>
              <Text style={[styles.th, { flex: 1 }]}>DURATION</Text>
              <Text style={[styles.th, { flex: 1 }]}>STATUS</Text>
            </View>

            {attendanceQ.isLoading ? (
              <View style={styles.loadingState}>
                <Text style={{ color: C.textSecondary }}>Loading attendance...</Text>
              </View>
            ) : records.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={32} color={C.border} />
                <Text style={styles.emptyText}>No attendance records for this date</Text>
              </View>
            ) : (
              records.map((record, i) => {
                const duration = record.checkInTime && record.checkOutTime
                  ? calcDuration(record.checkInTime, record.checkOutTime)
                  : record.checkInTime ? "In progress" : "—";
                const initials = (record.employeeName ?? "?")
                  .split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

                return (
                  <View key={record.id ?? i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                    {/* Employee */}
                    <View style={[styles.td, { flex: 2, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                      <View style={[styles.empAvatar, { backgroundColor: record.checkInTime ? C.success + "18" : C.danger + "12" }]}>
                        <Text style={[styles.empAvatarText, { color: record.checkInTime ? C.success : C.danger }]}>
                          {initials}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.empName} numberOfLines={1}>{record.employeeName ?? "Unknown"}</Text>
                        {record.role && (
                          <Text style={styles.empRole}>{record.role}</Text>
                        )}
                      </View>
                    </View>
                    {/* Check-in */}
                    <View style={[styles.td, { flex: 1.2 }]}>
                      {record.checkInTime ? (
                        <View style={styles.timeWrap}>
                          <Ionicons name="log-in-outline" size={13} color={C.success} />
                          <Text style={[styles.timeText, { color: C.text }]}>
                            {formatTime(record.checkInTime)}
                          </Text>
                        </View>
                      ) : <Text style={styles.tdMuted}>—</Text>}
                    </View>
                    {/* Check-out */}
                    <View style={[styles.td, { flex: 1.2 }]}>
                      {record.checkOutTime ? (
                        <View style={styles.timeWrap}>
                          <Ionicons name="log-out-outline" size={13} color={C.accent} />
                          <Text style={[styles.timeText, { color: C.text }]}>
                            {formatTime(record.checkOutTime)}
                          </Text>
                        </View>
                      ) : record.checkInTime ? (
                        <Text style={[styles.tdMuted, { color: C.accent }]}>Still in</Text>
                      ) : <Text style={styles.tdMuted}>—</Text>}
                    </View>
                    {/* Duration */}
                    <View style={[styles.td, { flex: 1 }]}>
                      <Text style={duration === "In progress" ? [styles.durationText, { color: C.accent }] : styles.durationText}>
                        {duration}
                      </Text>
                    </View>
                    {/* Status */}
                    <View style={[styles.td, { flex: 1 }]}>
                      <StatusBadge record={record} />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: C.background },
  main: { flex: 1, marginLeft: 0, flexDirection: "column", height: "100vh" as any },
  topBar: {
    height: 68,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
  },
  pageTitle: { fontSize: 20, fontWeight: "800", color: C.text },
  pageSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  dateNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateNavBtn: {
    width: 34, height: 34, borderRadius: 9, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  dateNavBtnDisabled: { opacity: 0.4 },
  datePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.brand + "10", borderRadius: 9, borderWidth: 1, borderColor: C.brand + "25",
    paddingHorizontal: 12, paddingVertical: 7,
  },
  datePillText: { fontSize: 13, fontWeight: "600", color: C.brand },
  todayBtn: {
    backgroundColor: C.brand, borderRadius: 9,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  todayBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 28, gap: 22 },
  summaryRow: { flexDirection: "row", gap: 14 },
  summaryTile: {
    flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 18, borderTopWidth: 3, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
  },
  summaryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  summaryVal: { fontSize: 26, fontWeight: "800", color: C.text },
  summaryLbl: { fontSize: 11, fontWeight: "600", color: C.textSecondary },
  tableCard: {
    backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 12,
  },
  tableCardHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 20, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tableCardTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  livePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  livePillDot: { width: 7, height: 7, borderRadius: 4 },
  livePillText: { fontSize: 11, fontWeight: "700" },
  tableHead: {
    flexDirection: "row", paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  th: { fontSize: 10, fontWeight: "700", color: C.textSecondary, letterSpacing: 0.8 },
  tableRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tableRowAlt: { backgroundColor: "#F8FAFC" },
  td: {},
  tdMuted: { fontSize: 12, color: C.textSecondary },
  empAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  empAvatarText: { fontSize: 13, fontWeight: "700" },
  empName: { fontSize: 13, fontWeight: "700", color: C.text },
  empRole: { fontSize: 11, color: C.textSecondary, marginTop: 1, textTransform: "capitalize" },
  timeWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  timeText: { fontSize: 13, fontWeight: "600" },
  durationText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, alignSelf: "flex-start",
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  loadingState: { paddingVertical: 40, alignItems: "center" },
  emptyState: { paddingVertical: 50, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 13, color: C.textSecondary },
});
