import React, { useState, useCallback, useEffect, useRef } from "react";
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
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
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
  getMyOfficeLocation,
  listOfficeLocations,
  createOfficeLocation,
  updateOfficeLocation,
  deleteOfficeLocation,
  listOfficeAssignments,
  assignEmployeeToOffice,
  unassignEmployeeFromOffice,
  type OfficeLocation,
  type OfficeAssignment,
} from "@/lib/api";
import { LinearGradient } from "expo-linear-gradient";
import type { AttendanceRecord, AttendanceSummaryRow, UserBasic, AttendanceRegularization } from "@/lib/types";
import { formatTime, formatDate, calcDuration, totalHoursWorked, localDateStr, todayISODate, thisMonthLocal, hhmmToIso, isValidIsoDate } from "@/lib/utils";
import { scheduleCheckoutReminder, cancelCheckoutReminder } from "@/lib/notifications";
import * as Location from "expo-location";

const C = Colors.light;


async function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === "web") return null;
  try {
    // Use getForegroundPermissionsAsync (NOT request) — permissions are
    // already obtained via location-gate before the user reaches this screen.
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

// ─── Haversine distance (meters) ─────────────────────────────────────────────
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Geofence hook ────────────────────────────────────────────────────────────
type GeofenceState = {
  isInOffice: boolean;
  distanceMeters: number | null;
  officeLocation: OfficeLocation | null;
  loading: boolean;
  currentPosition: { latitude: number; longitude: number } | null;
  gpsPermissionDenied: boolean;
};

function useOfficeGeofence(enabled: boolean): GeofenceState {
  const [state, setState] = useState<GeofenceState>({
    // ✅ FIX 1: start false — never allow check-in before GPS check completes
    isInOffice: false,
    distanceMeters: null,
    officeLocation: null,
    loading: true,
    currentPosition: null,
    gpsPermissionDenied: false,
  });
  const officeRef = useRef<OfficeLocation | null | undefined>(undefined);

  // Fetch office location once on mount
  useEffect(() => {
    if (!enabled || Platform.OS === "web") {
      // On web we can't check GPS, allow freely
      setState(s => ({ ...s, isInOffice: true, loading: false }));
      return;
    }
    getMyOfficeLocation().then(office => {
      officeRef.current = office;
      if (!office) {
        // ✅ FIX 2: No office configured → allow check-in freely
        setState(s => ({ ...s, isInOffice: true, loading: false }));
      }
      // If office exists, GPS polling effect below will update state
    });
  }, [enabled]);

  // Poll GPS every 30 seconds
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let cancelled = false;

    const check = async () => {
      if (officeRef.current === undefined) return; // office not loaded yet
      const office = officeRef.current;
      if (!office) {
        setState(s => ({ ...s, isInOffice: true, loading: false }));
        return;
      }

      const pos = await getLocation();
      if (cancelled) return;

      // ✅ FIX 3: GPS unavailable → block check-in, show warning
      if (!pos) {
        setState(s => ({
          ...s,
          loading: false,
          isInOffice: false,
          gpsPermissionDenied: true,
        }));
        return;
      }

      const dist = haversineMeters(pos.latitude, pos.longitude, office.latitude, office.longitude);
      setState(s => ({
        ...s,
        isInOffice: dist <= office.radiusMeters,
        distanceMeters: Math.round(dist),
        officeLocation: office,
        loading: false,
        currentPosition: pos,
        gpsPermissionDenied: false,
      }));
    };

    // Wait for office fetch to complete, then start polling
    const waitAndCheck = async () => {
      let tries = 0;
      while (officeRef.current === undefined && tries < 20) {
        await new Promise(r => setTimeout(r, 300));
        tries++;
      }
      if (!cancelled) check();
    };
    waitAndCheck();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled]);

  return state;
}

// ─── Elapsed-time timer ───────────────────────────────────────────────────────
function useElapsedTimer(checkInTime: string | null | undefined, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active || !checkInTime) {
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const start = new Date(checkInTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [checkInTime, active]);
  return elapsed;
}

function WorkTimer({ checkInTime }: { checkInTime: string }) {
  const elapsed = useElapsedTimer(checkInTime, true);
  const hh = Math.floor(elapsed / 3600);
  const mm = Math.floor((elapsed % 3600) / 60);
  const ss = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <View style={timerStyles.row}>
      <View style={timerStyles.box}>
        <Text style={timerStyles.digits}>{pad(hh)}</Text>
        <Text style={timerStyles.unit}>HRS</Text>
      </View>
      <Text style={timerStyles.colon}>:</Text>
      <View style={timerStyles.box}>
        <Text style={timerStyles.digits}>{pad(mm)}</Text>
        <Text style={timerStyles.unit}>MIN</Text>
      </View>
      <Text style={timerStyles.colon}>:</Text>
      <View style={timerStyles.box}>
        <Text style={timerStyles.digits}>{pad(ss)}</Text>
        <Text style={timerStyles.unit}>SEC</Text>
      </View>
    </View>
  );
}

function WorkTimerDone({ checkInTime, checkOutTime, status }: { checkInTime: string; checkOutTime: string; status: string | null }) {
  const elapsed = Math.max(0, Math.floor((new Date(checkOutTime).getTime() - new Date(checkInTime).getTime()) / 1000));
  const hh = Math.floor(elapsed / 3600);
  const mm = Math.floor((elapsed % 3600) / 60);
  const ss = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const statusLabel = status === "present" ? "Full Day ✓" : status === "half_day" ? "Half Day" : status === "absent" ? "Absent" : null;
  const statusColor = status === "present" ? C.success : status === "half_day" ? C.warning : C.danger;
  return (
    <View style={{ gap: 8 }}>
      <View style={timerStyles.row}>
        <View style={[timerStyles.box, timerStyles.boxDone]}>
          <Text style={[timerStyles.digits, timerStyles.digitsDone]}>{pad(hh)}</Text>
          <Text style={timerStyles.unit}>HRS</Text>
        </View>
        <Text style={[timerStyles.colon, { color: C.textSecondary }]}>:</Text>
        <View style={[timerStyles.box, timerStyles.boxDone]}>
          <Text style={[timerStyles.digits, timerStyles.digitsDone]}>{pad(mm)}</Text>
          <Text style={timerStyles.unit}>MIN</Text>
        </View>
        <Text style={[timerStyles.colon, { color: C.textSecondary }]}>:</Text>
        <View style={[timerStyles.box, timerStyles.boxDone]}>
          <Text style={[timerStyles.digits, timerStyles.digitsDone]}>{pad(ss)}</Text>
          <Text style={timerStyles.unit}>SEC</Text>
        </View>
      </View>
      {statusLabel && (
        <View style={[timerStyles.statusPill, { backgroundColor: statusColor + "18" }]}>
          <Text style={[timerStyles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      )}
    </View>
  );
}

const timerStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  box: {
    width: 76, height: 72, borderRadius: 14,
    backgroundColor: C.accent + "15", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.accent + "40", gap: 2,
  },
  boxDone: { backgroundColor: C.surfaceSecondary, borderColor: C.border },
  digits: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.accent, letterSpacing: 1 },
  digitsDone: { color: C.text, fontSize: 26 },
  unit: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: C.textSecondary, letterSpacing: 1.2 },
  colon: { fontSize: 26, fontFamily: "Inter_700Bold", color: C.accent, marginBottom: 14 },
  statusPill: { alignSelf: "center", paddingHorizontal: 16, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
});

// ─── 12-hour clock time picker ────────────────────────────────────────────────
// value/onChange use HH:MM (24h) so the rest of the app stays unchanged.
// Display is 12h with AM/PM slots rendered as tappable hour chips.
// ─── Simple 12h time picker: manual HH:MM input + AM/PM toggle ───────────────
// value/onChange use HH:MM 24h internally. minTime (HH:MM 24h) blocks past times.
function ClockTimePicker({
  label, value, onChange, minTime,
}: {
  label: string;
  value: string;       // HH:MM 24h
  onChange: (v: string) => void;
  minTime?: string;    // HH:MM 24h — checkout can't be before check-in
}) {
  // Parse current value into 12h display
  const to12 = (h24: number) => {
    const ampm: "AM" | "PM" = h24 < 12 ? "AM" : "PM";
    const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
    return { h12, ampm };
  };
  const to24 = (h12: number, ampm: "AM" | "PM") =>
    ampm === "AM" ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);

  const [h24raw, mmRaw] = value ? value.split(":").map(Number) : [9, 0];
  const { h12, ampm } = to12(h24raw ?? 9);
  const mm = mmRaw ?? 0;

  // Local text state so user can type freely; we only emit on valid input
  const [hourText, setHourText] = useState(String(h12));
  const [minText, setMinText] = useState(String(mm).padStart(2, "0"));

  // Keep local text in sync when value changes externally
  useEffect(() => {
    const [eh, em] = value ? value.split(":").map(Number) : [9, 0];
    const { h12: dh } = to12(eh ?? 9);
    setHourText(String(dh));
    setMinText(String(em ?? 0).padStart(2, "0"));
  }, [value]);

  const emit = (newH12: number, newMm: number, newAmpm: "AM" | "PM") => {
    const h = Math.max(1, Math.min(12, newH12));
    const m = Math.max(0, Math.min(59, newMm));
    const h24 = to24(h, newAmpm);
    const candidate = `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    // Block if before minTime
    if (minTime && candidate < minTime) return;
    onChange(candidate);
  };

  const handleHourBlur = () => {
    const n = parseInt(hourText, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) emit(n, mm, ampm);
    else setHourText(String(h12)); // reset to last valid
  };
  const handleMinBlur = () => {
    const n = parseInt(minText, 10);
    if (!isNaN(n) && n >= 0 && n <= 59) emit(h12, n, ampm);
    else setMinText(String(mm).padStart(2, "0")); // reset
  };
  const toggleAmpm = (ap: "AM" | "PM") => emit(h12, mm, ap);

  return (
    <View style={cpStyles.wrap}>
      <View style={cpStyles.labelRow}>
        <Ionicons name="time-outline" size={14} color={C.brand} />
        <Text style={cpStyles.label}>{label}</Text>
        {value ? (
          <View style={cpStyles.previewPill}>
            <Text style={cpStyles.previewText}>{h12}:{String(mm).padStart(2, "0")} {ampm}</Text>
          </View>
        ) : null}
      </View>

      <View style={cpStyles.inputRow}>
        {/* Hour */}
        <TextInput
          style={cpStyles.timeInput}
          value={hourText}
          onChangeText={t => { setHourText(t); const n = parseInt(t, 10); if (!isNaN(n) && n >= 1 && n <= 12) emit(n, mm, ampm); }}
          onBlur={handleHourBlur}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          placeholder="12"
          placeholderTextColor={C.border}
        />
        <Text style={cpStyles.colonText}>:</Text>
        {/* Minutes */}
        <TextInput
          style={cpStyles.timeInput}
          value={minText}
          onChangeText={t => { setMinText(t); const n = parseInt(t, 10); if (!isNaN(n) && n >= 0 && n <= 59) emit(h12, n, ampm); }}
          onBlur={handleMinBlur}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          placeholder="00"
          placeholderTextColor={C.border}
        />
        {/* AM / PM */}
        <View style={cpStyles.ampmGroup}>
          {(["AM", "PM"] as const).map(ap => (
            <TouchableOpacity
              key={ap}
              style={[cpStyles.ampmBtn, ampm === ap && cpStyles.ampmBtnActive]}
              onPress={() => toggleAmpm(ap)}
            >
              <Text style={[cpStyles.ampmText, ampm === ap && cpStyles.ampmTextActive]}>{ap}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const cpStyles = StyleSheet.create({
  wrap: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 12, gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, flex: 1 },
  previewPill: { backgroundColor: C.brand + "18", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  previewText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.brand },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  timeInput: {
    flex: 1, height: 48, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border,
    textAlign: "center", fontSize: 20, fontFamily: "Inter_700Bold", color: C.text,
  },
  colonText: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.brand },
  ampmGroup: { flexDirection: "column", gap: 4 },
  ampmBtn: { width: 40, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  ampmBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  ampmText: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.textSecondary },
  ampmTextActive: { color: "#fff" },
});



function StatusBadge({
  status,
  checkInTime,
  checkOutTime,
  date,
}: {
  status: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  date?: string | null;
}) {
  // "In Progress" = checked in today but not yet checked out (and status isn't absent)
  const isToday = date ? date === localDateStr(new Date()) : false;
  // Past day with no checkout = absent (regardless of DB status field)
  const isPastNoCheckout = !!checkInTime && !checkOutTime && !isToday;
  const isInProgress = !!checkInTime && !checkOutTime && isToday && status !== "absent";
  // Compute effective status: past days with no checkout are absent
  const effectiveStatus = isPastNoCheckout ? "absent" : status;
  const config = isInProgress
    ? { color: C.accent, label: "In Progress", icon: "time" as const }
    : ({
      present: { color: C.success, label: "Present", icon: "checkmark-circle" },
      half_day: { color: C.warning, label: "Half Day", icon: "time" },
      absent: { color: C.danger, label: "Absent", icon: "close-circle" },
    }[effectiveStatus ?? ""] ?? { color: C.textSecondary, label: "Unknown", icon: "help-circle" });

  return (
    <View style={[styles.badge, { backgroundColor: config.color + "18" }]}>
      <Ionicons name={config.icon as "checkmark-circle"} size={12} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

// ─── Employee Check-In / Check-Out Card ───────────────────────────────────────
function EmployeeClockCard({
  todayRecord,
  isLoading,
  onSuccess,
}: {
  todayRecord: AttendanceRecord | null;
  isLoading: boolean;
  onSuccess: () => void;
}) {
  const geofence = useOfficeGeofence(true);

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const loc = geofence.currentPosition ?? await getLocation();
      await checkInAttendance({ latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null });
    },
    onSuccess,
    onError: (e: Error) => Alert.alert("Check-in failed", e.message),
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const loc = geofence.currentPosition ?? await getLocation();
      await checkOutAttendance({ latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null });
    },
    onSuccess,
    onError: (e: Error) => Alert.alert("Check-out failed", e.message),
  });

  const hasCheckedIn = !!todayRecord?.checkInTime;
  const hasCheckedOut = !!todayRecord?.checkOutTime;
  const isProcessing = checkInMutation.isPending || checkOutMutation.isPending;

  // ✅ FIX: Disabled when loading OR not in office. Mirrors CheckInCard exactly.
  const isCheckInDisabled = geofence.loading || !geofence.isInOffice;
  const isCheckOutDisabled = geofence.loading || !geofence.isInOffice;

  return (
    <View style={styles.clockCard}>
      <View style={styles.clockCardTop}>
        <View>
          <Text style={styles.clockTitle}>Today's Attendance</Text>
          <Text style={styles.clockSubtitle}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
          </Text>
        </View>
        {todayRecord && (
          <StatusBadge
            status={todayRecord.status}
            checkInTime={todayRecord.checkInTime}
            checkOutTime={todayRecord.checkOutTime}
            date={todayRecord.date}
          />
        )}
      </View>

      {/* ─── Geofence banners ─────────────────────────────────────────────── */}

      {/* 1. Still fetching location */}
      {geofence.loading && !hasCheckedIn && !isLoading && (
        <View style={[styles.geofenceBanner, { backgroundColor: C.surfaceSecondary }]}>
          <ActivityIndicator size="small" color={C.brand} />
          <Text style={[styles.geofenceBannerText, { color: C.textSecondary }]}>
            Checking your location…
          </Text>
        </View>
      )}

      {/* 2. GPS permission denied */}
      {!geofence.loading && geofence.gpsPermissionDenied && (
        <View style={[styles.geofenceBanner, { backgroundColor: C.warning + "18" }]}>
          <Ionicons name="warning-outline" size={14} color={C.warning} />
          <Text style={[styles.geofenceBannerText, { color: C.warning }]}>
            Location permission required — please enable it in Settings to check in
          </Text>
        </View>
      )}

      {/* 3. Office location set — show inside/outside status */}
      {geofence.officeLocation && !geofence.loading && !geofence.gpsPermissionDenied && (
        <View style={[
          styles.geofenceBanner,
          { backgroundColor: geofence.isInOffice ? C.success + "15" : C.danger + "12" },
        ]}>
          <Ionicons
            name={geofence.isInOffice ? "checkmark-circle" : "location-outline"}
            size={14}
            color={geofence.isInOffice ? C.success : C.danger}
          />
          <Text style={[styles.geofenceBannerText, { color: geofence.isInOffice ? C.success : C.danger }]}>
            {geofence.isInOffice
              ? `✓ You are at ${geofence.officeLocation.name}`
              : `📍 ${geofence.distanceMeters}m away from ${geofence.officeLocation.name} — move closer to check in`}
          </Text>
        </View>
      )}

      {/* Timer */}
      {isLoading ? (
        <ActivityIndicator color={C.brand} style={{ alignSelf: "center", marginVertical: 8 }} />
      ) : hasCheckedIn && hasCheckedOut && todayRecord ? (
        <WorkTimerDone
          checkInTime={todayRecord.checkInTime!}
          checkOutTime={todayRecord.checkOutTime!}
          status={todayRecord.status}
        />
      ) : hasCheckedIn && todayRecord ? (
        <WorkTimer checkInTime={todayRecord.checkInTime!} />
      ) : null}

      {/* Check-in / Check-out times row */}
      {todayRecord?.checkInTime && (
        <View style={styles.timingRow}>
          <View style={styles.timeBox}>
            <Ionicons name="log-in-outline" size={18} color={C.success} />
            <View>
              <Text style={styles.timeLabel}>Check-in</Text>
              <Text style={styles.timeValue}>{formatTime(todayRecord.checkInTime)}</Text>
            </View>
          </View>
          {todayRecord.checkOutTime && (
            <>
              <View style={styles.timeDivider} />
              <View style={styles.timeBox}>
                <Ionicons name="log-out-outline" size={18} color={C.danger} />
                <View>
                  <Text style={styles.timeLabel}>Check-out</Text>
                  <Text style={styles.timeValue}>{formatTime(todayRecord.checkOutTime)}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      )}

      {/* Action button */}
      {isLoading ? null : !hasCheckedOut ? (
        <TouchableOpacity
          style={[
            styles.clockBtn,
            hasCheckedIn ? styles.clockBtnOut : styles.clockBtnIn,
            (isProcessing || (hasCheckedIn ? isCheckOutDisabled : isCheckInDisabled)) && styles.clockBtnDisabled,
          ]}
          onPress={() => hasCheckedIn ? checkOutMutation.mutate() : checkInMutation.mutate()}
          disabled={isProcessing || (hasCheckedIn ? isCheckOutDisabled : isCheckInDisabled)}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name={hasCheckedIn ? "log-out-outline" : "log-in-outline"} size={20} color="#fff" />
              <Text style={styles.clockBtnText}>{hasCheckedIn ? "Check Out" : "Check In"}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      {hasCheckedIn && hasCheckedOut && (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={18} color={C.success} />
          <Text style={styles.doneText}>Attendance marked for today</Text>
        </View>
      )}
    </View>
  );
}

type AdminView = "daily" | "monthly";

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEmployee = user?.role === "employee" || user?.role === "transport";
  // HR sees the full admin panel (same as admin/manager), not the employee view
  const isAdminOrManager =
    user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager" || user?.role === "hr";
  // HR can also check-in/out themselves — they see both their own card and the team panel
  const isHR = user?.role === "hr";
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

  // ── Geofence & check-in state ──────────────────────────────────────────────
  const [showOfficeModal, setShowOfficeModal] = useState(false);
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | string>("all");
  const [empSearchText, setEmpSearchText] = useState("");

  // ── Export modal state ──────────────────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportForm, setExportForm] = useState({
    startDate: todayISODate(),
    endDate: todayISODate(),
    selectedEmployeeIds: [] as string[],
  });
  const [exportLoading, setExportLoading] = useState(false);
  const [exportEmpSearch, setExportEmpSearch] = useState("");

  const topPad = 16;
  const bottomPad = insets.bottom + 120;

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
  const rawAdminRecords = (adminDateQ.data ?? []) as AttendanceRecord[];

  // Only show employees who actually have a check-in record for this date
  const adminRecords = React.useMemo(() => {
    if (!isAdminOrManager) return [];
    // rawAdminRecords = real DB rows only (people who checked in)
    return rawAdminRecords;
  }, [rawAdminRecords, isAdminOrManager]);

  // Filtered view: by specific employee or show all
  const filteredAdminRecords = React.useMemo(() => {
    if (attendanceFilter === "all") return adminRecords;
    return adminRecords.filter(r => r.employeeId === attendanceFilter);
  }, [adminRecords, attendanceFilter]);

  const todayPresent = adminRecords.filter(r => r.status === "present" || r.status === "half_day").length;
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



  const shiftMonth = (delta: number) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const d = new Date(year, month - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleSmartExport = async () => {
    setExportLoading(true);
    try {
      const { startDate, endDate, selectedEmployeeIds } = exportForm;
      if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
        Alert.alert("Invalid dates", "Please enter valid YYYY-MM-DD dates.");
        return;
      }
      if (startDate > endDate) {
        Alert.alert("Invalid range", "Start date must be on or before end date.");
        return;
      }

      // Collect all dates in range
      const dates: string[] = [];
      const cur = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      while (cur <= end) {
        dates.push(localDateStr(cur));
        cur.setDate(cur.getDate() + 1);
      }

      // Fetch records for all dates in parallel (cap at 31 days)
      const capped = dates.slice(0, 31);
      const allRecordsByDate = await Promise.all(capped.map(d => getAttendanceByDate(d)));
      let allRecords = allRecordsByDate.flat();

      // Filter by selected employees if not "All"
      if (selectedEmployeeIds.length > 0) {
        allRecords = allRecords.filter(r => selectedEmployeeIds.includes(r.employeeId));
      }

      if (allRecords.length === 0) {
        Alert.alert("Nothing to export", "No attendance records found for the selected filters.");
        return;
      }

      const rows = allRecords
        .sort((a, b) => a.date.localeCompare(b.date) || (a.employeeName ?? "").localeCompare(b.employeeName ?? ""))
        .map(record => ({
          "Employee": record.employeeName ?? "Unknown",
          "Date": record.date,
          "Check-In": record.checkInTime ? formatTime(record.checkInTime) : "—",
          "Check-Out": record.checkOutTime ? formatTime(record.checkOutTime) : "—",
          "Duration": record.checkInTime && record.checkOutTime
            ? calcDuration(record.checkInTime, record.checkOutTime)
            : record.checkInTime ? "In progress" : "—",
          "Status": record.status === "present" ? "Present"
            : record.status === "half_day" ? "Half Day"
            : record.status === "absent" ? "Absent" : "Pending",
          "Notes": record.notes ?? "",
        }));

      const ws = XLSX.utils.json_to_sheet(rows);
      // Auto-width columns
      const colWidths = Object.keys(rows[0] ?? {}).map(key => ({
        wch: Math.max(key.length, ...rows.map(r => String((r as any)[key] ?? "").length)) + 2,
      }));
      ws["!cols"] = colWidths;

      const wb = XLSX.utils.book_new();
      const sheetName = selectedEmployeeIds.length === 1
        ? (users.find(u => String(u.id) === selectedEmployeeIds[0])?.name ?? "Attendance").slice(0, 31)
        : "Attendance";
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const label = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
      const filename = `Attendance_${label}.xlsx`;
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: "base64" });
      await Sharing.shareAsync(uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dialogTitle: "Export Attendance",
        UTI: "com.microsoft.excel.xlsx",
      });
      setShowExportModal(false);
    } catch (err: any) {
      Alert.alert("Export Failed", err.message || "Could not export attendance data.");
    } finally {
      setExportLoading(false);
    }
  };

  const shiftAdminDate = (delta: number) => {
    const d = new Date(adminDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const next = localDateStr(d);
    if (delta > 0 && next > todayISODate()) return;
    setAdminDate(next);
    setAttendanceFilter("all");
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
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        scrollIndicatorInsets={{ bottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.subtitle}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </Text>
        </View>



        {/* Employee: Monthly History */}
        {isEmployee && (
          <EmployeeClockCard
            todayRecord={todayRecord ?? null}
            isLoading={todayQ.isLoading}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["attendance-today"] });
              qc.invalidateQueries({ queryKey: ["attendance-history", selectedMonth] });
            }}
          />
        )}

        {/* HR: also show their own check-in card above the team panel */}
        {isHR && (
          <EmployeeClockCard
            todayRecord={todayQ.data ?? null}
            isLoading={todayQ.isLoading}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["attendance-today"] });
              qc.invalidateQueries({ queryKey: ["attendance-date", adminDate] });
            }}
          />
        )}

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
            {/* Manage Offices button — admin, super_admin, HR, and manager can
                open it. Editing coordinates/radius stays admin-only inside
                the modal; assigning employees to offices is open to all four. */}
            <View style={{ paddingHorizontal: 16, marginBottom: 4, alignItems: "flex-end" }}>
              <TouchableOpacity style={styles.manageOfficesBtn} onPress={() => setShowOfficeModal(true)}>
                <Ionicons name="business-outline" size={14} color={C.brand} />
                <Text style={styles.manageOfficesBtnText}>Manage Offices</Text>
              </TouchableOpacity>
            </View>

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
                        onPress={() => { setAdminDate(todayISODate()); setAttendanceFilter("all"); }}
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

                {/* Log header + action buttons */}
                <View style={[styles.section, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}>
                  <Text style={[styles.sectionTitle, { flex: 1 }]}>
                    {adminDate === todayISODate() ? "Today's Log" : `Log — ${adminDate}`}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={[styles.manualEntryBtn, { backgroundColor: C.accent }]} onPress={() => {
                      setExportForm({ startDate: adminDate, endDate: adminDate, selectedEmployeeIds: [] });
                      setExportEmpSearch("");
                      setShowExportModal(true);
                    }}>
                      <Ionicons name="download" size={16} color="#fff" />
                      <Text style={styles.manualEntryBtnText}>Export</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.manualEntryBtn} onPress={() => setShowManualModal(true)}>
                      <Ionicons name="add" size={16} color="#fff" />
                      <Text style={styles.manualEntryBtnText}>Manual Entry</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Filter bar: All | individual employee chips */}
                {adminRecords.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 4 }}
                  >
                    <TouchableOpacity
                      style={[extraStyles.filterChip, attendanceFilter === "all" && extraStyles.filterChipActive]}
                      onPress={() => setAttendanceFilter("all")}
                    >
                      <Text style={[extraStyles.filterChipText, attendanceFilter === "all" && extraStyles.filterChipTextActive]}>
                        All ({adminRecords.length})
                      </Text>
                    </TouchableOpacity>
                    {adminRecords.map(r => (
                      <TouchableOpacity
                        key={r.employeeId}
                        style={[extraStyles.filterChip, attendanceFilter === r.employeeId && extraStyles.filterChipActive]}
                        onPress={() => setAttendanceFilter(prev => prev === r.employeeId ? "all" : r.employeeId)}
                      >
                        <View style={extraStyles.filterChipAvatar}>
                          <Text style={[extraStyles.filterChipAvatarText, attendanceFilter === r.employeeId && { color: "#fff" }]}>
                            {(r.employeeName ?? "?").charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[extraStyles.filterChipText, attendanceFilter === r.employeeId && extraStyles.filterChipTextActive]} numberOfLines={1}>
                          {r.employeeName ?? `#${r.employeeId}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                <View style={[styles.section, { marginTop: 0 }]}>
                  {adminDateQ.isLoading ? (
                    <ActivityIndicator color={C.brand} />
                  ) : adminRecords.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="people-outline" size={36} color={C.border} />
                      <Text style={styles.emptyText}>No check-ins for this date</Text>
                    </View>
                  ) : filteredAdminRecords.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="search-outline" size={36} color={C.border} />
                      <Text style={styles.emptyText}>No records match the filter</Text>
                    </View>
                  ) : (
                    filteredAdminRecords.map(record => {
                      const reg = pendingRegularizationsQ.data?.find(r => r.attendanceId === record.id);
                      return (
                        <AdminRow
                          key={record.id}
                          record={record}
                          regularization={reg}
                        />
                      );
                    })
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
          <View style={[styles.modal, { paddingTop: Math.max(insets.top, 20), backgroundColor: C.background }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowManualModal(false)} style={styles.modalHeaderIconBtn}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Manual Entry</Text>
              <TouchableOpacity
                onPress={() => manualEntryMutation.mutate()}
                disabled={manualEntryMutation.isPending}
                style={[styles.modalHeaderIconBtn, { backgroundColor: C.brand + "15" }]}
              >
                {manualEntryMutation.isPending
                  ? <ActivityIndicator color={C.brand} size="small" />
                  : <Ionicons name="checkmark" size={24} color={C.brand} />}
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 24, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="people-outline" size={18} color={C.textSecondary} />
                  <Text style={styles.fieldLabel}>Select Employee</Text>
                </View>

                {/* Search box */}
                <View style={extraStyles.empSearchBox}>
                  <Ionicons name="search-outline" size={16} color={C.textSecondary} />
                  <TextInput
                    style={extraStyles.empSearchInput}
                    placeholder="Search by name..."
                    placeholderTextColor={C.placeholder}
                    value={empSearchText}
                    onChangeText={setEmpSearchText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {empSearchText.length > 0 && (
                    <TouchableOpacity onPress={() => setEmpSearchText("")}>
                      <Ionicons name="close-circle" size={16} color={C.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Selected employee pill */}
                {manualForm.employeeId ? (() => {
                  const sel = users.find(u => String(u.id) === manualForm.employeeId);
                  return sel ? (
                    <View style={extraStyles.selectedEmpPill}>
                      <View style={extraStyles.selectedEmpAvatar}>
                        <Text style={extraStyles.selectedEmpAvatarText}>{sel.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={extraStyles.selectedEmpName}>{sel.name}</Text>
                      <Text style={extraStyles.selectedEmpRole}>{sel.role}</Text>
                      <TouchableOpacity onPress={() => setManualForm(f => ({ ...f, employeeId: "" }))} style={{ marginLeft: "auto" }}>
                        <Ionicons name="close-circle" size={18} color={C.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  ) : null;
                })() : null}

                {/* Dropdown list — only show when searching or no selection */}
                {(!manualForm.employeeId || empSearchText.length > 0) && (
                  <View style={extraStyles.empDropdown}>
                    {users
                      .filter(u => empSearchText.length === 0 || u.name.toLowerCase().includes(empSearchText.toLowerCase()))
                      .map(u => {
                        const isSelected = manualForm.employeeId === String(u.id);
                        const roleColor = u.role === "manager" ? C.accent : C.brand;
                        return (
                          <TouchableOpacity
                            key={u.id}
                            style={[extraStyles.empDropdownItem, isSelected && extraStyles.empDropdownItemActive]}
                            onPress={() => {
                              setManualForm(f => ({ ...f, employeeId: String(u.id) }));
                              setEmpSearchText("");
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={[extraStyles.empDropdownAvatar, { backgroundColor: roleColor + "20" }]}>
                              <Text style={[extraStyles.empDropdownAvatarText, { color: roleColor }]}>
                                {u.name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[extraStyles.empDropdownName, isSelected && { color: C.brand }]}>{u.name}</Text>
                              <Text style={extraStyles.empDropdownRole}>{u.role}</Text>
                            </View>
                            {isSelected && <Ionicons name="checkmark-circle" size={20} color={C.brand} />}
                          </TouchableOpacity>
                        );
                      })}
                    {users.filter(u => empSearchText.length === 0 || u.name.toLowerCase().includes(empSearchText.toLowerCase())).length === 0 && (
                      <View style={{ padding: 16, alignItems: "center" }}>
                        <Text style={{ color: C.textSecondary, fontFamily: "Inter_400Regular", fontSize: 13 }}>No employees found</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="calendar-outline" size={18} color={C.textSecondary} />
                  <Text style={styles.fieldLabel}>Date (YYYY-MM-DD)</Text>
                </View>
                {Platform.OS === "web" ? (
                  <View style={[styles.fieldInput, { position: "relative", overflow: "hidden", justifyContent: "center", backgroundColor: C.card }]}>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_500Medium", color: manualForm.date ? C.text : C.placeholder }}>
                      {manualForm.date || "Select date"}
                    </Text>
                    <input
                      type="date"
                      max={todayISODate()}
                      value={manualForm.date || ""}
                      onChange={(e) => setManualForm(f => ({ ...f, date: e.target.value || "" }))}
                      style={{
                        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                        opacity: 0, cursor: "pointer", width: "100%", height: "100%",
                      }}
                    />
                  </View>
                ) : (
                  <TextInput
                    style={[styles.fieldInput, { backgroundColor: C.card, fontSize: 16, fontFamily: "Inter_500Medium" }]}
                    placeholder="e.g. 2026-03-21"
                    placeholderTextColor={C.placeholder}
                    value={manualForm.date}
                    onChangeText={v => setManualForm(f => ({ ...f, date: v }))}
                    autoCapitalize="none"
                  />
                )}
              </View>

              <View style={styles.timeGrid}>
                <View style={styles.timeSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="log-in-outline" size={18} color={C.success} />
                    <Text style={styles.fieldLabel}>Check-in</Text>
                  </View>
                  <ClockTimePicker
                    label=""
                    value={manualForm.checkInTime}
                    onChange={v => setManualForm(f => ({ ...f, checkInTime: v }))}
                  />
                </View>
                <View style={styles.timeSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="log-out-outline" size={18} color={C.danger} />
                    <Text style={styles.fieldLabel}>Check-out</Text>
                  </View>
                  <ClockTimePicker
                    label=""
                    value={manualForm.checkOutTime}
                    onChange={v => setManualForm(f => ({ ...f, checkOutTime: v }))}
                    minTime={manualForm.checkInTime || undefined}
                  />
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="information-circle-outline" size={18} color={C.brand} />
                  <Text style={[styles.fieldLabel, { color: C.brand }]}>Status Rules</Text>
                </View>
                <View style={[styles.rulesCard, { backgroundColor: C.brand + "0A", borderColor: C.brand + "20" }]}>
                  <Text style={styles.rulesText}>• 8h or more = <Text style={{ color: C.success, fontFamily: "Inter_600SemiBold" }}>Present</Text></Text>
                  <Text style={styles.rulesText}>• 4h to less than 8h = <Text style={{ color: C.warning, fontFamily: "Inter_600SemiBold" }}>Half Day</Text></Text>
                  <Text style={styles.rulesText}>• Less than 4h = <Text style={{ color: C.danger, fontFamily: "Inter_600SemiBold" }}>Absent</Text></Text>
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="document-text-outline" size={18} color={C.textSecondary} />
                  <Text style={styles.fieldLabel}>Notes</Text>
                </View>
                <TextInput
                  style={[styles.fieldInput, { height: 90, textAlignVertical: "top", backgroundColor: C.card }]}
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
          <View style={[styles.modal, { paddingTop: Math.max(insets.top, 20), backgroundColor: C.background }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowRegularizeModal(false)} style={styles.modalHeaderIconBtn}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Request Regularization</Text>
              <TouchableOpacity
                onPress={() => regularizeMutation.mutate()}
                disabled={regularizeMutation.isPending}
                style={[styles.modalHeaderIconBtn, { backgroundColor: C.brand + "15" }]}
              >
                {regularizeMutation.isPending
                  ? <ActivityIndicator color={C.brand} size="small" />
                  : <Ionicons name="checkmark" size={24} color={C.brand} />}
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 24, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="calendar-outline" size={18} color={C.textSecondary} />
                  <Text style={styles.fieldLabel}>Date</Text>
                </View>
                <Text style={[styles.fieldInput, { lineHeight: 48, backgroundColor: C.card, fontFamily: "Inter_500Medium", fontSize: 16 }]}>
                  {formatDate(regularizeForm.date)}
                </Text>
              </View>

              <View style={styles.timeGrid}>
                <View style={styles.timeSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="log-in-outline" size={18} color={C.success} />
                    <Text style={styles.fieldLabel}>Check-in</Text>
                  </View>
                  <ClockTimePicker
                    label=""
                    value={regularizeForm.checkInTime}
                    onChange={v => setRegularizeForm(f => ({ ...f, checkInTime: v }))}
                  />
                </View>
                <View style={styles.timeSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="log-out-outline" size={18} color={C.danger} />
                    <Text style={styles.fieldLabel}>Check-out</Text>
                  </View>
                  <ClockTimePicker
                    label=""
                    value={regularizeForm.checkOutTime}
                    onChange={v => setRegularizeForm(f => ({ ...f, checkOutTime: v }))}
                    minTime={regularizeForm.checkInTime || undefined}
                  />
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="information-circle-outline" size={18} color={C.brand} />
                  <Text style={[styles.fieldLabel, { color: C.brand }]}>Status Rules</Text>
                </View>
                <View style={[styles.rulesCard, { backgroundColor: C.brand + "0A", borderColor: C.brand + "20" }]}>
                  <Text style={styles.rulesText}>• 8h or more = <Text style={{ color: C.success, fontFamily: "Inter_600SemiBold" }}>Present</Text></Text>
                  <Text style={styles.rulesText}>• 4h to less than 8h = <Text style={{ color: C.warning, fontFamily: "Inter_600SemiBold" }}>Half Day</Text></Text>
                  <Text style={styles.rulesText}>• Less than 4h = <Text style={{ color: C.danger, fontFamily: "Inter_600SemiBold" }}>Absent</Text></Text>
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="document-text-outline" size={18} color={C.textSecondary} />
                  <Text style={styles.fieldLabel}>Reason</Text>
                </View>
                <TextInput
                  style={[styles.fieldInput, { height: 90, textAlignVertical: "top", backgroundColor: C.card }]}
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
      {/* ── Export Modal ──────────────────────────────────────────────────── */}
      <Modal visible={showExportModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowExportModal(false)}>
        <View style={{ flex: 1, backgroundColor: C.background }}>
          {/* Header */}
          <View style={[styles.modalHeader, { paddingHorizontal: 20, paddingTop: Math.max(insets.top, 20) + 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }]}>
            <TouchableOpacity onPress={() => setShowExportModal(false)} style={styles.modalHeaderIconBtn}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.modalTitle}>Export Attendance</Text>
            </View>
            <TouchableOpacity
              style={[styles.modalHeaderIconBtn, { backgroundColor: C.accent + "15" }]}
              onPress={handleSmartExport}
              disabled={exportLoading}
            >
              {exportLoading
                ? <ActivityIndicator size="small" color={C.accent} />
                : <Ionicons name="download" size={22} color={C.accent} />}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Date Range */}
            <View style={{ gap: 12 }}>
              <View style={expStyles.sectionLabel}>
                <Ionicons name="calendar-outline" size={16} color={C.brand} />
                <Text style={expStyles.sectionLabelText}>Date Range</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={expStyles.fieldLabel}>From</Text>
                  {Platform.OS === "web" ? (
                    <View style={[expStyles.dateInput, { position: "relative", overflow: "hidden", justifyContent: "center" }]}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: exportForm.startDate ? C.text : C.placeholder }}>
                        {exportForm.startDate || "YYYY-MM-DD"}
                      </Text>
                      <input type="date" max={todayISODate()} value={exportForm.startDate}
                        onChange={e => setExportForm(f => ({ ...f, startDate: e.target.value }))}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                    </View>
                  ) : (
                    <TextInput
                      style={expStyles.dateInput}
                      value={exportForm.startDate}
                      onChangeText={v => setExportForm(f => ({ ...f, startDate: v }))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={C.placeholder}
                      autoCapitalize="none"
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={expStyles.fieldLabel}>To</Text>
                  {Platform.OS === "web" ? (
                    <View style={[expStyles.dateInput, { position: "relative", overflow: "hidden", justifyContent: "center" }]}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: exportForm.endDate ? C.text : C.placeholder }}>
                        {exportForm.endDate || "YYYY-MM-DD"}
                      </Text>
                      <input type="date" max={todayISODate()} value={exportForm.endDate}
                        onChange={e => setExportForm(f => ({ ...f, endDate: e.target.value }))}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                    </View>
                  ) : (
                    <TextInput
                      style={expStyles.dateInput}
                      value={exportForm.endDate}
                      onChangeText={v => setExportForm(f => ({ ...f, endDate: v }))}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={C.placeholder}
                      autoCapitalize="none"
                    />
                  )}
                </View>
              </View>

              {/* Quick range chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {[
                  { label: "Today", start: todayISODate(), end: todayISODate() },
                  { label: "Yesterday", start: localDateStr(new Date(Date.now() - 86400000)), end: localDateStr(new Date(Date.now() - 86400000)) },
                  { label: "This week", start: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return localDateStr(d); })(), end: todayISODate() },
                  { label: "This month", start: thisMonthLocal() + "-01", end: todayISODate() },
                  { label: "Last month", start: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return localDateStr(d); })(), end: (() => { const d = new Date(); d.setDate(0); return localDateStr(d); })() },
                ].map(preset => {
                  const isActive = exportForm.startDate === preset.start && exportForm.endDate === preset.end;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      style={[expStyles.rangeChip, isActive && expStyles.rangeChipActive]}
                      onPress={() => setExportForm(f => ({ ...f, startDate: preset.start, endDate: preset.end }))}
                    >
                      <Text style={[expStyles.rangeChipText, isActive && expStyles.rangeChipTextActive]}>{preset.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Employee Selection */}
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={expStyles.sectionLabel}>
                  <Ionicons name="people-outline" size={16} color={C.brand} />
                  <Text style={expStyles.sectionLabelText}>Employees</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setExportForm(f => ({
                    ...f,
                    selectedEmployeeIds: f.selectedEmployeeIds.length === users.length ? [] : users.map(u => String(u.id)),
                  }))}
                >
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.brand }}>
                    {exportForm.selectedEmployeeIds.length === users.length ? "Deselect all" : "Select all"}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Selection summary pill */}
              <View style={expStyles.selectionSummary}>
                <Ionicons name={exportForm.selectedEmployeeIds.length === 0 ? "people" : "person"} size={14} color={C.accent} />
                <Text style={expStyles.selectionSummaryText}>
                  {exportForm.selectedEmployeeIds.length === 0
                    ? `All ${users.length} employees`
                    : `${exportForm.selectedEmployeeIds.length} of ${users.length} selected`}
                </Text>
                {exportForm.selectedEmployeeIds.length > 0 && (
                  <TouchableOpacity onPress={() => setExportForm(f => ({ ...f, selectedEmployeeIds: [] }))}>
                    <Ionicons name="close-circle" size={16} color={C.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Search */}
              <View style={extraStyles.empSearchBox}>
                <Ionicons name="search-outline" size={16} color={C.textSecondary} />
                <TextInput
                  style={extraStyles.empSearchInput}
                  placeholder="Search employees..."
                  placeholderTextColor={C.placeholder}
                  value={exportEmpSearch}
                  onChangeText={setExportEmpSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {exportEmpSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setExportEmpSearch("")}>
                    <Ionicons name="close-circle" size={16} color={C.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Employee list — multi-select */}
              <View style={extraStyles.empDropdown}>
                {users
                  .filter(u => exportEmpSearch.length === 0 || u.name.toLowerCase().includes(exportEmpSearch.toLowerCase()))
                  .map(u => {
                    const uid = String(u.id);
                    const selected = exportForm.selectedEmployeeIds.includes(uid);
                    const roleColor = u.role === "manager" ? C.accent : C.brand;
                    return (
                      <TouchableOpacity
                        key={u.id}
                        style={[extraStyles.empDropdownItem, selected && extraStyles.empDropdownItemActive]}
                        onPress={() => setExportForm(f => ({
                          ...f,
                          selectedEmployeeIds: selected
                            ? f.selectedEmployeeIds.filter(id => id !== uid)
                            : [...f.selectedEmployeeIds, uid],
                        }))}
                        activeOpacity={0.7}
                      >
                        <View style={[extraStyles.empDropdownAvatar, { backgroundColor: roleColor + "20" }]}>
                          <Text style={[extraStyles.empDropdownAvatarText, { color: roleColor }]}>
                            {u.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[extraStyles.empDropdownName, selected && { color: C.brand }]}>{u.name}</Text>
                          <Text style={extraStyles.empDropdownRole}>{u.role}</Text>
                        </View>
                        <View style={[expStyles.checkbox, selected && expStyles.checkboxActive]}>
                          {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                {users.filter(u => exportEmpSearch.length === 0 || u.name.toLowerCase().includes(exportEmpSearch.toLowerCase())).length === 0 && (
                  <View style={{ padding: 16, alignItems: "center" }}>
                    <Text style={{ color: C.textSecondary, fontFamily: "Inter_400Regular", fontSize: 13 }}>No employees found</Text>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>

          {/* Bottom export button */}
          <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 8, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.background }}>
            <TouchableOpacity
              style={[expStyles.exportBtn, exportLoading && { opacity: 0.6 }]}
              onPress={handleSmartExport}
              disabled={exportLoading}
            >
              {exportLoading
                ? <ActivityIndicator color="#fff" />
                : <>
                  <Ionicons name="download" size={20} color="#fff" />
                  <Text style={expStyles.exportBtnText}>
                    Export{exportForm.selectedEmployeeIds.length > 0 ? ` (${exportForm.selectedEmployeeIds.length} emp)` : " All"} · {exportForm.startDate === exportForm.endDate ? exportForm.startDate : `${exportForm.startDate} → ${exportForm.endDate}`}
                  </Text>
                </>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Office Location Management Modal ──────────────────────────────── */}
      <OfficeManagementModal
        visible={showOfficeModal}
        onClose={() => setShowOfficeModal(false)}
        canEditOffices={user?.role === "admin" || user?.role === "super_admin"}
      />
    </>
  );
}

// ─── Office Management Modal ──────────────────────────────────────────────────
function OfficeManagementModal({ visible, onClose, canEditOffices }: { visible: boolean; onClose: () => void; canEditOffices: boolean }) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [editingOffice, setEditingOffice] = useState<OfficeLocation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", latitude: "", longitude: "", radiusMeters: "100" });
  const [isFetchingLoc, setIsFetchingLoc] = useState(false);
  const [assigningOffice, setAssigningOffice] = useState<OfficeLocation | null>(null);

  const officesQ = useQuery<OfficeLocation[]>({
    queryKey: ["office-locations"],
    queryFn: listOfficeLocations,
    enabled: visible,
    staleTime: 30_000,
  });

  const assignmentsQ = useQuery<OfficeAssignment[]>({
    queryKey: ["office-assignments"],
    queryFn: listOfficeAssignments,
    enabled: visible,
    staleTime: 15_000,
  });

  const assignmentCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assignmentsQ.data ?? []) counts[a.officeId] = (counts[a.officeId] ?? 0) + 1;
    return counts;
  }, [assignmentsQ.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const lat = parseFloat(form.latitude);
      const lng = parseFloat(form.longitude);
      const radius = parseInt(form.radiusMeters, 10);
      if (!form.name.trim()) throw new Error("Name is required");
      if (isNaN(lat) || isNaN(lng)) throw new Error("Enter valid latitude and longitude");
      if (isNaN(radius) || radius < 10) throw new Error("Radius must be at least 10 meters");
      if (editingOffice) {
        return updateOfficeLocation(editingOffice.id, { name: form.name.trim(), latitude: lat, longitude: lng, radiusMeters: radius });
      }
      return createOfficeLocation({ name: form.name.trim(), latitude: lat, longitude: lng, radiusMeters: radius });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office-locations"] });
      setShowForm(false);
      setEditingOffice(null);
      setForm({ name: "", latitude: "", longitude: "", radiusMeters: "100" });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOfficeLocation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-locations"] }),
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const openEdit = (office: OfficeLocation) => {
    setEditingOffice(office);
    setForm({
      name: office.name,
      latitude: String(office.latitude),
      longitude: String(office.longitude),
      radiusMeters: String(office.radiusMeters),
    });
    setShowForm(true);
  };

  const openAdd = () => {
    setEditingOffice(null);
    setForm({ name: "", latitude: "", longitude: "", radiusMeters: "100" });
    setShowForm(true);
  };

  const confirmDelete = (office: OfficeLocation) => {
    Alert.alert("Delete Office", `Delete "${office.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(office.id) },
    ]);
  };

  const handleGetCurrentLocation = async () => {
    setIsFetchingLoc(true);
    try {
      const pos = await getLocation();
      if (pos) {
        setForm(f => ({ ...f, latitude: String(pos.latitude), longitude: String(pos.longitude) }));
      } else {
        Alert.alert("Location Error", "Could not get current location. Check your device permissions.");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to fetch location.");
    } finally {
      setIsFetchingLoc(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <View style={{ paddingHorizontal: 20, paddingTop: Math.max(insets.top, 24) + 12, paddingBottom: 12, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: C.text }}>Office Locations</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 }}>
              Manage geofencing areas for attendance tracking
            </Text>
          </View>
          {canEditOffices && (officesQ.data ?? []).length > 0 && (
            <TouchableOpacity style={officeItemStyles.addPillBtn} onPress={openAdd}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={officeItemStyles.addPillBtnText}>Add New Office</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={{ marginLeft: 12 }}>
            <Ionicons name="close" size={24} color={C.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 0 }}>
          {officesQ.isLoading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />
          ) : (officesQ.data ?? []).length === 0 ? (
            <View style={{ alignItems: "center", marginTop: 40, gap: 8 }}>
              <Ionicons name="business-outline" size={40} color={C.border} />
              <Text style={{ color: C.textSecondary, fontFamily: "Inter_400Regular" }}>No offices yet</Text>
            </View>
          ) : (
            (officesQ.data ?? []).map(office => {
              const assignedCount = assignmentCounts[office.id] ?? 0;
              return (
                <TouchableOpacity
                  key={office.id}
                  style={officeItemStyles.card}
                  activeOpacity={0.85}
                  onPress={() => setAssigningOffice(office)}
                >
                  <LinearGradient
                    colors={[C.brand, "#3B7DD8"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={officeItemStyles.cardTopBar}
                  />
                  <View style={officeItemStyles.cardBody}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <View style={officeItemStyles.iconCircle}>
                        <Ionicons name="business" size={20} color={C.brand} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={officeItemStyles.name}>{office.name}</Text>
                        <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          <View style={officeItemStyles.badge}>
                            <View style={officeItemStyles.badgeDot} />
                            <Text style={officeItemStyles.badgeText}>Active Geofence</Text>
                          </View>
                          {office.isDefault && (
                            <View style={[officeItemStyles.badge, { backgroundColor: C.accent + "18" }]}>
                              <Ionicons name="star" size={10} color={C.accent} />
                              <Text style={[officeItemStyles.badgeText, { color: C.accent }]}>Default</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {canEditOffices && (
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <TouchableOpacity
                            style={[officeItemStyles.actionBtn, { backgroundColor: C.brand + "15" }]}
                            onPress={(e) => { e.stopPropagation?.(); openEdit(office); }}
                          >
                            <Ionicons name="pencil-outline" size={15} color={C.brand} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[officeItemStyles.actionBtn, { backgroundColor: C.danger + "15" }]}
                            onPress={(e) => { e.stopPropagation?.(); confirmDelete(office); }}
                          >
                            <Ionicons name="trash-outline" size={15} color={C.danger} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    <View style={officeItemStyles.divider} />

                    <View style={officeItemStyles.detailRow}>
                      <Ionicons name="location-outline" size={15} color={C.brand} />
                      <Text style={officeItemStyles.detailLabel}>Coordinates</Text>
                      <Text style={officeItemStyles.detailValue}>
                        {Number(office.latitude).toFixed(4)}, {Number(office.longitude).toFixed(4)}
                      </Text>
                    </View>
                    <View style={officeItemStyles.detailRow}>
                      <Ionicons name="radio-outline" size={15} color={C.brand} />
                      <Text style={officeItemStyles.detailLabel}>Radius Coverage</Text>
                      <Text style={officeItemStyles.detailValue}>{office.radiusMeters} meters</Text>
                    </View>
                    <View style={officeItemStyles.detailRow}>
                      <Ionicons name="people-outline" size={15} color={C.brand} />
                      <Text style={officeItemStyles.detailLabel}>Assigned Employees</Text>
                      <Text style={officeItemStyles.detailValue}>{assignedCount}</Text>
                    </View>

                    <View style={officeItemStyles.assignHint}>
                      <Text style={officeItemStyles.assignHintText}>Tap to manage employees</Text>
                      <Ionicons name="chevron-forward" size={14} color={C.brand} />
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {canEditOffices && (officesQ.data ?? []).length === 0 && (
          <View style={{ padding: 16 }}>
            <TouchableOpacity
              style={{ backgroundColor: C.brand, borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
              onPress={openAdd}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Add Office Location</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Add / Edit form modal */}
        <Modal visible={showForm} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowForm(false)}>
          <View style={{ flex: 1, backgroundColor: C.background, padding: 20, paddingTop: Math.max(insets.top, 20) + 12 }}>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 20 }}>
              {editingOffice ? "Edit Office" : "New Office Location"}
            </Text>

            <Text style={officeFormStyles.label}>Office Name</Text>
            <TextInput
              style={officeFormStyles.input}
              value={form.name}
              onChangeText={v => setForm(f => ({ ...f, name: v }))}
              placeholder="e.g. Hubli Head Office"
              placeholderTextColor={C.border}
            />

            <Text style={officeFormStyles.label}>Latitude</Text>
            <TextInput
              style={officeFormStyles.input}
              value={form.latitude}
              onChangeText={v => setForm(f => ({ ...f, latitude: v }))}
              placeholder="e.g. 15.3647"
              placeholderTextColor={C.border}
              keyboardType="decimal-pad"
            />

            <Text style={officeFormStyles.label}>Longitude</Text>
            <TextInput
              style={officeFormStyles.input}
              value={form.longitude}
              onChangeText={v => setForm(f => ({ ...f, longitude: v }))}
              placeholder="e.g. 75.1240"
              placeholderTextColor={C.border}
              keyboardType="decimal-pad"
            />

            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, alignSelf: "flex-start", paddingVertical: 4 }}
              onPress={handleGetCurrentLocation}
              disabled={isFetchingLoc}
            >
              {isFetchingLoc ? (
                <ActivityIndicator size="small" color={C.brand} />
              ) : (
                <Ionicons name="location-outline" size={16} color={C.brand} />
              )}
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.brand }}>
                {isFetchingLoc ? "Fetching Location..." : "Use Current Location"}
              </Text>
            </TouchableOpacity>

            <Text style={officeFormStyles.label}>Radius (meters)</Text>
            <TextInput
              style={officeFormStyles.input}
              value={form.radiusMeters}
              onChangeText={v => setForm(f => ({ ...f, radiusMeters: v }))}
              placeholder="100"
              placeholderTextColor={C.border}
              keyboardType="number-pad"
            />
            <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 16, marginTop: -6 }}>
              Employees must be within this distance to check in
            </Text>

            <TouchableOpacity
              style={{ backgroundColor: C.brand, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
              onPress={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>
                  {editingOffice ? "Save Changes" : "Create Office"}
                </Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: C.surfaceSecondary, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 10 }}
              onPress={() => setShowForm(false)}
            >
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* Assign Employees modal — opened by tapping an office card */}
        <EmployeeAssignmentModal
          office={assigningOffice}
          onClose={() => setAssigningOffice(null)}
        />
      </View>
    </Modal>
  );
}

// ─── Employee <-> Office Assignment Modal ─────────────────────────────────────
const AVATAR_PALETTE = ["#1B4F8A", "#7C3AED", "#0EA5E9", "#F59E0B", "#22C55E", "#EF4444", "#EC4899", "#14B8A6"];
function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function EmployeeAssignmentModal({ office, onClose }: { office: OfficeLocation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const visible = !!office;

  const usersQ = useQuery<UserBasic[]>({
    queryKey: ["all-users-for-assignment"],
    queryFn: listUsers,
    enabled: visible,
    staleTime: 30_000,
  });

  const assignmentsQ = useQuery<OfficeAssignment[]>({
    queryKey: ["office-assignments"],
    queryFn: listOfficeAssignments,
    enabled: visible,
    staleTime: 10_000,
  });

  const assignMutation = useMutation({
    mutationFn: (employeeId: string) => assignEmployeeToOffice(employeeId, office!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-assignments"] }),
    onError: (e: Error) => Alert.alert("Couldn't assign employee", e.message),
  });

  const unassignMutation = useMutation({
    mutationFn: (employeeId: string) => unassignEmployeeFromOffice(employeeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-assignments"] }),
    onError: (e: Error) => Alert.alert("Couldn't unassign employee", e.message),
  });

  const assignmentByEmployee = React.useMemo(() => {
    const map: Record<string, OfficeAssignment> = {};
    for (const a of assignmentsQ.data ?? []) map[a.employeeId] = a;
    return map;
  }, [assignmentsQ.data]);

  const { assigned, others } = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (usersQ.data ?? []).filter(u =>
      !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    );
    const assignedList = all.filter(u => office && assignmentByEmployee[u.id]?.officeId === office.id);
    const otherList = all.filter(u => !office || assignmentByEmployee[u.id]?.officeId !== office.id);
    return { assigned: assignedList, others: otherList };
  }, [usersQ.data, assignmentByEmployee, office, search]);

  if (!office) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.background }}>
        <LinearGradient
          colors={[C.brand, C.brandDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 20, paddingTop: Math.max(insets.top, 24) + 16, paddingBottom: 18 }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="people" size={18} color="#fff" />
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" }}>
                  Assign Employees to {office.name}
                </Text>
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#DCE8FA", marginTop: 6, lineHeight: 17 }}>
                Select employees who should be restricted to check in and out from this location. By default, unassigned employees fall back to the default office.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 2 }}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <View style={assignStyles.searchBar}>
            <Ionicons name="search" size={16} color={C.textSecondary} />
            <TextInput
              style={assignStyles.searchInput}
              placeholder="Search employees by name or email"
              placeholderTextColor={C.placeholder}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={C.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
          {usersQ.isLoading || assignmentsQ.isLoading ? (
            <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />
          ) : (
            <>
              <View style={assignStyles.sectionHeader}>
                <Ionicons name="checkmark-circle" size={15} color={C.success} />
                <Text style={assignStyles.sectionTitle}>Currently Assigned ({assigned.length})</Text>
              </View>
              {assigned.length === 0 ? (
                <Text style={assignStyles.emptyText}>No employees pinned to this office yet.</Text>
              ) : (
                assigned.map(u => (
                  <View key={u.id} style={[assignStyles.row, assignStyles.rowAssigned]}>
                    <View style={[assignStyles.avatar, { backgroundColor: avatarColorFor(u.id) }]}>
                      <Text style={assignStyles.avatarText}>{(u.name || u.email || "?").charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={assignStyles.rowName}>{u.name || "Unnamed"}</Text>
                      <Text style={assignStyles.rowEmail}>{u.email}</Text>
                    </View>
                    <TouchableOpacity
                      style={assignStyles.assignedPill}
                      onPress={() => unassignMutation.mutate(u.id)}
                      disabled={unassignMutation.isPending}
                    >
                      <Ionicons name="checkmark" size={13} color="#fff" />
                      <Text style={assignStyles.assignedPillText}>Assigned</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}

              <View style={[assignStyles.sectionHeader, { marginTop: 20 }]}>
                <Ionicons name="people-outline" size={15} color={C.textSecondary} />
                <Text style={assignStyles.sectionTitle}>Other Employees ({others.length})</Text>
              </View>
              {others.length === 0 ? (
                <Text style={assignStyles.emptyText}>Everyone is assigned to this office.</Text>
              ) : (
                others.map(u => {
                  const elsewhere = assignmentByEmployee[u.id];
                  return (
                    <View key={u.id} style={assignStyles.row}>
                      <View style={[assignStyles.avatar, { backgroundColor: avatarColorFor(u.id) }]}>
                        <Text style={assignStyles.avatarText}>{(u.name || u.email || "?").charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={assignStyles.rowName}>{u.name || "Unnamed"}</Text>
                        <Text style={assignStyles.rowEmail}>{u.email}</Text>
                        {elsewhere && (
                          <Text style={assignStyles.elsewhereText}>
                            Currently assigned to {elsewhere.officeName || "another office"}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={assignStyles.assignBtn}
                        onPress={() => assignMutation.mutate(u.id)}
                        disabled={assignMutation.isPending}
                      >
                        <Ionicons name="add" size={14} color={C.brand} />
                        <Text style={assignStyles.assignBtnText}>Assign</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </>
          )}
        </ScrollView>

        <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) }}>
          <TouchableOpacity style={assignStyles.doneBtn} onPress={onClose}>
            <Text style={assignStyles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const assignStyles = StyleSheet.create({
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surfaceSecondary, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.text },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginBottom: 8 },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.card, borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: C.border,
  },
  rowAssigned: { borderColor: C.success + "40", backgroundColor: C.success + "0A" },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  rowName: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  rowEmail: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  elsewhereText: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.warning, marginTop: 2 },
  assignedPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.success, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
  },
  assignedPillText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  assignBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.brand + "12", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: C.brand + "30",
  },
  assignBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.brand },
  doneBtn: { backgroundColor: C.brand, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  doneBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

const officeItemStyles = StyleSheet.create({
  addPillBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.brand, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  addPillBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  card: {
    backgroundColor: C.card, borderRadius: 16, marginBottom: 14,
    borderWidth: 1, borderColor: C.border, overflow: "hidden",
  },
  cardTopBar: { height: 4, width: "100%" },
  cardBody: { padding: 14 },
  iconCircle: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.success + "16", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start",
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.success },
  actionBtn: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  detailLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, flex: 1 },
  detailValue: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.text },
  assignHint: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  assignHintText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
});

const officeFormStyles = StyleSheet.create({
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: C.surfaceSecondary, borderRadius: 12, padding: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", color: C.text,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
});

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
        {regularization?.status === "approved" ? (
          <View style={[styles.badge, { backgroundColor: C.success + "18", alignSelf: "flex-start", marginTop: 4 }]}>
            <Ionicons name="checkmark-circle" size={10} color={C.success} />
            <Text style={[styles.badgeText, { color: C.success }]}>Regularized</Text>
          </View>
        ) : regularization?.status === "pending" ? (
          <View style={[styles.badge, { backgroundColor: C.warning + "18", alignSelf: "flex-start", marginTop: 4 }]}>
            <Ionicons name="time" size={10} color={C.warning} />
            <Text style={[styles.badgeText, { color: C.warning }]}>Regularization Pending</Text>
          </View>
        ) : showRegularize ? (
          <TouchableOpacity onPress={onRegularize} style={{ marginTop: 4, alignSelf: "flex-start" }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand }}>Regularize</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <StatusBadge status={record.status} checkInTime={record.checkInTime} checkOutTime={record.checkOutTime} date={record.date} />
    </View>
  );
});

const AdminRow = React.memo(function AdminRow({
  record,
  regularization,
}: {
  record: AttendanceRecord;
  regularization?: AttendanceRegularization;
}) {
  const duration = calcDuration(record.checkInTime, record.checkOutTime);
  const isOut = !!record.checkOutTime;
  const isToday = record.date === localDateStr(new Date());
  const isInProgress = !!record.checkInTime && !record.checkOutTime && isToday;

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
        <StatusBadge
          status={record.status}
          checkInTime={record.checkInTime}
          checkOutTime={record.checkOutTime}
          date={record.date}
        />
        {regularization?.status === "approved" ? (
          <View style={[styles.badge, { backgroundColor: C.success + "18", marginTop: 4 }]}>
            <Ionicons name="checkmark-circle" size={10} color={C.success} />
            <Text style={[styles.badgeText, { color: C.success }]}>Regularized</Text>
          </View>
        ) : regularization?.status === "pending" ? (
          <View style={[styles.badge, { backgroundColor: C.warning + "18", marginTop: 4 }]}>
            <Ionicons name="time" size={10} color={C.warning} />
            <Text style={[styles.badgeText, { color: C.warning }]}>Pending Reg.</Text>
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

  geofenceBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
  },
  geofenceBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },

  manageOfficesBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.brand + "15", borderRadius: 10, borderWidth: 1, borderColor: C.brand + "30",
  },
  manageOfficesBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.brand },

  officeRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, marginBottom: 8,
  },
  officeRowInfo: { flex: 1 },
  officeRowName: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  officeRowDetail: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  officeRowActions: { flexDirection: "row", gap: 8 },

  modalLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 4 },
  modalInput: {
    backgroundColor: C.surfaceSecondary, borderRadius: 12, padding: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", color: C.text,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  modalSaveBtn: {
    backgroundColor: C.brand, borderRadius: 12, paddingVertical: 13,
    alignItems: "center", marginTop: 4,
  },
  modalSaveBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  modalCancelBtn: {
    backgroundColor: C.surfaceSecondary, borderRadius: 12, paddingVertical: 13,
    alignItems: "center", marginTop: 8,
  },
  modalCancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.textSecondary },

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
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  modalHeaderIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },

  formSection: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  fieldInput: { backgroundColor: C.surfaceSecondary, borderRadius: 16, paddingHorizontal: 16, height: 52, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text, borderWidth: 1, borderColor: C.border },

  timeGrid: { flexDirection: "column", gap: 12 },
  timeSection: { gap: 8 },

  empCard: { width: 120, height: 140, backgroundColor: C.card, borderRadius: 16, padding: 16, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.border, position: "relative" },
  empCardActive: { borderColor: C.brand, backgroundColor: C.brand + "08" },
  empCardAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  empCardAvatarText: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  empCardName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center", marginBottom: 2 },
  empCardRole: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, textTransform: "capitalize" },
  empCardCheck: { position: "absolute", top: 8, right: 8, backgroundColor: C.card, borderRadius: 10 },

  rulesCard: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: C.border },
  rulesText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, lineHeight: 20 },
});
// ─── Extra styles appended for filter chips + searchable employee picker ───────
const extraStyles = StyleSheet.create({
  // attendance filter chips (horizontal scroll above daily list)
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.card,
    borderWidth: 1.5, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  filterChipTextActive: { color: "#fff" },
  filterChipAvatar: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  filterChipAvatarText: { fontSize: 10, fontFamily: "Inter_700Bold", color: C.text },

  // searchable employee picker in Manual Entry modal
  empSearchBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, height: 48,
    borderWidth: 1.5, borderColor: C.border,
  },
  empSearchInput: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text,
  },
  selectedEmpPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.brand + "10", borderRadius: 14, padding: 12,
    borderWidth: 1.5, borderColor: C.brand + "40",
  },
  selectedEmpAvatar: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.brand, alignItems: "center", justifyContent: "center",
  },
  selectedEmpAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  selectedEmpName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  selectedEmpRole: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, textTransform: "capitalize" },
  empDropdown: {
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  empDropdownItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  empDropdownItemActive: { backgroundColor: C.brand + "08" },
  empDropdownAvatar: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  empDropdownAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  empDropdownName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  empDropdownRole: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, textTransform: "capitalize", marginTop: 1 },
});

// ─── Export modal styles ───────────────────────────────────────────────────────
const expStyles = StyleSheet.create({
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionLabelText: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginBottom: 6 },
  dateInput: {
    backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, height: 48,
    fontSize: 15, fontFamily: "Inter_500Medium", color: C.text,
    borderWidth: 1.5, borderColor: C.border,
  },
  rangeChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border,
  },
  rangeChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  rangeChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  rangeChipTextActive: { color: "#fff" },
  selectionSummary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accent + "12", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.accent + "30",
  },
  selectionSummaryText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.accent },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border,
    alignItems: "center", justifyContent: "center", backgroundColor: C.card,
  },
  checkboxActive: { backgroundColor: C.brand, borderColor: C.brand },
  exportBtn: {
    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 15,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  exportBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});