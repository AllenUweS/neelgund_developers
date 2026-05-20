import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import {
  checkInAttendance,
  checkOutAttendance,
  deriveAttendanceStatus,
  getAttendanceSummaryByMonth,
  getAttendanceByMonth,
  getAttendanceByDate,
  adminCreateAttendance,
  getAttendanceToday,
  listUsers,
  submitAttendanceRegularization,
  listMyAttendanceRegularizations,
  listPendingAttendanceRegularizations,
  approveAttendanceRegularization,
} from "@/lib/api";
import type { AttendanceRecord, AttendanceSummaryRow, UserBasic, AttendanceRegularization } from "@/lib/types";
import { formatTime, formatDate, calcDuration, totalHoursWorked, localDateStr, todayISODate, thisMonthLocal, hhmmToIso, isValidIsoDate } from "@/lib/utils";
import { scheduleCheckoutReminder, cancelCheckoutReminder } from "@/lib/notifications";
import * as Location from "expo-location";

const C = Colors.light;


async function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === "web") return null;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

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

type AdminView = "daily" | "monthly";

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEmployee = user?.role === "employee" || user?.role === "transport";
  const isAdminOrManager =
    user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager";
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => thisMonthLocal());
  const [adminDate, setAdminDate] = useState(() => todayISODate());
  const [adminView, setAdminView] = useState<AdminView>("daily");
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    employeeId: "",
    date: todayISODate(),
    checkInTime: "",
    checkOutTime: "",
    notes: "",
  });
  const [showRegularizeModal, setShowRegularizeModal] = useState(false);
  const [regularizeForm, setRegularizeForm] = useState({
    attendanceId: 0,
    date: todayISODate(),
    checkInTime: "",
    checkOutTime: "",
    reason: "",
  });

  const topPad = insets.top + 67;
  const bottomPad = insets.bottom + 34 + 80;

  const todayQ = useQuery<AttendanceRecord | null>({
    queryKey: ["attendance-today"],
    queryFn: () => getAttendanceToday(),
    staleTime: 30_000,
  });

  const historyQ = useQuery<AttendanceRecord[]>({
    queryKey: ["attendance-history", selectedMonth],
    queryFn: () => getAttendanceByMonth(selectedMonth),
    enabled: isEmployee,
    staleTime: 60_000,
  });

  const adminDateQ = useQuery<AttendanceRecord[]>({
    queryKey: ["attendance-date", adminDate],
    queryFn: () => getAttendanceByDate(adminDate),
    enabled: isAdminOrManager,
    staleTime: 30_000,
  });

  const adminSummaryQ = useQuery<AttendanceSummaryRow[]>({
    queryKey: ["attendance-summary", selectedMonth],
    queryFn: () => getAttendanceSummaryByMonth(selectedMonth),
    enabled: isAdminOrManager && adminView === "monthly",
    staleTime: 60_000,
  });

  const usersQ = useQuery<UserBasic[]>({
    queryKey: ["users-basic"],
    queryFn: () => listUsers(),
    enabled: isAdminOrManager,
    staleTime: 5 * 60_000,
  });

  const myRegularizationsQ = useQuery<AttendanceRegularization[]>({
    queryKey: ["my-attendance-regularizations"],
    queryFn: () => listMyAttendanceRegularizations(),
    enabled: isEmployee,
    staleTime: 30_000,
  });

  const pendingRegularizationsQ = useQuery<AttendanceRegularization[]>({
    queryKey: ["pending-attendance-regularizations"],
    queryFn: () => listPendingAttendanceRegularizations(),
    enabled: isAdminOrManager,
    staleTime: 30_000,
  });

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const loc = await getLocation();
      await checkInAttendance({ latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      void scheduleCheckoutReminder();
    },
    onError: (e: Error) => Alert.alert("Check-in failed", e.message),
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const loc = await getLocation();
      await checkOutAttendance({ latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      void cancelCheckoutReminder();
    },
    onError: (e: Error) => Alert.alert("Check-out failed", e.message),
  });

  const manualEntryMutation = useMutation({
    mutationFn: async () => {
      if (!manualForm.employeeId) throw new Error("Please select an employee");
      if (!isValidIsoDate(manualForm.date)) throw new Error("Date must be a valid YYYY-MM-DD");
      const checkInISO = manualForm.checkInTime ? hhmmToIso(manualForm.date, manualForm.checkInTime) : null;
      const checkOutISO = manualForm.checkOutTime ? hhmmToIso(manualForm.date, manualForm.checkOutTime) : null;
      if (manualForm.checkInTime && !checkInISO) throw new Error("Check-in time must be HH:MM");
      if (manualForm.checkOutTime && !checkOutISO) throw new Error("Check-out time must be HH:MM");
      if (checkOutISO && !checkInISO) throw new Error("Check-in time is required when check-out is provided");
      const computedStatus = deriveAttendanceStatus(checkInISO, checkOutISO);
      await adminCreateAttendance({
        employeeId: manualForm.employeeId,
        date: manualForm.date,
        checkInTime: checkInISO,
        checkOutTime: checkOutISO,
        status: computedStatus,
        notes: manualForm.notes || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["attendance-date", adminDate] });
      qc.invalidateQueries({ queryKey: ["attendance-summary", selectedMonth] });
      setShowManualModal(false);
      setManualForm({
        employeeId: "",
        date: todayISODate(),
        checkInTime: "",
        checkOutTime: "",
        notes: "",
      });
      Alert.alert("Success", "Attendance record created");
    },
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const regularizeMutation = useMutation({
    mutationFn: async () => {
      if (!regularizeForm.attendanceId) throw new Error("Invalid attendance record");
      const checkInISO = regularizeForm.checkInTime ? hhmmToIso(regularizeForm.date, regularizeForm.checkInTime) : null;
      const checkOutISO = regularizeForm.checkOutTime ? hhmmToIso(regularizeForm.date, regularizeForm.checkOutTime) : null;
      if (regularizeForm.checkInTime && !checkInISO) throw new Error("Check-in time must be HH:MM");
      if (regularizeForm.checkOutTime && !checkOutISO) throw new Error("Check-out time must be HH:MM");
      if (checkOutISO && !checkInISO) throw new Error("Check-in time is required when check-out is provided");
      await submitAttendanceRegularization({
        attendanceId: regularizeForm.attendanceId,
        date: regularizeForm.date,
        requestedCheckInTime: checkInISO,
        requestedCheckOutTime: checkOutISO,
        reason: regularizeForm.reason || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-attendance-regularizations"] });
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      setShowRegularizeModal(false);
      setRegularizeForm({
        attendanceId: 0,
        date: todayISODate(),
        checkInTime: "",
        checkOutTime: "",
        reason: "",
      });
      Alert.alert("Success", "Regularization request submitted");
    },
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["attendance-today"] }),
      qc.invalidateQueries({ queryKey: ["attendance-history"] }),
      qc.invalidateQueries({ queryKey: ["attendance-date", adminDate] }),
      qc.invalidateQueries({ queryKey: ["attendance-summary", selectedMonth] }),
      qc.invalidateQueries({ queryKey: ["my-attendance-regularizations"] }),
      qc.invalidateQueries({ queryKey: ["pending-attendance-regularizations"] }),
    ]);
    setRefreshing(false);
  }, [qc, adminDate, selectedMonth]);

  const todayRecord = isEmployee ? todayQ.data : null;
  const historyRecords = isEmployee ? (historyQ.data ?? []) : [];
  const adminRecords = (adminDateQ.data ?? []) as AttendanceRecord[];
  const todayPresent = adminRecords.filter(r => r.status === "present").length;
  const todayPending = adminRecords.filter(r => !r.checkOutTime && r.checkInTime).length;

  const hasCheckedIn = !!todayRecord?.checkInTime;
  const hasCheckedOut = !!todayRecord?.checkOutTime;
  const todayReg = myRegularizationsQ.data?.find((r) => r.attendanceId === todayRecord?.id);

  // Sync checkout reminder with attendance state
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (hasCheckedIn && !hasCheckedOut) {
      void scheduleCheckoutReminder();
    } else {
      void cancelCheckoutReminder();
    }
  }, [hasCheckedIn, hasCheckedOut]);

  const handleCheckIn = () => {
    Alert.alert("Check In", "Record your attendance with current GPS location?", [
      { text: "Cancel", style: "cancel" },
      { text: "Check In", onPress: () => checkInMutation.mutate() },
    ]);
  };

  const handleCheckOut = () => {
    Alert.alert("Check Out", "Clock out for today?", [
      { text: "Cancel", style: "cancel" },
      { text: "Check Out", style: "destructive", onPress: () => checkOutMutation.mutate() },
    ]);
  };

  const isLoading = checkInMutation.isPending || checkOutMutation.isPending;

  const shiftMonth = (delta: number) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const d = new Date(year, month - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const shiftAdminDate = (delta: number) => {
    const d = new Date(adminDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const next = localDateStr(d);
    if (delta > 0 && next > todayISODate()) return;
    setAdminDate(next);
  };

  const users = (usersQ.data ?? []).filter(
    u => u.role === "employee" || u.role === "manager" || u.role === "transport",
  );

  const monthAttendanceSummary = {
    present: historyRecords.filter(r => r.status === "present").length,
    halfDay: historyRecords.filter(r => r.status === "half_day").length,
    absent: historyRecords.filter(r => r.status === "absent").length,
    totalHours: totalHoursWorked(historyRecords),
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Attendance</Text>
        <Text style={styles.subtitle}>
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </Text>
      </View>

      {/* Employee: Clock In/Out card */}
      {isEmployee && (
        <View style={styles.clockCard}>
          <View style={styles.clockCardTop}>
            <View>
              <Text style={styles.clockTitle}>Today's Attendance</Text>
              <Text style={styles.clockSubtitle}>
                {hasCheckedIn ? `Checked in at ${formatTime(todayRecord!.checkInTime)}` : "Not checked in yet"}
              </Text>
            </View>
            {todayRecord && (
              <StatusBadge
                status={todayRecord.status}
                checkInTime={todayRecord.checkInTime}
                checkOutTime={todayRecord.checkOutTime}
              />
            )}
          </View>

          {hasCheckedIn && (
            <View style={styles.timingRow}>
              <View style={styles.timeBox}>
                <Ionicons name="log-in-outline" size={18} color={C.success} />
                <View>
                  <Text style={styles.timeLabel}>Check In</Text>
                  <Text style={styles.timeValue}>{formatTime(todayRecord!.checkInTime)}</Text>
                  {todayRecord?.checkInLatitude ? (
                    <Text style={styles.coordText}>{todayRecord.checkInLatitude.toFixed(4)}, {todayRecord.checkInLongitude?.toFixed(4)}</Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.timeDivider} />
              <View style={styles.timeBox}>
                <Ionicons name="log-out-outline" size={18} color={hasCheckedOut ? C.danger : C.textSecondary} />
                <View>
                  <Text style={styles.timeLabel}>Check Out</Text>
                  <Text style={[styles.timeValue, !hasCheckedOut && { color: C.textSecondary }]}>
                    {hasCheckedOut ? formatTime(todayRecord!.checkOutTime) : "—"}
                  </Text>
                  {hasCheckedOut && calcDuration(todayRecord!.checkInTime, todayRecord!.checkOutTime) ? (
                    <Text style={styles.coordText}>{calcDuration(todayRecord!.checkInTime, todayRecord!.checkOutTime)} worked</Text>
                  ) : null}
                </View>
              </View>
            </View>
          )}

          {todayQ.isLoading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 16 }} />
          ) : !hasCheckedIn ? (
            <TouchableOpacity
              style={[styles.clockBtn, styles.clockBtnIn, isLoading && styles.clockBtnDisabled]}
              onPress={handleCheckIn}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="finger-print" size={22} color="#fff" />
                  <Text style={styles.clockBtnText}>Check In</Text>
                </>
              )}
            </TouchableOpacity>
          ) : !hasCheckedOut ? (
            <TouchableOpacity
              style={[styles.clockBtn, styles.clockBtnOut, isLoading && styles.clockBtnDisabled]}
              onPress={handleCheckOut}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="exit" size={22} color="#fff" />
                  <Text style={styles.clockBtnText}>Check Out</Text>
                </>
              )}
            </TouchableOpacity>
          ) : todayRecord?.status === "absent" ? (
            <View style={{ gap: 10 }}>
              <View style={[styles.doneRow, { justifyContent: "flex-start" }]}>
                <Ionicons name="close-circle" size={20} color={C.danger} />
                <Text style={[styles.doneText, { color: C.danger }]}>Marked absent</Text>
              </View>
              {todayReg?.status === "pending" ? (
                <View style={[styles.badge, { backgroundColor: C.warning + "18", alignSelf: "flex-start" }]}>
                  <Ionicons name="time" size={12} color={C.warning} />
                  <Text style={[styles.badgeText, { color: C.warning }]}>Regularization Pending</Text>
                </View>
              ) : todayReg?.status === "approved" ? (
                <View style={[styles.badge, { backgroundColor: C.success + "18", alignSelf: "flex-start" }]}>
                  <Ionicons name="checkmark-circle" size={12} color={C.success} />
                  <Text style={[styles.badgeText, { color: C.success }]}>Regularized</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.clockBtn, { backgroundColor: C.brand }]}
                  onPress={() => {
                    setRegularizeForm({
                      attendanceId: todayRecord!.id,
                      date: todayRecord!.date,
                      checkInTime: todayRecord!.checkInTime ? new Date(todayRecord!.checkInTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "",
                      checkOutTime: "",
                      reason: "",
                    });
                    setShowRegularizeModal(true);
                  }}
                >
                  <Ionicons name="create-outline" size={20} color="#fff" />
                  <Text style={styles.clockBtnText}>Request Regularization</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.doneRow}>
              <Ionicons name="checkmark-circle" size={20} color={C.success} />
              <Text style={styles.doneText}>All done for today!</Text>
            </View>
          )}
        </View>
      )}

      {/* Employee: Monthly History */}
      {isEmployee && (
        <View style={styles.section}>
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

          {/* Monthly summary pills */}
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

          <Text style={styles.sectionTitle}>This Month's Log</Text>
          {historyQ.isLoading ? (
            <ActivityIndicator color={C.brand} />
          ) : historyRecords.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={36} color={C.border} />
              <Text style={styles.emptyText}>No records this month</Text>
            </View>
          ) : (
            historyRecords.map(record => (
              <HistoryRow
                key={record.id}
                record={record}
                regularization={myRegularizationsQ.data?.find((r) => r.attendanceId === record.id)}
                onRegularize={record.status === "absent" ? () => {
                  setRegularizeForm({
                    attendanceId: record.id,
                    date: record.date,
                    checkInTime: record.checkInTime ? new Date(record.checkInTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "",
                    checkOutTime: "",
                    reason: "",
                  });
                  setShowRegularizeModal(true);
                } : undefined}
              />
            ))
          )}
        </View>
      )}

      {/* Admin/Manager */}
      {isAdminOrManager && (
        <>
          {/* View toggle: Daily / Monthly */}
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, adminView === "daily" && styles.toggleBtnActive]}
              onPress={() => setAdminView("daily")}
            >
              <Text style={[styles.toggleBtnText, adminView === "daily" && styles.toggleBtnTextActive]}>Daily</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, adminView === "monthly" && styles.toggleBtnActive]}
              onPress={() => setAdminView("monthly")}
            >
              <Text style={[styles.toggleBtnText, adminView === "monthly" && styles.toggleBtnTextActive]}>Monthly</Text>
            </TouchableOpacity>
          </View>

          {adminView === "daily" && (
            <>
              {/* Date navigator */}
              <View style={styles.dateNavRow}>
                <TouchableOpacity style={styles.monthNavBtn} onPress={() => shiftAdminDate(-1)}>
                  <Ionicons name="chevron-back" size={20} color={C.text} />
                </TouchableOpacity>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.monthLabel}>{formatDate(adminDate)}</Text>
                  {adminDate !== todayISODate() && (
                    <TouchableOpacity
                      style={styles.todayBtn}
                      onPress={() => setAdminDate(todayISODate())}
                    >
                      <Text style={styles.todayBtnText}>Today</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity style={styles.monthNavBtn} onPress={() => shiftAdminDate(1)} disabled={adminDate >= todayISODate()}>
                  <Ionicons name="chevron-forward" size={20} color={adminDate >= todayISODate() ? C.border : C.text} />
                </TouchableOpacity>
              </View>

              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={[styles.statBox, { borderLeftColor: C.success }]}>
                  <Text style={styles.statNum}>{todayPresent}</Text>
                  <Text style={styles.statLbl}>Present</Text>
                </View>
                <View style={[styles.statBox, { borderLeftColor: C.warning }]}>
                  <Text style={styles.statNum}>{todayPending}</Text>
                  <Text style={styles.statLbl}>Not Out</Text>
                </View>
                <View style={[styles.statBox, { borderLeftColor: C.brand }]}>
                  <Text style={styles.statNum}>{adminRecords.length}</Text>
                  <Text style={styles.statLbl}>Total</Text>
                </View>
              </View>

              <View style={[styles.section, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
                <Text style={styles.sectionTitle}>
                  {adminDate === todayISODate() ? "Today's Log" : `Log — ${adminDate}`}
                </Text>
                <TouchableOpacity style={styles.manualEntryBtn} onPress={() => setShowManualModal(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.manualEntryBtnText}>Manual Entry</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.section, { marginTop: 0 }]}>
                {adminDateQ.isLoading ? (
                  <ActivityIndicator color={C.brand} />
                ) : adminRecords.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={36} color={C.border} />
                    <Text style={styles.emptyText}>No check-ins for this date</Text>
                  </View>
                ) : (
                  adminRecords.map(record => <AdminRow key={record.id} record={record} />)
                )}
              </View>
            </>
          )}

          {adminView === "monthly" && (
            <>
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

              <View style={[styles.section, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
                <Text style={styles.sectionTitle}>Monthly Summary</Text>
                <TouchableOpacity style={styles.manualEntryBtn} onPress={() => setShowManualModal(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.manualEntryBtnText}>Manual Entry</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.section, { marginTop: 0 }]}>
                {adminSummaryQ.isLoading ? (
                  <ActivityIndicator color={C.brand} />
                ) : (adminSummaryQ.data ?? []).length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="bar-chart-outline" size={36} color={C.border} />
                    <Text style={styles.emptyText}>No data for this month</Text>
                  </View>
                ) : (
                  (adminSummaryQ.data ?? []).map(row => (
                    <SummaryRow
                      key={row.employeeId}
                      row={row}
                      onPress={() =>
                        router.push({
                          pathname: `/attendance/${row.employeeId}` as any,
                          params: { month: selectedMonth, name: row.employeeName ?? "" },
                        })
                      }
                    />
                  ))
                )}
              </View>
            </>
          )}
        </>
      )}

      {/* Manual Entry Modal */}
      <Modal visible={showManualModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowManualModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowManualModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Manual Attendance Entry</Text>
            <TouchableOpacity onPress={() => manualEntryMutation.mutate()} disabled={manualEntryMutation.isPending}>
              {manualEntryMutation.isPending
                ? <ActivityIndicator color={C.brand} size="small" />
                : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Employee *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {users.map(u => (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.empChip, manualForm.employeeId === String(u.id) && styles.empChipActive]}
                    onPress={() => setManualForm(f => ({ ...f, employeeId: String(u.id) }))}
                  >
                    <Text style={[styles.empChipText, manualForm.employeeId === String(u.id) && styles.empChipTextActive]}>
                      {u.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Date * (YYYY-MM-DD)</Text>
              {Platform.OS === "web" ? (
                <View style={[styles.fieldInput, { position: "relative", overflow: "hidden", justifyContent: "center" }]}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: manualForm.date ? C.text : C.placeholder }}>
                    {manualForm.date || "Select date"}
                  </Text>
                  <input
                    type="date"
                    max={todayISODate()}
                    value={manualForm.date || ""}
                    onChange={(e) => setManualForm(f => ({ ...f, date: e.target.value || "" }))}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      opacity: 0,
                      cursor: "pointer",
                      width: "100%",
                      height: "100%",
                    }}
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.fieldInput}
                  placeholder="e.g. 2026-03-21"
                  placeholderTextColor={C.placeholder}
                  value={manualForm.date}
                  onChangeText={v => setManualForm(f => ({ ...f, date: v }))}
                  autoCapitalize="none"
                />
              )}
            </View>

            <View style={styles.twoCol}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Check-in (HH:MM)</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="09:00"
                  placeholderTextColor={C.placeholder}
                  value={manualForm.checkInTime}
                  onChangeText={v => setManualForm(f => ({ ...f, checkInTime: v }))}
                  autoCapitalize="none"
                />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Check-out (HH:MM)</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="18:00"
                  placeholderTextColor={C.placeholder}
                  value={manualForm.checkOutTime}
                  onChangeText={v => setManualForm(f => ({ ...f, checkOutTime: v }))}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Status Rules</Text>
              <View style={styles.rulesCard}>
                <Text style={styles.rulesText}>8h or more = Present</Text>
                <Text style={styles.rulesText}>4h to less than 8h = Half Day</Text>
                <Text style={styles.rulesText}>Less than 4h = Absent</Text>
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.fieldInput, { height: 72, textAlignVertical: "top" }]}
                placeholder="Reason for manual entry..."
                placeholderTextColor={C.placeholder}
                value={manualForm.notes}
                onChangeText={v => setManualForm(f => ({ ...f, notes: v }))}
                multiline
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Regularization Modal */}
      <Modal visible={showRegularizeModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowRegularizeModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowRegularizeModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Request Regularization</Text>
            <TouchableOpacity onPress={() => regularizeMutation.mutate()} disabled={regularizeMutation.isPending}>
              {regularizeMutation.isPending
                ? <ActivityIndicator color={C.brand} size="small" />
                : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Date</Text>
              <Text style={[styles.fieldInput, { lineHeight: 48 }]}>{formatDate(regularizeForm.date)}</Text>
            </View>

            <View style={styles.twoCol}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Check-in (HH:MM)</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="09:00"
                  placeholderTextColor={C.placeholder}
                  value={regularizeForm.checkInTime}
                  onChangeText={v => setRegularizeForm(f => ({ ...f, checkInTime: v }))}
                  autoCapitalize="none"
                />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Check-out (HH:MM)</Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="18:00"
                  placeholderTextColor={C.placeholder}
                  value={regularizeForm.checkOutTime}
                  onChangeText={v => setRegularizeForm(f => ({ ...f, checkOutTime: v }))}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Status Rules</Text>
              <View style={styles.rulesCard}>
                <Text style={styles.rulesText}>8h or more = Present</Text>
                <Text style={styles.rulesText}>4h to less than 8h = Half Day</Text>
                <Text style={styles.rulesText}>Less than 4h = Absent</Text>
              </View>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Reason</Text>
              <TextInput
                style={[styles.fieldInput, { height: 72, textAlignVertical: "top" }]}
                placeholder="Reason for regularization..."
                placeholderTextColor={C.placeholder}
                value={regularizeForm.reason}
                onChangeText={v => setRegularizeForm(f => ({ ...f, reason: v }))}
                multiline
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const HistoryRow = React.memo(function HistoryRow({
  record,
  regularization,
  onRegularize,
}: {
  record: AttendanceRecord;
  regularization?: AttendanceRegularization;
  onRegularize?: () => void;
}) {
  const duration = calcDuration(record.checkInTime, record.checkOutTime);
  const showRegularize = record.status === "absent" && onRegularize;
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyDate}>
        <Text style={styles.historyDateNum}>{new Date(record.date + "T00:00:00").getDate()}</Text>
        <Text style={styles.historyDateMon}>{new Date(record.date + "T00:00:00").toLocaleDateString("en-IN", { month: "short" })}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyLabel}>{formatDate(record.date)}</Text>
        <View style={styles.historyTimes}>
          <Text style={styles.historyTime}><Text style={{ color: C.success }}>In</Text> {formatTime(record.checkInTime)}</Text>
          <Text style={styles.historyTimeDot}>·</Text>
          <Text style={styles.historyTime}><Text style={{ color: C.danger }}>Out</Text> {formatTime(record.checkOutTime)}</Text>
          {duration ? <Text style={styles.historyDur}> · {duration}</Text> : null}
        </View>
        {showRegularize && regularization?.status === "pending" ? (
          <View style={[styles.badge, { backgroundColor: C.warning + "18", alignSelf: "flex-start", marginTop: 4 }]}>
            <Ionicons name="time" size={10} color={C.warning} />
            <Text style={[styles.badgeText, { color: C.warning }]}>Regularization Pending</Text>
          </View>
        ) : showRegularize && regularization?.status === "approved" ? (
          <View style={[styles.badge, { backgroundColor: C.success + "18", alignSelf: "flex-start", marginTop: 4 }]}>
            <Ionicons name="checkmark-circle" size={10} color={C.success} />
            <Text style={[styles.badgeText, { color: C.success }]}>Regularized</Text>
          </View>
        ) : showRegularize ? (
          <TouchableOpacity onPress={onRegularize} style={{ marginTop: 4, alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand }}>Regularize</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <StatusBadge status={record.status} checkInTime={record.checkInTime} checkOutTime={record.checkOutTime} />
    </View>
  );
});

const AdminRow = React.memo(function AdminRow({ record }: { record: AttendanceRecord }) {
  const duration = calcDuration(record.checkInTime, record.checkOutTime);
  const isOut = !!record.checkOutTime;
  return (
    <View style={styles.adminRow}>
      <View style={[styles.adminAvatar, { backgroundColor: C.brand + "18" }]}>
        <Text style={styles.adminAvatarText}>{(record.employeeName ?? "?").charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.adminName}>{record.employeeName ?? `Employee #${record.employeeId}`}</Text>
        <View style={styles.adminTimes}>
          <Ionicons name="log-in-outline" size={13} color={C.success} />
          <Text style={styles.adminTime}>{formatTime(record.checkInTime)}</Text>
          {isOut && (
            <>
              <Ionicons name="log-out-outline" size={13} color={C.danger} />
              <Text style={styles.adminTime}>{formatTime(record.checkOutTime)}</Text>
            </>
          )}
          {duration ? <Text style={styles.adminDur}>{duration}</Text> : null}
        </View>
      </View>
      <View style={styles.adminRight}>
        <StatusBadge status={record.status} checkInTime={record.checkInTime} checkOutTime={record.checkOutTime} />
        {!isOut && record.checkInTime ? (
          <View style={[styles.badge, { backgroundColor: C.warning + "18", marginTop: 4 }]}>
            <Text style={[styles.badgeText, { color: C.warning }]}>In office</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

const SummaryRow = React.memo(function SummaryRow({ row, onPress }: { row: AttendanceSummaryRow; onPress?: () => void }) {
  const total = row.totalPresent + row.totalHalfDay + row.totalAbsent;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.summaryRowCard}>
      <View style={[styles.adminAvatar, { backgroundColor: C.brand + "18" }]}>
        <Text style={styles.adminAvatarText}>{(row.employeeName ?? "?").charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.adminName}>{row.employeeName ?? `Employee #${row.employeeId}`}</Text>
        <View style={styles.summaryStatRow}>
          <Text style={[styles.summaryStatItem, { color: C.success }]}>{row.totalPresent}P</Text>
          <Text style={styles.summaryStatDot}>·</Text>
          <Text style={[styles.summaryStatItem, { color: C.warning }]}>{row.totalHalfDay}H</Text>
          <Text style={styles.summaryStatDot}>·</Text>
          <Text style={[styles.summaryStatItem, { color: C.danger }]}>{row.totalAbsent}A</Text>
          {row.avgCheckIn ? (
            <>
              <Text style={styles.summaryStatDot}>·</Text>
              <Text style={[styles.summaryStatItem, { color: C.textSecondary }]}>Avg in: {row.avgCheckIn}</Text>
            </>
          ) : null}
        </View>
      </View>
      <View style={[styles.totalBadge]}>
        <Text style={styles.totalBadgeText}>{total}d</Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  clockCard: {
    margin: 16, backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8,
    elevation: 2, borderWidth: 1, borderColor: C.border,
  },
  clockCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  clockTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  clockSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  timingRow: { flexDirection: "row", backgroundColor: C.background, borderRadius: 14, padding: 14, gap: 12 },
  timeBox: { flex: 1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  timeDivider: { width: 1, backgroundColor: C.border },
  timeLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  timeValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  coordText: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  clockBtn: { borderRadius: 14, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  clockBtnIn: { backgroundColor: C.success },
  clockBtnOut: { backgroundColor: C.danger },
  clockBtnDisabled: { opacity: 0.6 },
  clockBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },

  doneRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  doneText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.success },

  viewToggle: { flexDirection: "row", marginHorizontal: 16, marginBottom: 8, backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  toggleBtnActive: { backgroundColor: C.brand },
  toggleBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  toggleBtnTextActive: { color: "#fff" },

  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  dateNavRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8, marginTop: 8 },
  monthNavBtn: { padding: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  monthLabel: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },

  monthlySummary: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  summaryPill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 12 },
  summaryPillText: { fontSize: 11, fontFamily: "Inter_700Bold" },

  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 4 },
  statBox: { flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 14, borderLeftWidth: 3, borderWidth: 1, borderColor: C.border, gap: 2, minHeight: 78 },
  statNum: { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },

  section: { paddingHorizontal: 16, marginTop: 8, gap: 8 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },

  manualEntryBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.brand, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  manualEntryBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  todayBtn: { backgroundColor: C.brand + "18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  todayBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.brand },

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

  adminRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: C.border },
  adminAvatar: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  adminAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.brand },
  adminName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  adminTimes: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  adminTime: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  adminDur: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.brand, marginLeft: 4 },
  adminRight: { alignItems: "flex-end" },

  summaryRowCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 13, borderWidth: 1, borderColor: C.border },
  summaryStatRow: { flexDirection: "row", alignItems: "center", marginTop: 3, gap: 4, flexWrap: "wrap" },
  summaryStatItem: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  summaryStatDot: { fontSize: 12, color: C.border },
  totalBadge: { backgroundColor: C.brand + "15", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  totalBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.brand },

  emptyState: { alignItems: "center", padding: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },

  modal: { flex: 1, backgroundColor: C.background, padding: 20, gap: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: { backgroundColor: C.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  twoCol: { flexDirection: "row", gap: 12 },
  empChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  empChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  empChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  empChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  rulesCard: { backgroundColor: C.surfaceSecondary, borderRadius: 12, padding: 12, gap: 4 },
  rulesText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
});
