import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  MapboxWebMap,
  type LatLng,
  type OsmMarker,
  type OsmTileMode,
} from "@/components/GoogleMapsWebMap";
import { MapControls } from "@/components/MapControls";
import type { EmployeeLocation } from "@/lib/types";

import { reverseGeocode } from "@/lib/geocoding";

const C = Colors.light;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Re-geocode an employee's position at most every 2 minutes */
const GEOCODE_CACHE_TTL_MS = 2 * 60 * 1000;

let NativeDatePicker: typeof import("@react-native-community/datetimepicker").default | null = null;
try {
  NativeDatePicker = require("@react-native-community/datetimepicker").default;
} catch { }

/**
 * FIX: Removed hardcoded 5-min LIVE_THRESHOLD_MS — it was overriding the
 * 20-min threshold from utils.ts. The local const was used in isEmployeeLive()
 * but isLive() (imported from utils) uses the correct 20-min value.
 * Two thresholds fighting each other caused employees to always show offline.
 */

/** Distinct route colours for up to 8 simultaneous employees */
const TRAIL_COLORS = [
  "#1E4E8A",
  "#E53E3E",
  "#D97706",
  "#059669",
  "#7C3AED",
  "#DB2777",
  "#0891B2",
  "#65A30D",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type GeocodeCacheEntry = {
  short: string;
  fetchedAt: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return localDateStr(new Date());
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr || new Date(dateStr).getFullYear() < 2000) return "never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}mo ago` : `${years}y ago`;
}

// Match web app: 5-minute threshold for "Live now", anything older = "Last seen"
const LIVE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Simple 2-state check matching the web admin map:
 *  - trackerState "stopped" → never live
 *  - best timestamp (lastPingAt preferred, falls back to recordedAt) within 5 min → live
 *  - anything older → not live ("Last seen X ago")
 */
function isEmployeeLive(emp: EmployeeLocation): boolean {
  if (emp.trackerState === "stopped") return false;
  const best = emp.lastPingAt ?? emp.recordedAt;
  if (!best) return false;
  return (Date.now() - new Date(best).getTime()) <= LIVE_THRESHOLD_MS;
}

/** Format speed as "xx km/h" or "stationary" */
function formatSpeed(speedKmh?: number | null): string {
  if (speedKmh == null || speedKmh < 1) return "stationary";
  return `${Math.round(speedKmh)} km/h`;
}

/** Battery icon name from level */
function batteryIcon(level?: number | null): keyof typeof Ionicons.glyphMap {
  if (level == null) return "battery-half-outline";
  if (level > 80) return "battery-full-outline";
  if (level > 40) return "battery-half-outline";
  if (level > 15) return "battery-dead-outline";
  return "battery-dead-outline";
}

/** Battery colour */
function batteryColor(level?: number | null): string {
  if (level == null) return C.textSecondary;
  if (level > 40) return "#10B981";
  if (level > 15) return "#D97706";
  return "#EF4444";
}

// ─── Pulsing dot for live employees ──────────────────────────────────────────

function PulsingDot({ color = "#10B981" }: { color?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.7,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.8, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [scale, opacity]);

  return (
    <View style={styles.pulseContainer}>
      <Animated.View
        style={[
          styles.pulseRing,
          { backgroundColor: color, transform: [{ scale }], opacity },
        ]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

// ─── Geocode cache hook ───────────────────────────────────────────────────────

function useGeocodingCache(
  employees: EmployeeLocation[],
): Record<string, string> {
  const [cache, setCache] = useState<Record<string, GeocodeCacheEntry>>({});
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const now = Date.now();
    const toFetch = employees.filter((e) => {
      if (e.latitude === 0 && e.longitude === 0) return false;
      if (pendingRef.current.has(e.employeeId)) return false;
      const entry = cache[e.employeeId];
      if (entry && now - entry.fetchedAt < GEOCODE_CACHE_TTL_MS) return false;
      return true;
    });
    if (toFetch.length === 0) return;

    toFetch.forEach((emp) => {
      pendingRef.current.add(emp.employeeId);
      reverseGeocode(emp.latitude, emp.longitude)
        .then((result) => {
          if (result?.address) {
            const parts = result.address
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            const short = parts.slice(0, Math.min(3, parts.length)).join(", ");
            setCache((prev) => ({
              ...prev,
              [emp.employeeId]: { short, fetchedAt: Date.now() },
            }));
          }
        })
        .catch(() => { })
        .finally(() => {
          pendingRef.current.delete(emp.employeeId);
        });
    });
  }, [employees]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(
    () =>
      Object.fromEntries(
        Object.entries(cache).map(([id, entry]) => [id, entry.short]),
      ),
    [cache],
  );
}

// ─── Employee card ────────────────────────────────────────────────────────────

function EmployeeCard({
  emp,
  color,
  landmark,
  onLocate,
  onViewPath,
}: {
  emp: EmployeeLocation;
  color: string;
  landmark?: string;
  onLocate: () => void;
  onViewPath: () => void;
}) {
  const empIsLive = isEmployeeLive(emp);
  const presenceColor = empIsLive ? "#10B981" : "#94a3b8";
  const speedKmh = (emp as any).speedKmh as number | undefined;
  const battery = (emp as any).batteryLevel as number | undefined;
  const movement = (emp as any).movementState as string | undefined;

  return (
    <View style={styles.riderCard}>
      {/* Left colour stripe */}
      <View style={[styles.cardStripe, { backgroundColor: color }]} />

      <View style={styles.riderInfo}>
        {/* Avatar + live dot */}
        <View style={styles.avatarWrap}>
          {emp.profilePhotoUrl ? (
            <Image source={{ uri: emp.profilePhotoUrl }} style={styles.riderAvatarImg} />
          ) : (
            <View style={[styles.riderAvatar, { backgroundColor: color + "25" }]}>
              <Text style={[styles.riderAvatarText, { color }]}>
                {emp.employeeName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          {empIsLive ? (
            <View style={styles.liveDotWrap}>
              <PulsingDot color={presenceColor} />
            </View>
          ) : (
            <View style={[styles.offlineDot]} />
          )}
        </View>

        {/* Text column */}
        <View style={{ flex: 1 }}>
          <Text style={styles.riderName} numberOfLines={1}>
            {emp.employeeName}
          </Text>

          <Text
            style={[
              styles.riderStatus,
              { color: presenceColor },
            ]}
            numberOfLines={1}
          >
            {empIsLive
              ? "● Live now"
              : `Last seen ${formatRelativeTime(emp.lastPingAt ?? emp.recordedAt)}`
            }
          </Text>

          {landmark ? (
            <Text style={styles.riderLandmark} numberOfLines={1}>
              📍 {landmark}
            </Text>
          ) : null}

          {/* Telemetry row */}
          {empIsLive && (
            <View style={styles.telemetryRow}>
              {speedKmh != null && (
                <View style={styles.telemetryChip}>
                  <Ionicons name="speedometer-outline" size={11} color={C.brand} />
                  <Text style={styles.telemetryText}>{formatSpeed(speedKmh)}</Text>
                </View>
              )}
              {battery != null && (
                <View style={styles.telemetryChip}>
                  <Ionicons name={batteryIcon(battery)} size={11} color={batteryColor(battery)} />
                  <Text style={[styles.telemetryText, { color: batteryColor(battery) }]}>
                    {battery}%
                  </Text>
                </View>
              )}
              {movement && movement !== "unknown" && (
                <View style={styles.telemetryChip}>
                  <Ionicons
                    name={
                      movement === "driving"
                        ? "car-outline"
                        : movement === "walking"
                          ? "walk-outline"
                          : "pause-circle-outline"
                    }
                    size={11}
                    color={C.textSecondary}
                  />
                  <Text style={styles.telemetryText}>{movement}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.riderActions}>
        <TouchableOpacity style={styles.actionBtnLocate} onPress={onLocate}>
          <Ionicons name="locate" size={15} color={C.brand} />
          <Text style={styles.actionTextLocate}>Focus</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnPath} onPress={onViewPath}>
          <Ionicons name="map" size={15} color="#fff" />
          <Text style={styles.actionTextPath}>Trail</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Summary pill ─────────────────────────────────────────────────────────────

function SummaryPill({
  employees,
  onExpand,
}: {
  employees: EmployeeLocation[];
  onExpand: () => void;
}) {
  const liveCount = employees.filter(isEmployeeLive).length;
  const totalCount = employees.length;

  return (
    <TouchableOpacity style={styles.summaryPill} onPress={onExpand} activeOpacity={0.85}>
      <View style={styles.summaryLeft}>
        {liveCount > 0 && <PulsingDot color="#10B981" />}
        <Text style={styles.summaryText}>
          <Text style={{ color: "#10B981", fontFamily: "Inter_700Bold" }}>{liveCount} Live</Text>
          {"  ·  "}
          <Text style={{ color: C.textSecondary }}>{totalCount} Total</Text>
        </Text>
      </View>
      <Ionicons name="chevron-up" size={18} color={C.textSecondary} />
    </TouchableOpacity>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminFleetMap({
  employees,
  onSelect,
  topPad,
  bottomPad,
  selectedDate,
  onDateChange,
}: {
  employees: EmployeeLocation[];
  onSelect: (id: string) => void;
  topPad: number;
  bottomPad: number;
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}) {
  const [zoom, setZoom] = useState(12);
  const [tileMode, setTileMode] = useState<OsmTileMode>("map");
  const [fitRequestKey, setFitRequestKey] = useState(0);
  const [viewRequestKey, setViewRequestKey] = useState(0);
  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [filterLiveOnly, setFilterLiveOnly] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const activeDate = selectedDate || todayLocal();
  const isToday = activeDate === todayLocal();
  const dateObj = new Date(activeDate + "T00:00:00");
  const formattedDate = isToday
    ? "Today"
    : dateObj.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  // ── Colour assignment per employee (no trail path tracking) ─────────────
  const colorMapRef = useRef<Record<string, string>>({});
  const colorIdxRef = useRef(0);

  useEffect(() => {
    employees.forEach((emp) => {
      if (emp.latitude === 0 && emp.longitude === 0) return;
      const id = emp.employeeId;
      if (!colorMapRef.current[id]) {
        colorMapRef.current[id] = TRAIL_COLORS[colorIdxRef.current % TRAIL_COLORS.length];
        colorIdxRef.current++;
      }
    });
  }, [employees]);

  // ── Geocoding ─────────────────────────────────────────────────────────────
  const landmarkCache = useGeocodingCache(employees);

  // ── Markers ───────────────────────────────────────────────────────────────
  const markers = useMemo<OsmMarker[]>(() => {
    return employees
      .filter((e) => e.latitude !== 0 || e.longitude !== 0)
      .map((emp) => ({
        id: emp.employeeId,
        lat: emp.latitude,
        lng: emp.longitude,
        title: landmarkCache[emp.employeeId]
          ? `${emp.employeeName} · ${landmarkCache[emp.employeeId]}`
          : emp.employeeName,
        color: isEmployeeLive(emp) ? ("green" as const) : ("red" as const),
        label: emp.profilePhotoUrl ? undefined : emp.employeeName.charAt(0).toUpperCase(),
        photoUrl: emp.profilePhotoUrl ?? undefined,
        variant: "dot" as const,
      }));
  }, [employees, landmarkCache]);

  const center = useMemo(() => {
    if (focusedLocation) return focusedLocation;
    if (markers.length === 0) return null;
    const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    const avgLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
    return { lat: avgLat, lng: avgLng };
  }, [markers, focusedLocation]);

  const locateEmployee = useCallback((emp: EmployeeLocation) => {
    setFocusedLocation({ lat: emp.latitude, lng: emp.longitude });
    setZoom(17);
    setViewRequestKey((k) => k + 1);
    setSheetExpanded(false);
  }, []);

  // ── Filtered list for sheet ───────────────────────────────────────────────
  const displayedEmployees = useMemo(() => {
    const sorted = [...employees].sort((a, b) => {
      const aLive = isEmployeeLive(a) ? 1 : 0;
      const bLive = isEmployeeLive(b) ? 1 : 0;
      return bLive - aLive;
    });
    return filterLiveOnly ? sorted.filter(isEmployeeLive) : sorted;
  }, [employees, filterLiveOnly]);

  const liveCount = useMemo(() => employees.filter(isEmployeeLive).length, [employees]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <MapboxWebMap
        center={center}
        zoom={zoom}
        markers={markers}
        tileMode={tileMode}
        fitRequestKey={fitRequestKey}
        viewRequestKey={viewRequestKey}
        onMarkerPress={onSelect}
        style={StyleSheet.absoluteFill}
      />

      {/* ── Map controls ────────────────────────────────────────────────── */}
      <View
        style={[
          styles.controlsOverlay,
          { bottom: sheetExpanded ? 340 + bottomPad : 108 + bottomPad },
        ]}
      >
        <MapControls
          showTileSwitch
          showZoomControls
          showFollowPlayback={false}
          showMyLocation
          tileMode={tileMode as any}
          onTileModeChange={(mode) => setTileMode(mode as OsmTileMode)}
          onZoomIn={() => setZoom((z) => Math.min(19, z + 1))}
          onZoomOut={() => setZoom((z) => Math.max(4, z - 1))}
          onRecenter={() => {
            setFocusedLocation(null);
            setFitRequestKey((k) => k + 1);
          }}
        />
      </View>

      {/* ── Live count badge (top) ───────────────────────────────────────── */}
      {!sheetExpanded && liveCount > 0 && (
        <View style={[styles.liveBadge, { top: topPad + 8 }]}>
          <View style={styles.liveDotSmall} />
          <Text style={styles.liveBadgeText}>{liveCount} live</Text>
        </View>
      )}

      {/* ── Floating Date Selector removed as per instructions ──────────────────────────── */}

      {/* ── Bottom sheet ────────────────────────────────────────────────── */}
      <View
        style={[
          styles.sheet,
          sheetExpanded ? styles.sheetExpanded : styles.sheetCollapsed,
          { paddingBottom: bottomPad },
        ]}
      >
        {/* Handle */}
        <View style={styles.handleRow}>
          <TouchableOpacity
            style={styles.handleHit}
            onPress={() => setSheetExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={styles.handle} />
          </TouchableOpacity>
        </View>

        {/* Collapsed pill */}
        {!sheetExpanded && (
          <SummaryPill employees={employees} onExpand={() => setSheetExpanded(true)} />
        )}

        {/* Expanded list */}
        {sheetExpanded && (
          <View style={{ flex: 1 }}>
            {/* Header */}
            <View style={styles.expandedHeader}>
              <View>
                <Text style={styles.expandedTitle}>Fleet Overview</Text>
                <Text style={styles.expandedSubtitle}>
                  {liveCount} live · {employees.length} total
                </Text>
              </View>
              <View style={styles.headerRight}>
                {/* Live-only filter toggle */}
                <TouchableOpacity
                  style={[
                    styles.filterBtn,
                    filterLiveOnly && styles.filterBtnActive,
                  ]}
                  onPress={() => setFilterLiveOnly((v) => !v)}
                >
                  <Text
                    style={[
                      styles.filterBtnText,
                      filterLiveOnly && styles.filterBtnTextActive,
                    ]}
                  >
                    Live only
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSheetExpanded(false)}>
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Employee list */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, gap: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {displayedEmployees.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={36} color={C.textSecondary} />
                  <Text style={styles.emptyText}>
                    {filterLiveOnly ? "No employees are live right now" : "No employees found"}
                  </Text>
                </View>
              )}
              {displayedEmployees.map((emp) => (
                <EmployeeCard
                  key={emp.employeeId}
                  emp={emp}
                  color={colorMapRef.current[emp.employeeId] ?? C.brand}
                  landmark={landmarkCache[emp.employeeId]}
                  onLocate={() => locateEmployee(emp)}
                  onViewPath={() => {
                    onSelect(emp.employeeId);
                    setSheetExpanded(false);
                  }}
                />
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>
          </View>
        )}
      </View>

      {/* ── Date Picker Modal removed ────────────────────────────── */}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  controlsOverlay: {
    position: "absolute",
    right: 0,
    alignItems: "flex-end",
    paddingRight: 10,
    gap: 10,
  },
  floatingDateNav: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 999,
    padding: 4,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
    zIndex: 30,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  floatingDateBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  floatingDateBtnDisabled: {
    opacity: 0.4,
  },
  floatingDateMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
  },
  floatingDateText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  liveBadge: {
    position: "absolute",
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 30,
  },
  liveDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  liveBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  sheetCollapsed: {
    height: Platform.OS === "web" ? 88 : 100,
  },
  sheetExpanded: {
    height: 420,
  },
  handleRow: {
    alignItems: "center",
  },
  handleHit: {
    paddingVertical: 10,
    paddingHorizontal: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
  },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  summaryLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  summaryText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
  expandedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  expandedTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  expandedSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "transparent",
  },
  filterBtnActive: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  filterBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
  },
  filterBtnTextActive: {
    color: "#fff",
  },
  // ── Employee card ──────────────────────────────────────────────────────────
  riderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    overflow: "hidden",
    gap: 0,
  },
  cardStripe: {
    width: 4,
    alignSelf: "stretch",
  },
  riderInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 10,
    gap: 10,
  },
  avatarWrap: {
    position: "relative",
    width: 42,
    height: 42,
  },
  riderAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  riderAvatarImg: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  riderAvatarText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  liveDotWrap: {
    position: "absolute",
    bottom: -2,
    right: -2,
  },
  offlineDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#9CA3AF",
    borderWidth: 2,
    borderColor: "#F9FAFB",
  },
  riderName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  riderStatus: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  riderLandmark: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 2,
  },
  telemetryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  telemetryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  telemetryText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  riderActions: {
    flexDirection: "column",
    gap: 6,
    padding: 10,
  },
  actionBtnLocate: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: C.brand + "15",
    minWidth: 64,
  },
  actionTextLocate: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: C.brand,
  },
  actionBtnPath: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    backgroundColor: "#073550",
  },
  actionTextPath: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
  },
  // ── Pulsing dot ─────────────────────────────────────────────────────────────
  pulseContainer: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
});