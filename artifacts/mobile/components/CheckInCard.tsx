import React, { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { checkInAttendance, checkOutAttendance, getMyOfficeLocation, type OfficeLocation } from "@/lib/api";
import { scheduleCheckoutReminder, cancelCheckoutReminder } from "@/lib/notifications";
import { formatTime, calcDuration } from "@/lib/utils";
import Colors from "@/constants/colors";
import type { AttendanceRecord } from "@/lib/types";

const C = Colors.light;

async function getLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === "web") return null;
  try {
    // Use getForegroundPermissionsAsync (NOT request) so the polling loop
    // never shows a permission dialog mid-session. Permissions are requested
    // once via location-gate before the user can reach this screen.
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}

// ─── Haversine distance in meters ────────────────────────────────────────────
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

function useOfficeGeofence(): GeofenceState {
  const [state, setState] = useState<GeofenceState>({
    isInOffice: false,          // ✅ FIX 1: start disabled — never allow check-in before GPS check completes
    distanceMeters: null,
    officeLocation: null,
    loading: true,
    currentPosition: null,
    gpsPermissionDenied: false,
  });
  const officeRef = useRef<OfficeLocation | null | undefined>(undefined);

  // Fetch global office once on mount
  useEffect(() => {
    if (Platform.OS === "web") {
      // On web we can't check GPS, just allow freely
      setState(s => ({ ...s, isInOffice: true, loading: false }));
      return;
    }
    getMyOfficeLocation().then(office => {
      officeRef.current = office;
      if (!office) {
        // ✅ FIX 2: No office configured by admin → allow check-in freely
        setState(s => ({ ...s, isInOffice: true, loading: false }));
      }
      // If office exists, GPS polling effect below will update state
    });
  }, []);

  // Poll GPS every 30 seconds
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;

    const check = async () => {
      if (officeRef.current === undefined) return; // office not loaded yet
      const office = officeRef.current;

      // No office row → no geofencing needed
      if (!office) {
        setState(s => ({ ...s, isInOffice: true, loading: false }));
        return;
      }

      const pos = await getLocation();
      if (cancelled) return;

      // ✅ FIX 3: GPS unavailable (permission denied or error) → block check-in, show warning
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
      // Use spread update — never touch loading here so it stays false after first check.
      // Setting loading=true in the poll caused the button to disappear every 30s (twitching).
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
    const waitAndRun = async () => {
      let tries = 0;
      while (officeRef.current === undefined && tries < 20) {
        await new Promise(r => setTimeout(r, 300));
        tries++;
      }
      if (!cancelled) check();
    };

    waitAndRun();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return state;
}

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
      present: { color: C.success, label: "Present", icon: "checkmark-circle" as const },
      half_day: { color: C.warning, label: "Half Day", icon: "time" as const },
      absent: { color: C.danger, label: "Absent", icon: "close-circle" as const },
    }[status ?? ""] ?? { color: C.textSecondary, label: "Unknown", icon: "help-circle" as const });

  return (
    <View style={[styles.badge, { backgroundColor: config.color + "18" }]}>
      <Ionicons name={config.icon} size={12} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

export function CheckInCard({
  todayRecord,
  isLoadingRecord,
  onRegularizeRequest,
}: {
  todayRecord: AttendanceRecord | null;
  isLoadingRecord: boolean;
  onRegularizeRequest?: () => void;
}) {
  const qc = useQueryClient();
  const hasCheckedIn = !!todayRecord?.checkInTime;
  const hasCheckedOut = !!todayRecord?.checkOutTime;
  const geofence = useOfficeGeofence();

  // ─── The single source of truth for button disabled state ─────────────────
  // Disabled when: action in flight, location still loading, or not inside radius
  const isCheckInDisabled = geofence.loading || !geofence.isInOffice;
  const isCheckOutDisabled = geofence.loading || !geofence.isInOffice;

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const loc = geofence.currentPosition ?? await getLocation();
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
      const loc = geofence.currentPosition ?? await getLocation();
      await checkOutAttendance({ latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-today"] });
      qc.invalidateQueries({ queryKey: ["attendance-history"] });
      void cancelCheckoutReminder();
    },
    onError: (e: Error) => Alert.alert("Check-out failed", e.message),
  });

  const isMutating = checkInMutation.isPending || checkOutMutation.isPending;

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

  return (
    <View style={styles.clockCard}>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
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

      {/* ─── Check-in / check-out time row ───────────────────────────────── */}
      {hasCheckedIn && (
        <View style={styles.timingRow}>
          <View style={styles.timeBox}>
            <Ionicons name="log-in-outline" size={18} color={C.success} />
            <View>
              <Text style={styles.timeLabel}>Check In</Text>
              <Text style={styles.timeValue}>{formatTime(todayRecord!.checkInTime)}</Text>
              {todayRecord?.checkInLatitude ? (
                <Text style={styles.coordText}>
                  {todayRecord.checkInLatitude.toFixed(4)}, {todayRecord.checkInLongitude?.toFixed(4)}
                </Text>
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
                <Text style={styles.coordText}>
                  {calcDuration(todayRecord!.checkInTime, todayRecord!.checkOutTime)} worked
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      )}

      {/* ─── Geofence banners ────────────────────────────────────────────── */}

      {/* 1. Still fetching location */}
      {geofence.loading && !hasCheckedIn && !isLoadingRecord && (
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

      {/* ─── Action area ─────────────────────────────────────────────────── */}
      {isLoadingRecord ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 16 }} />

      ) : !hasCheckedIn ? (
        <TouchableOpacity
          style={[
            styles.clockBtn,
            styles.clockBtnIn,
            (isMutating || isCheckInDisabled) && styles.clockBtnDisabled,
          ]}
          onPress={handleCheckIn}
          disabled={isMutating || isCheckInDisabled}
          activeOpacity={0.8}
        >
          {isMutating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="finger-print" size={22} color="#fff" />
              <Text style={styles.clockBtnText}>Check In</Text>
            </>
          )}
        </TouchableOpacity>

      ) : !hasCheckedOut ? (
        <View style={{ gap: 14 }}>
          <WorkTimer checkInTime={todayRecord!.checkInTime!} />
          <TouchableOpacity
            style={[
              styles.clockBtn,
              styles.clockBtnOut,
              (isMutating || isCheckOutDisabled) && styles.clockBtnDisabled,
            ]}
            onPress={handleCheckOut}
            disabled={isMutating || isCheckOutDisabled}
            activeOpacity={0.8}
          >
            {isMutating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="exit" size={22} color="#fff" />
                <Text style={styles.clockBtnText}>Check Out</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

      ) : hasCheckedOut && todayRecord?.checkInTime && todayRecord?.status !== "absent" ? (
        <View style={{ gap: 12 }}>
          <WorkTimerDone
            checkInTime={todayRecord!.checkInTime!}
            checkOutTime={todayRecord!.checkOutTime!}
            status={todayRecord!.status}
          />
          <View style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={20} color={C.success} />
            <Text style={styles.doneText}>All done for today!</Text>
          </View>
        </View>

      ) : todayRecord?.status === "absent" ? (
        <View style={{ gap: 10 }}>
          <View style={[styles.doneRow, { justifyContent: "flex-start" }]}>
            <Ionicons name="close-circle" size={20} color={C.danger} />
            <Text style={[styles.doneText, { color: C.danger }]}>Marked absent</Text>
          </View>
          {onRegularizeRequest && (
            <TouchableOpacity
              style={[styles.clockBtn, { backgroundColor: C.brand }]}
              onPress={onRegularizeRequest}
            >
              <Ionicons name="create-outline" size={20} color="#fff" />
              <Text style={styles.clockBtnText}>Request Regularization</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clockCard: {
    backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 20,
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  clockCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  clockTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  clockSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 4 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  timingRow: { flexDirection: "row", backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, alignItems: "center" },
  timeBox: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  timeLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, marginBottom: 4 },
  timeValue: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  coordText: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 4 },
  timeDivider: { width: 1, height: 40, backgroundColor: C.border, marginHorizontal: 16 },
  clockBtn: { flexDirection: "row", height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 10 },
  clockBtnIn: { backgroundColor: C.brand },
  clockBtnOut: { backgroundColor: C.accent },
  clockBtnDisabled: { opacity: 0.4 },
  clockBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 },
  doneRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  doneText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.success },
  geofenceBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12,
  },
  geofenceBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
});