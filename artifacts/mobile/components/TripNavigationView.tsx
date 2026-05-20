import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { MapboxWebMap, type LatLng, type OsmMarker, type OsmTileMode } from "@/components/GoogleMapsWebMap";
// import { MapboxWebMap, type LatLng, type OsmMarker, type OsmTileMode } from "@/components/MapboxWebMap";
import type { LocationPoint } from "@/lib/types";
import * as Location from "expo-location";
import { deriveTripSummary, haversineMeters, type TripTimelineItem } from "@/lib/trip";
import { matchTrail } from "@/lib/googleRoadsMatching";
// import { matchTrail } from "@/lib/mapboxMatching";
import { fetchDirections, formatDistance as formatDirDistance, formatDuration as formatDirDuration, formatManeuverIcon, type DirectionsResult, type Maneuver } from "@/lib/googleDirections";
// import { fetchDirections, formatDistance as formatDirDistance, formatDuration as formatDirDuration, formatManeuverIcon, type DirectionsResult, type Maneuver } from "@/lib/mapboxDirections";

const C = Colors.light;
const SPEEDS = [0.25, 0.5, 0.75, 1, 2, 4, 8] as const;

let NativeDatePicker: typeof import("@react-native-community/datetimepicker").default | null = null;
try {
  NativeDatePicker = require("@react-native-community/datetimepicker").default;
} catch { }

type Props = {
  trail: LocationPoint[];
  matchedRoute?: number[][] | null;
  isLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  topPad: number;
  bottomPad: number;
  employeeName?: string | null;
  onBack?: () => void;
};

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return localDateStr(new Date());
}

function safeHaptic(kind: "impact" | "selection" | "success") {
  if (Platform.OS === "web") return;
  try {
    if (kind === "impact") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (kind === "selection") Haptics.selectionAsync();
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch { /* ignore */ }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "-";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatSegmentDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} mins`;
  return formatDuration(ms);
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} KM`;
  return `${Math.round(meters)} M`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(date: string): string {
  const dateObj = new Date(date + "T00:00:00");
  if (date === todayLocal()) return "Today";
  return dateObj.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function coordinateLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function TripNavigationView({
  trail,
  matchedRoute,
  isLoading,
  selectedDate,
  onDateChange,
  topPad,
  bottomPad,
  employeeName,
  onBack,
}: Props) {
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState(14);
  const [tileMode, setTileMode] = useState<OsmTileMode>("map");
  const [fitRequestKey, setFitRequestKey] = useState(0);
  const [viewRequestKey, setViewRequestKey] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [showCompletionToast, setShowCompletionToast] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [myLocationCenter, setMyLocationCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const goToMyLocation = async () => {
    if (Platform.OS === "web") {
      if (!navigator.geolocation) return;
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setMyLocationCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setViewRequestKey(k => k + 1);
          setLocating(false);
        },
        () => setLocating(false),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocating(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setMyLocationCenter({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        setViewRequestKey(k => k + 1);
      } finally {
        setLocating(false);
      }
    }
  };

  const jumpToEmployeeLocation = () => {
    safeHaptic("impact");
    setMyLocationCenter(null);
    if (points.length > 0) {
      setCurrentIndex(points.length - 1);
    }
    setFollowPlayback(true);
    setViewRequestKey(k => k + 1);
  };
  const [directions, setDirections] = useState<DirectionsResult | null>(null);
  const [showTurnList, setShowTurnList] = useState(false);
  const [clientMatchedRoute, setClientMatchedRoute] = useState<number[][] | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const currentIndexRef = useRef(currentIndex);
  const followPlaybackRef = useRef(followPlayback);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { followPlaybackRef.current = followPlayback; }, [followPlayback]);

  const summary = useMemo(() => deriveTripSummary(trail), [trail]);
  const points = summary.points;
  const activePoint = points[Math.min(currentIndex, Math.max(points.length - 1, 0))] ?? null;
  const dateObj = new Date(selectedDate + "T00:00:00");
  const isToday = selectedDate === todayLocal();

  useEffect(() => {
    setCurrentIndex((index) => Math.min(index, Math.max(points.length - 1, 0)));
    setIsPlaying(false);
    setInterpPos(null);
    interpolatedPosRef.current = null;
  }, [points.length, selectedDate]);

  // Client-side map matching fallback
  useEffect(() => {
    if (matchedRoute && matchedRoute.length >= 2) {
      setClientMatchedRoute(matchedRoute);
      return;
    }
    if (points.length < 2) {
      setClientMatchedRoute(null);
      return;
    }
    let cancelled = false;
    setIsMatching(true);
    matchTrail(points, employeeName || "unknown", selectedDate).then((result) => {
      if (!cancelled) setClientMatchedRoute(result?.coordinates ?? null);
      setIsMatching(false);
    });
    return () => { cancelled = true; };
  }, [points, matchedRoute, selectedDate, employeeName]);

  // Fetch directions between stops for navigation overview
  useEffect(() => {
    if (summary.stops.length < 1 || points.length < 2) {
      setDirections(null);
      return;
    }
    let cancelled = false;
    const waypoints: number[][] = [];
    if (points[0]) waypoints.push([points[0].longitude, points[0].latitude]);
    summary.stops.forEach((stop) => {
      waypoints.push([stop.longitude, stop.latitude]);
    });
    if (points[points.length - 1]) waypoints.push([points[points.length - 1].longitude, points[points.length - 1].latitude]);
    if (waypoints.length < 2) return;
    fetchDirections(waypoints).then((res) => {
      if (!cancelled) setDirections(res);
    });
    return () => { cancelled = true; };
  }, [summary.stops, points]);

  // Smooth proportional playback: interpolates marker position between GPS
  // points using requestAnimationFrame so motion is fluid rather than jumpy.
  const rafRef = useRef<number | null>(null);
  const interpolatedPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const [interpPos, setInterpPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!isPlaying || points.length < 2) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      interpolatedPosRef.current = null;
      setInterpPos(null);
      return;
    }

    const MIN_DELAY_MS = 120;
    const MAX_DELAY_MS = 3000;
    let cancelled = false;

    // Wall-clock time when current segment started animating
    let segmentStartWall = performance.now();
    let segmentDurationWall = MIN_DELAY_MS;

    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * Math.min(1, Math.max(0, t));
    }

    function scheduleNext(fromIdx: number) {
      if (cancelled) return;
      const idx = fromIdx;
      if (idx >= points.length - 1) {
        if (loopPlayback) {
          setCurrentIndex(0);
          setFitRequestKey((k) => k + 1);
          scheduleNext(0);
        } else {
          setIsPlaying(false);
          setShowCompletionToast(true);
          setTimeout(() => setShowCompletionToast(false), 2500);
        }
        return;
      }

      const curr = points[idx];
      const next = points[idx + 1];
      const timeGapMs = new Date(next.recordedAt).getTime() - new Date(curr.recordedAt).getTime();
      const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, timeGapMs / speed));

      segmentStartWall = performance.now();
      segmentDurationWall = delay;

      // Animate marker along the segment
      function animFrame() {
        if (cancelled) return;
        const elapsed = performance.now() - segmentStartWall;
        const t = Math.min(1, elapsed / segmentDurationWall);
        const lat = lerp(curr.latitude, next.latitude, t);
        const lng = lerp(curr.longitude, next.longitude, t);
        interpolatedPosRef.current = { lat, lng };
        setInterpPos({ lat, lng });

        if (t < 1) {
          rafRef.current = requestAnimationFrame(animFrame);
        } else {
          // Segment done — advance index and schedule next
          setCurrentIndex(idx + 1);
          scheduleNext(idx + 1);
        }
      }

      rafRef.current = requestAnimationFrame(animFrame);
    }

    scheduleNext(currentIndexRef.current);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, points, speed, loopPlayback]);

  const polyline = useMemo<LatLng[]>(
    () => points.map((point) => ({ lat: point.latitude, lng: point.longitude })),
    [points],
  );

  // Use backend-matched route if available; fallback to client-matched route
  const routePolyline = useMemo<LatLng[]>(() => {
    const route = matchedRoute && matchedRoute.length >= 2 ? matchedRoute : clientMatchedRoute;
    if (!route || route.length < 2) return [];
    return route.map(([lng, lat]) => ({ lat, lng }));
  }, [matchedRoute, clientMatchedRoute]);

  const markers = useMemo<OsmMarker[]>(() => {
    const result: OsmMarker[] = [];
    // Start marker
    if (points[0]) {
      result.push({
        id: "start",
        lat: points[0].latitude,
        lng: points[0].longitude,
        title: "Start",
        color: "green" as const,
        label: "S",
        variant: "vehicle" as const,
      });
    }
    // End marker
    if (points.length > 1 && points[points.length - 1]) {
      result.push({
        id: "end",
        lat: points[points.length - 1].latitude,
        lng: points[points.length - 1].longitude,
        title: "End",
        color: "red" as const,
        label: "E",
        variant: "vehicle" as const,
      });
    }
    // Stop markers
    summary.stops.forEach((stop) => {
      result.push({
        id: stop.id,
        lat: stop.latitude,
        lng: stop.longitude,
        title: `Stop ${stop.number} · ${formatDuration(stop.durationMs)}`,
        color: "orange" as const,
        label: String(stop.number),
        variant: "number" as const,
      });
    });
    // Playback position marker — use smooth interpolated position during replay
    if (activePoint) {
      const playLat = (isPlaying && interpPos) ? interpPos.lat : activePoint.latitude;
      const playLng = (isPlaying && interpPos) ? interpPos.lng : activePoint.longitude;
      const nextPoint = points[currentIndex + 1];
      let bearing = 0;
      if (nextPoint) {
        const dLng = (nextPoint.longitude - playLng) * (Math.PI / 180);
        const lat1 = playLat * (Math.PI / 180);
        const lat2 = nextPoint.latitude * (Math.PI / 180);
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        bearing = (Math.atan2(y, x) * 180) / Math.PI;
        bearing = (bearing + 360) % 360;
      }
      result.push({
        id: "playback",
        lat: playLat,
        lng: playLng,
        title: "Playback position",
        color: "blue" as const,
        label: "▶",
        variant: "vehicle" as const,
      });
    }
    // My Location marker
    if (myLocationCenter) {
      result.push({
        id: "my-location",
        lat: myLocationCenter.lat,
        lng: myLocationCenter.lng,
        title: "My live location",
        color: "blue" as const,
        variant: "dot" as const,
      });
    }
    return result;
  }, [activePoint, summary.stops, points, currentIndex, myLocationCenter]);

  const center = useMemo<LatLng | null>(() => {
    if (myLocationCenter) return myLocationCenter;
    // During replay with follow-mode on, use the smooth interpolated position
    if (isPlaying && followPlayback && interpPos) return interpPos;
    if (activePoint) return { lat: activePoint.latitude, lng: activePoint.longitude };
    if (points[0]) return { lat: points[0].latitude, lng: points[0].longitude };
    return null;
  }, [activePoint, points, myLocationCenter, isPlaying, followPlayback, interpPos]);

  const rangeLabel =
    summary.firstAt && summary.lastAt
      ? `${formatTime(summary.firstAt)} – ${formatTime(summary.lastAt)}${summary.durationMs > 0 ? ` · ${formatDuration(summary.durationMs)}` : ""}`
      : `${formatDateLabel(selectedDate)} - No trip`;

  const goBackDate = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onDateChange(localDateStr(d));
  };

  const goForwardDate = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    if (localDateStr(d) <= todayLocal()) onDateChange(localDateStr(d));
  };

  const handleScrub = (event: GestureResponderEvent) => {
    if (points.length <= 1 || !summary.firstAt || !summary.lastAt) return;
    const x = Math.max(0, Math.min(event.nativeEvent.locationX, scrubberWidth));
    const ratio = x / scrubberWidth;
    const firstMs = new Date(summary.firstAt).getTime();
    const lastMs = new Date(summary.lastAt).getTime();
    const totalMs = Math.max(1, lastMs - firstMs);
    const targetMs = firstMs + ratio * totalMs;
    // Find the point closest to target time
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(new Date(points[i].recordedAt).getTime() - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    setCurrentIndex(bestIndex);
  };

  const playTrail = () => {
    if (points.length <= 1) return;
    setSheetExpanded(false);
    setCurrentIndex(0);
    setFitRequestKey((key) => key + 1);
    setIsPlaying(true);
  };

  const progress = useMemo(() => {
    if (points.length <= 1 || !summary.firstAt || !summary.lastAt) return 0;
    const firstMs = new Date(summary.firstAt).getTime();
    const lastMs = new Date(summary.lastAt).getTime();
    const totalMs = Math.max(1, lastMs - firstMs);
    const currentMs = new Date(points[Math.min(currentIndex, points.length - 1)].recordedAt).getTime();
    return Math.max(0, Math.min(1, (currentMs - firstMs) / totalMs));
  }, [points, currentIndex, summary.firstAt, summary.lastAt]);
  const lastAddress = activePoint?.address ?? (activePoint ? coordinateLabel(activePoint.latitude, activePoint.longitude) : "No location data");

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapboxWebMap
        center={center}
        zoom={zoom}
        markers={markers}
        polyline={polyline}
        routePolyline={routePolyline}
        traveledPolyline={isPlaying && currentIndex > 0 ? polyline.slice(0, currentIndex + 1) : []}
        remainingPolyline={isPlaying && currentIndex < polyline.length - 1 ? polyline.slice(currentIndex) : []}
        fitToPolyline={polyline.length >= 2}
        fitRequestKey={fitRequestKey}
        viewRequestKey={viewRequestKey}
        tileMode={tileMode}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity style={[styles.headerIcon, !onBack && styles.headerIconDisabled]} onPress={onBack} disabled={!onBack}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {employeeName ? `Trip for ${employeeName}` : "My Trip"}
          </Text>
          {isToday && summary.lastAt && (new Date().getTime() - new Date(summary.lastAt).getTime() < 15 * 60 * 1000) ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity style={styles.headerIcon} onPress={() => { safeHaptic("impact"); setShowOptionsMenu(true); }}>
          <Ionicons name="ellipsis-horizontal-circle-outline" size={28} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Navigation Banner */}
      {directions && directions.legs.length > 0 && (
        <View style={[styles.navBanner, { top: topPad + 56 }]}>
          <TouchableOpacity style={styles.navBannerInner} onPress={() => setShowTurnList(true)}>
            <Ionicons name="navigate" size={18} color={C.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.navBannerPrimary} numberOfLines={1}>
                {directions.legs[0]?.steps[0]?.instruction || "Start navigation"}
              </Text>
              <Text style={styles.navBannerSecondary}>
                {formatDirDistance(directions.distance)} · {formatDirDuration(directions.duration)} · {directions.legs.length} {directions.legs.length > 1 ? "stops" : "stop"}
              </Text>
            </View>
            <Ionicons name="list" size={18} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.tileSwitch, { top: topPad + 72 + (directions && directions.legs.length > 0 ? 50 : 0) }]}>
        {(["map", "satellite"] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.tileButton, tileMode === mode && styles.tileButtonActive]}
            onPress={() => { safeHaptic("selection"); setTileMode(mode); }}>
            <Text style={styles.tileText}>{mode === "map" ? "Map" : "Satellite"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.mapControlBtn} onPress={() => setFitRequestKey((key) => key + 1)}>
          <Ionicons name="scan-outline" size={24} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapControlBtn} onPress={() => { safeHaptic("impact"); setZoom((value) => Math.min(18, value + 1)); }}>
          <Ionicons name="add-circle-outline" size={25} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapControlBtn} onPress={() => { safeHaptic("impact"); setZoom((value) => Math.max(4, value - 1)); }}>
          <Ionicons name="remove-circle-outline" size={25} color={C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mapControlBtn, followPlayback && styles.mapControlBtnActive]} onPress={() => { safeHaptic("selection"); setFollowPlayback((v) => !v); }}>
          <Ionicons name={followPlayback ? "navigate" : "navigate-outline"} size={22} color={followPlayback ? C.brand : C.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapControlBtn} onPress={jumpToEmployeeLocation}>
          <Ionicons name="person-circle" size={26} color={C.brand} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.mapControlBtn, styles.myLocationBtn]}
          onPress={() => { safeHaptic("impact"); void goToMyLocation(); }}
          disabled={locating}
        >
          {locating
            ? <ActivityIndicator size="small" color={C.brand} />
            : <Ionicons name="locate" size={22} color={C.brand} />
          }
        </TouchableOpacity>
      </View>

      {points.length >= 2 && currentIndex > 0 ? (
        <View style={[styles.speedBubble, { top: topPad + 130 }]}>
          <Text style={styles.speedValue}>
            {(() => {
              const curr = points[currentIndex];
              if (curr.speedKmh != null && curr.speedKmh >= 0) {
                return String(Math.round(curr.speedKmh));
              }
              return "0";
            })()}
          </Text>
          <Text style={styles.speedUnit}>km/h</Text>
          {isPlaying && activePoint ? (
            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff", marginTop: 2 }}>
              {formatTime(activePoint.recordedAt)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showCompletionToast ? (
        <View style={styles.toastOverlay} pointerEvents="none">
          <View style={styles.toastBox}>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <Text style={styles.toastText}>Replay complete</Text>
          </View>
        </View>
      ) : null}

      {isMatching ? (
        <View style={[styles.snappingBadge, { top: topPad + 56 + (directions && directions.legs.length > 0 ? 50 : 0) }]} pointerEvents="none">
          <ActivityIndicator size="small" color={C.brand} />
          <Text style={styles.snappingText}>Snapping to roads…</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      ) : null}

      <View
        style={[
          styles.sheet,
          sheetExpanded ? styles.sheetExpanded : styles.sheetCollapsed,
          { paddingBottom: sheetExpanded ? Math.max(bottomPad - 64, 20) : bottomPad },
        ]}
      >
        <TouchableOpacity style={styles.handleHit} onPress={() => setSheetExpanded((value) => !value)}>
          <View style={styles.handle} />
        </TouchableOpacity>

        {sheetExpanded ? (
          <ExpandedSheet
            selectedDate={selectedDate}
            dateObj={dateObj}
            isToday={isToday}
            showPicker={showPicker}
            setShowPicker={setShowPicker}
            goBackDate={goBackDate}
            goForwardDate={goForwardDate}
            onDateChange={onDateChange}
            summary={summary}
            rangeLabel={rangeLabel}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            speed={speed}
            setSpeed={setSpeed}
            progress={progress}
            handleScrub={handleScrub}
            setScrubberWidth={setScrubberWidth}
            playTrail={playTrail}
            onClose={() => setSheetExpanded(false)}
            loopPlayback={loopPlayback}
            setLoopPlayback={setLoopPlayback}
            points={points}
            currentIndex={currentIndex}
            setCurrentIndex={setCurrentIndex}
            setFitRequestKey={setFitRequestKey}
          />
        ) : (
          <CollapsedSheet
            rangeLabel={rangeLabel}
            summary={summary}
            lastAddress={lastAddress}
            lastAt={activePoint?.recordedAt ?? summary.lastAt}
            onExpand={() => setSheetExpanded(true)}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            canPlay={points.length > 1}
            playTrail={playTrail}
            isToday={isToday}
            points={points}
            currentIndex={currentIndex}
          />
        )}
      </View>

      {/* Turn List Modal */}
      <Modal visible={showTurnList} transparent animationType="slide" onRequestClose={() => setShowTurnList(false)}>
        <Pressable style={styles.turnListOverlay} onPress={() => setShowTurnList(false)}>
          <View style={styles.turnListSheet}>
            <View style={styles.turnListHeader}>
              <Text style={styles.turnListTitle}>Route Overview</Text>
              <TouchableOpacity onPress={() => setShowTurnList(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
            {directions?.legs.map((leg, legIdx) =>
              leg.steps.map((step, stepIdx) => (
                <View key={`${legIdx}-${stepIdx}`} style={styles.turnItem}>
                  <Ionicons name={formatManeuverIcon(step.type, step.modifier) as any} size={20} color={C.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.turnInstruction}>{step.instruction}</Text>
                    <Text style={styles.turnDistance}>{formatDirDistance(step.distance)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Options Menu */}
      <Modal visible={showOptionsMenu} transparent animationType="fade" onRequestClose={() => setShowOptionsMenu(false)}>
        <Pressable style={styles.optionsOverlay} onPress={() => setShowOptionsMenu(false)}>
          <View style={[styles.optionsMenu, { top: topPad + 60, right: 16 }]}>
            {directions ? (
              <TouchableOpacity style={styles.optionItem} onPress={() => { safeHaptic("selection"); setShowTurnList(true); setShowOptionsMenu(false); }}>
                <Ionicons name="list" size={20} color={C.text} />
                <Text style={styles.optionText}>Turn List</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.optionItem} onPress={() => { safeHaptic("selection"); setFollowPlayback((v) => !v); setShowOptionsMenu(false); }}>
              <Ionicons name={followPlayback ? "navigate" : "navigate-outline"} size={20} color={C.text} />
              <Text style={styles.optionText}>{followPlayback ? "Unfollow playback" : "Follow playback"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionItem} onPress={() => { safeHaptic("selection"); setLoopPlayback((v) => !v); setShowOptionsMenu(false); }}>
              <Ionicons name={loopPlayback ? "repeat" : "repeat-outline"} size={20} color={C.text} />
              <Text style={styles.optionText}>{loopPlayback ? "Disable loop" : "Enable loop"}</Text>
            </TouchableOpacity>
            {!isToday ? (
              <TouchableOpacity style={styles.optionItem} onPress={() => { safeHaptic("selection"); onDateChange(todayLocal()); setShowOptionsMenu(false); }}>
                <Ionicons name="today-outline" size={20} color={C.text} />
                <Text style={styles.optionText}>Go to Today</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.optionItem} onPress={() => { safeHaptic("impact"); setShowOptionsMenu(false); }}>
              <Ionicons name="close-circle-outline" size={20} color={C.textSecondary} />
              <Text style={[styles.optionText, { color: C.textSecondary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function SpeedSparkline({ points }: { points: LocationPoint[] }) {
  const speeds = points.map((p) => p.speedKmh ?? 0);
  const maxSpeed = Math.max(1, ...speeds);
  const bars = 40;
  const step = Math.max(1, Math.floor(points.length / bars));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 40, gap: 1 }}>
      {Array.from({ length: Math.min(bars, points.length) }).map((_, i) => {
        const idx = Math.min(i * step, points.length - 1);
        const speed = speeds[idx];
        const heightPct = Math.max(4, (speed / maxSpeed) * 100);
        const color = speed <= 2 ? "#EF4444" : speed <= 15 ? "#F59E0B" : speed <= 60 ? "#10B981" : "#3B82F6";
        return <View key={i} style={{ flex: 1, height: `${heightPct}%`, backgroundColor: color, borderRadius: 1 }} />;
      })}
    </View>
  );
}

function BatterySparkline({ points }: { points: LocationPoint[] }) {
  const batteries = points
    .filter((p) => p.batteryLevel != null)
    .map((p) => p.batteryLevel!);
  if (batteries.length < 2) return null;
  const bars = 40;
  const step = Math.max(1, Math.floor(batteries.length / bars));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 40, gap: 1 }}>
      {Array.from({ length: Math.min(bars, batteries.length) }).map((_, i) => {
        const idx = Math.min(i * step, batteries.length - 1);
        const level = batteries[idx];
        const heightPct = Math.max(4, level);
        const color = level <= 10 ? "#EF4444" : level <= 20 ? "#F59E0B" : "#10B981";
        return <View key={i} style={{ flex: 1, height: `${heightPct}%`, backgroundColor: color, borderRadius: 1 }} />;
      })}
    </View>
  );
}

function MetricsRow({ summary }: { summary: ReturnType<typeof deriveTripSummary> }) {
  const hasGaps = summary.gaps.length > 0;
  const stopBreakdown = summary.stops.length > 0
    ? `M${summary.microStops} · S${summary.shortStops} · L${summary.longStops} · O${summary.overnightStops}`
    : "No stops";
  return (
    <View style={styles.metrics}>
      <Metric color="#10B981" icon="ellipse" label="Travelled" value={formatDistance(summary.distanceMeters)} sub={formatDuration(summary.drivingDurationMs)} />
      <Metric color={C.accent} icon="remove-circle" label="Stops" value={`${summary.stops.length} stops`} sub={stopBreakdown} />
      {hasGaps ? (
        <Metric color="#9CA3AF" icon="cellular" label="Gaps" value={`${summary.gaps.length}`} sub={formatDuration(summary.gapDurationMs)} />
      ) : (
        <Metric color="#3B82F6" icon="speedometer" label="Avg Speed" value={`${summary.avgSpeedKmh} km/h`} sub={`Max ${summary.maxSpeedKmh} km/h`} />
      )}
    </View>
  );
}

function Metric({
  color,
  icon,
  label,
  value,
  sub,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricLabelRow}>
        <Ionicons name={icon} size={17} color={color} />
        <Text style={[styles.metricLabel, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricSub}>{sub}</Text>
    </View>
  );
}

function CollapsedSheet({
  rangeLabel,
  summary,
  lastAddress,
  lastAt,
  onExpand,
  isPlaying,
  setIsPlaying,
  canPlay,
  playTrail,
  isToday,
  points,
  currentIndex,
}: {
  rangeLabel: string;
  summary: ReturnType<typeof deriveTripSummary>;
  lastAddress: string;
  lastAt: string | null;
  onExpand: () => void;
  isPlaying: boolean;
  setIsPlaying: (value: boolean) => void;
  canPlay: boolean;
  playTrail: () => void;
  isToday: boolean;
  points: LocationPoint[];
  currentIndex: number;
}) {
  return (
    <>
      <View style={styles.collapsedTop}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.rangeText} numberOfLines={1}>
            {rangeLabel}
          </Text>
          {isPlaying && points.length > 1 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", overflow: "hidden" }}>
                <View style={{ width: `${Math.round((currentIndex / (points.length - 1)) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: C.brand }} />
              </View>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: C.brand }}>
                {Math.round((currentIndex / (points.length - 1)) * 100)}%
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity style={[styles.trailButton, !canPlay && styles.disabled]} onPress={playTrail} disabled={!canPlay}>
          <View style={styles.tripPlayDot}>
            <Ionicons name="play" size={15} color="#fff" />
          </View>
          <Text style={styles.tripHistoryText}>Replay</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tripHistoryButton} onPress={onExpand}>
          <View style={styles.tripPlayDot}>
            <Ionicons name="list" size={14} color="#fff" />
          </View>
          <Text style={styles.tripHistoryText}>Details</Text>
        </TouchableOpacity>
      </View>
      <MetricsRow summary={summary} />
      <View style={styles.statusRow}>
        <View style={[styles.stopIcon, isPlaying && { backgroundColor: "#3B82F6" }]}>
          <Ionicons name={isPlaying ? "play" : isToday ? (summary.currentMovement === "moving" ? "car-sport" : "pause") : "flag"} size={22} color="#fff" />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>{isPlaying ? "Replaying" : isToday ? (summary.currentMovement === "moving" ? "Moving" : "Stopped") : "Trip ended"}</Text>
          <Text style={styles.statusMeta}>{isPlaying ? "Playback time" : "Last updated"} : {formatTime(lastAt)}</Text>
          <Text style={styles.statusAddress} numberOfLines={2}>
            {lastAddress}
          </Text>
        </View>
        <TouchableOpacity style={[styles.playMini, !canPlay && styles.disabled]} disabled={!canPlay} onPress={() => setIsPlaying(!isPlaying)}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </>
  );
}

function ExpandedSheet({
  selectedDate,
  dateObj,
  isToday,
  showPicker,
  setShowPicker,
  goBackDate,
  goForwardDate,
  onDateChange,
  summary,
  rangeLabel,
  isPlaying,
  setIsPlaying,
  speed,
  setSpeed,
  progress,
  handleScrub,
  setScrubberWidth,
  playTrail,
  onClose,
  loopPlayback,
  setLoopPlayback,
  points,
  currentIndex,
  setCurrentIndex,
  setFitRequestKey,
}: {
  selectedDate: string;
  dateObj: Date;
  isToday: boolean;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
  goBackDate: () => void;
  goForwardDate: () => void;
  onDateChange: (date: string) => void;
  summary: ReturnType<typeof deriveTripSummary>;
  rangeLabel: string;
  isPlaying: boolean;
  setIsPlaying: (value: boolean) => void;
  speed: (typeof SPEEDS)[number];
  setSpeed: (value: (typeof SPEEDS)[number]) => void;
  progress: number;
  handleScrub: (event: GestureResponderEvent) => void;
  setScrubberWidth: (width: number) => void;
  playTrail: () => void;
  onClose: () => void;
  loopPlayback: boolean;
  setLoopPlayback: React.Dispatch<React.SetStateAction<boolean>>;
  points: LocationPoint[];
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  setFitRequestKey: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.expandedContent}>
      <MetricsRow summary={summary} />

      <View style={styles.dateRangeRow}>
        <TouchableOpacity style={styles.datePill} onPress={() => setShowPicker(true)}>
          <Text style={styles.datePillText}>{formatDateLabel(selectedDate)}</Text>
          <Ionicons name="caret-down" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.rangeMuted} numberOfLines={1}>
          {summary.durationMs > 0 ? formatDuration(summary.durationMs) : rangeLabel}
        </Text>
        <TouchableOpacity style={styles.closeRound} onPress={() => { safeHaptic("impact"); onClose(); }}>
          <Ionicons name="close" size={20} color={C.text} />
        </TouchableOpacity>
      </View>
      {showPicker && NativeDatePicker ? (
        <NativeDatePicker
          mode="date"
          value={dateObj}
          maximumDate={new Date()}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_evt: { type: string }, date?: Date) => {
            setShowPicker(Platform.OS === "ios");
            if (date) onDateChange(localDateStr(date));
          }}
        />
      ) : null}

      <View style={styles.dateButtons}>
        <TouchableOpacity style={styles.smallDateBtn} onPress={() => { safeHaptic("impact"); goBackDate(); }}>
          <Ionicons name="chevron-back" size={16} color={C.text} />
        </TouchableOpacity>
        {!isToday ? (
          <TouchableOpacity style={styles.todayBtn} onPress={() => { safeHaptic("selection"); onDateChange(todayLocal()); }}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.smallDateBtn} onPress={() => { safeHaptic("impact"); goForwardDate(); }} disabled={isToday}>
          <Ionicons name="chevron-forward" size={16} color={isToday ? C.border : C.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.playbackRow}>
        <TouchableOpacity
          style={[styles.skipButton, summary.points.length < 2 && styles.disabled]}
          disabled={summary.points.length < 2}
          onPress={() => { safeHaptic("impact"); setCurrentIndex((i) => Math.max(0, i - Math.max(1, Math.floor(points.length * 0.1)))); }}
        >
          <Ionicons name="play-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Pressable
          style={styles.scrubber}
          onPress={handleScrub}
          onLayout={(event) => setScrubberWidth(Math.max(1, event.nativeEvent.layout.width))}
        >
          <View style={[styles.scrubberFill, { width: `${Math.max(0.02, progress) * 100}%` }]} />
          <View style={[styles.scrubberThumb, { left: `${progress * 100}%` }]} />
        </Pressable>
        <TouchableOpacity
          style={[styles.playButton, summary.points.length < 2 && styles.disabled]}
          disabled={summary.points.length < 2}
          onPress={() => { safeHaptic("impact"); setIsPlaying(!isPlaying); }}
        >
          <Ionicons name={isPlaying ? "pause" : "play"} size={26} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.skipButton, summary.points.length < 2 && styles.disabled]}
          disabled={summary.points.length < 2}
          onPress={() => { safeHaptic("impact"); setCurrentIndex((i) => Math.min(points.length - 1, i + Math.max(1, Math.floor(points.length * 0.1)))); }}
        >
          <Ionicons name="play-forward" size={20} color={C.text} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.fullTrailButton, summary.points.length < 2 && styles.disabled]}
        disabled={summary.points.length < 2}
        onPress={() => { safeHaptic("impact"); playTrail(); }}
      >
        <Ionicons name="play-forward" size={20} color="#fff" />
        <Text style={styles.fullTrailText}>Replay Full Route</Text>
      </TouchableOpacity>

      <View style={styles.speedRow}>
        {SPEEDS.map((candidate) => {
          const labels: Record<number, string> = {
            0.25: "Slow",
            0.5: "Half",
            0.75: "3/4",
            1: "Normal",
            2: "Fast",
            4: "2x",
            8: "Max",
          };
          return (
            <TouchableOpacity
              key={candidate}
              style={[styles.speedBtn, speed === candidate && styles.speedBtnActive]}
              onPress={() => { safeHaptic("selection"); setSpeed(candidate); }}
            >
              <Text style={[styles.speedBtnText, speed === candidate && styles.speedBtnTextActive]}>
                {labels[candidate] ?? `${candidate}x`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24, paddingTop: 8 }}>
        <TouchableOpacity
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: loopPlayback ? C.brand + "15" : "#F2F2F2", borderWidth: 1, borderColor: loopPlayback ? C.brand + "40" : "transparent" }}
          onPress={() => { safeHaptic("selection"); setLoopPlayback((v) => !v); }}
        >
          <Ionicons name={loopPlayback ? "repeat" : "repeat-outline"} size={16} color={loopPlayback ? C.brand : C.textSecondary} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: loopPlayback ? C.brand : C.textSecondary }}>Loop</Text>
        </TouchableOpacity>
      </View>

      {/* Speed mini-graph */}
      {points.length > 1 && (
        <View style={{ paddingHorizontal: 24, paddingTop: 16 }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 6 }}>Speed Graph</Text>
          <SpeedSparkline points={points} />
        </View>
      )}

      {/* Battery drain graph */}
      {points.some((p) => p.batteryLevel != null) && (
        <View style={{ paddingHorizontal: 24, paddingTop: 16 }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 6 }}>Battery Drain</Text>
          <BatterySparkline points={points} />
        </View>
      )}

      <Text style={styles.historyTab}>TRIP TIMELINE</Text>
      {summary.timeline.length > 0 ? (
        summary.timeline.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            points={points}
            onPress={() => {
              safeHaptic("selection");
              setIsPlaying(false);
              let targetIndex = 0;
              if (item.type === "driving") {
                targetIndex = item.startIndex;
              } else if (item.type === "stop") {
                targetIndex = item.startIndex;
              } else if (item.type === "gap") {
                // Find the point just before the gap
                const gapStartMs = new Date(item.startAt).getTime();
                targetIndex = Math.max(0, points.findIndex((p) => new Date(p.recordedAt).getTime() >= gapStartMs) - 1);
              }
              setCurrentIndex(Math.min(targetIndex, points.length - 1));
              setFitRequestKey((k) => k + 1);
            }}
          />
        ))
      ) : (
        <View style={styles.emptyTrip}>
          <Ionicons name="map-outline" size={36} color={C.textSecondary} />
          <Text style={styles.emptyText}>No trip recorded</Text>
          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center", marginTop: 4 }}>
            {formatDateLabel(selectedDate)}
          </Text>
          {selectedDate !== todayLocal() ? (
            <TouchableOpacity style={styles.emptyAction} onPress={() => onDateChange(todayLocal())}>
              <Ionicons name="today-outline" size={16} color="#fff" />
              <Text style={styles.emptyActionText}>Go to Today</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function TimelineItem({ item, onPress, points }: { item: TripTimelineItem; onPress?: () => void; points: LocationPoint[] }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  if (item.type === "driving") {
    const startPoint = points[item.startIndex];
    const endPoint = points[item.endIndex];
    const startAddr = item.startAddress ?? coordinateLabel(startPoint?.latitude ?? 0, startPoint?.longitude ?? 0);
    const endAddr = item.endAddress ?? coordinateLabel(endPoint?.latitude ?? 0, endPoint?.longitude ?? 0);
    return (
      <Wrapper style={styles.timelineDrive} {...wrapperProps}>
        <View style={styles.timelineLine} />
        <View style={styles.timelineContent}>
          <View style={styles.driveTitle}>
            <Ionicons name="car-sport-outline" size={18} color="#6B7280" />
            <Text style={styles.driveText}>Driving</Text>
          </View>
          <Text style={styles.driveMeta}>
            {formatSegmentDuration(item.durationMs)} · {(item.distanceMeters / 1000).toFixed(1)} km
          </Text>
          <Text style={styles.driveAddress} numberOfLines={1}>
            {formatTime(item.startAt)} · {startAddr}
          </Text>
          <Text style={styles.driveAddress} numberOfLines={1}>
            {formatTime(item.endAt)} · {endAddr}
          </Text>
        </View>
      </Wrapper>
    );
  }

  if (item.type === "gap") {
    return (
      <Wrapper style={styles.timelineGap} {...wrapperProps}>
        <View style={styles.gapTimelineIcon}>
          <Ionicons name="warning-outline" size={16} color="#fff" />
        </View>
        <View style={styles.timelineContent}>
          <View style={styles.gapTitleRow}>
            <Text style={styles.gapTitle}>Signal lost</Text>
            <Text style={styles.gapDuration}>{formatSegmentDuration(item.durationMs)}</Text>
          </View>
          <Text style={styles.gapTime}>
            {formatTime(item.startAt)} to {formatTime(item.endAt)}
          </Text>
        </View>
      </Wrapper>
    );
  }

  const address = item.address ?? coordinateLabel(item.latitude, item.longitude);
  const stopTypeLabel = (item as any).stopType
    ? String((item as any).stopType).charAt(0).toUpperCase() + String((item as any).stopType).slice(1)
    : "Stop";
  const stopTypeColor =
    (item as any).stopType === "micro"
      ? "#F59E0B"
      : (item as any).stopType === "short"
        ? "#3B82F6"
        : (item as any).stopType === "long"
          ? "#8B5CF6"
          : (item as any).stopType === "overnight"
            ? "#EF4444"
            : C.accent;
  return (
    <Wrapper style={styles.timelineStop} {...wrapperProps}>
      <View style={[styles.stopTimelineIcon, { backgroundColor: stopTypeColor }]}>
        <Ionicons name="location" size={20} color="#fff" />
      </View>
      <View style={styles.timelineContent}>
        <View style={styles.stopTitleRow}>
          <Text style={styles.stopTitle}>{stopTypeLabel} {item.number}</Text>
          <Text style={styles.stopDuration}>{formatSegmentDuration(item.durationMs)}</Text>
        </View>
        <Text style={styles.stopTime}>
          {formatTime(item.startAt)} to {formatTime(item.endAt)}
        </Text>
        <Text style={styles.stopAddress}>{address}</Text>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: 82,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 14,
    zIndex: 10,
  },
  headerIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerIconDisabled: { opacity: 0.35 },
  headerTitle: { fontSize: 23, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  liveText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#EF4444", letterSpacing: 0.8 },
  tileSwitch: {
    position: "absolute",
    right: 30,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 8,
    overflow: "hidden",
    elevation: 5,
    zIndex: 9,
  },
  tileButton: { paddingHorizontal: 18, paddingVertical: 14, backgroundColor: "rgba(245,245,245,0.96)" },
  tileButtonActive: { backgroundColor: "#fff" },
  tileText: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  mapControls: { position: "absolute", right: 28, top: "38%", gap: 14, zIndex: 8 },
  trailControlBtn: {
    minWidth: 78,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#073550",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  trailControlText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  mapControlBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  mapControlBtnActive: {
    backgroundColor: C.brand + "15",
    borderWidth: 1,
    borderColor: C.brand + "40",
  },
  myLocationBtn: {
    borderWidth: 2,
    borderColor: C.brand + "30",
    backgroundColor: "#EBF3FF",
  },
  speedBubble: {
    position: "absolute",
    left: 28,
    bottom: 300,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#073550",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  speedValue: { color: "#fff", fontSize: 24, fontFamily: "Inter_700Bold" },
  speedUnit: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },
  toastOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingTop: 120,
    zIndex: 25,
  },
  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  toastText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#0B2A3A" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    zIndex: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  sheetCollapsed: { paddingTop: 10, paddingHorizontal: 24, minHeight: 270 },
  sheetExpanded: { top: 92, paddingTop: 8 },
  handleHit: { alignItems: "center", paddingVertical: 8 },
  handle: { width: 44, height: 6, borderRadius: 3, backgroundColor: "#C9C9C9" },
  metrics: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingVertical: 14 },
  metric: { width: "31%" },
  metricLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metricLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  metricValue: { marginTop: 7, fontSize: 23, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  metricSub: { marginTop: 3, fontSize: 15, fontFamily: "Inter_500Medium", color: "#0B2A3A" },
  collapsedTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 2 },
  rangeText: { flex: 1, fontSize: 18, fontFamily: "Inter_500Medium", color: "#171717" },
  tripHistoryButton: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 8, backgroundColor: "#EFEFEF" },
  trailButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 8, backgroundColor: "#EFEFEF" },
  tripPlayDot: { width: 31, height: 31, borderRadius: 16, backgroundColor: "#073550", alignItems: "center", justifyContent: "center" },
  tripHistoryText: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111" },
  statusRow: { flexDirection: "row", gap: 14, paddingTop: 10, alignItems: "flex-start" },
  stopIcon: { width: 35, height: 35, borderRadius: 18, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", marginTop: 2 },
  statusCopy: { flex: 1 },
  statusTitle: { fontSize: 19, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  statusMeta: { marginTop: 4, fontSize: 14, fontFamily: "Inter_500Medium", color: "#6B7280" },
  statusAddress: { marginTop: 6, fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium", color: "#0B2A3A" },
  playMini: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#073550", alignItems: "center", justifyContent: "center", marginTop: 2 },
  disabled: { opacity: 0.45 },
  expandedContent: { paddingBottom: 28 },
  dateRangeRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 12 },
  datePill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0F0F0", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  datePillText: { fontSize: 18, fontFamily: "Inter_500Medium", color: "#111" },
  rangeMuted: { flex: 1, fontSize: 18, fontFamily: "Inter_400Regular", color: "#737373" },
  closeRound: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F2F2F2", alignItems: "center", justifyContent: "center" },
  dateButtons: { flexDirection: "row", gap: 8, paddingHorizontal: 24, paddingTop: 8 },
  smallDateBtn: { width: 32, height: 30, borderRadius: 8, backgroundColor: "#F2F2F2", alignItems: "center", justifyContent: "center" },
  todayBtn: { height: 30, borderRadius: 8, backgroundColor: C.brand + "12", borderWidth: 1, borderColor: C.brand + "30", paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  todayBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.brand },
  playbackRow: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 24, paddingTop: 24 },
  scrubber: { flex: 1, height: 46, borderRadius: 23, borderWidth: 6, borderColor: "#E5F0E7", justifyContent: "center", backgroundColor: "#fff" },
  scrubberFill: { position: "absolute", left: 0, height: 34, borderRadius: 18, backgroundColor: "rgba(16,185,129,0.13)" },
  scrubberThumb: { position: "absolute", width: 38, height: 38, borderRadius: 19, marginLeft: -19, backgroundColor: "#0E7968", borderWidth: 3, borderColor: "#D1D5DB" },
  playButton: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#073550", alignItems: "center", justifyContent: "center" },
  skipButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#F2F2F2", alignItems: "center", justifyContent: "center" },
  fullTrailButton: {
    marginHorizontal: 24,
    marginTop: 14,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#073550",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  fullTrailText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  speedRow: { flexDirection: "row", gap: 10, paddingHorizontal: 24, paddingTop: 18 },
  speedBtn: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: "#EFEFEF" },
  speedBtnActive: { backgroundColor: "#073550" },
  speedBtnText: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  speedBtnTextActive: { color: "#fff" },
  historyTab: {
    alignSelf: "center",
    marginTop: 42,
    paddingHorizontal: 38,
    paddingTop: 16,
    paddingBottom: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#F4F4F4",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#6B6B6B",
  },
  timelineDate: { backgroundColor: "#F4F4F4", paddingHorizontal: 24, paddingVertical: 18, fontSize: 17, fontFamily: "Inter_700Bold", color: "#1687F2" },
  timelineDrive: { flexDirection: "row", paddingHorizontal: 24, minHeight: 82 },
  timelineLine: { width: 5, backgroundColor: "#10B981", marginLeft: 20, marginRight: 36 },
  timelineContent: { flex: 1, paddingVertical: 14 },
  driveTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  driveText: { fontSize: 16, fontFamily: "Inter_500Medium", color: "#243342" },
  driveMeta: { marginTop: 7, marginLeft: 26, fontSize: 13, fontFamily: "Inter_400Regular", color: "#737373" },
  driveAddress: { marginTop: 3, marginLeft: 26, fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  timelineGap: { flexDirection: "row", paddingHorizontal: 24, paddingVertical: 8, backgroundColor: "#FEF3C7" },
  gapTimelineIcon: { width: 35, height: 35, borderRadius: 18, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", marginLeft: 3, marginRight: 34 },
  gapTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  gapTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#92400E" },
  gapDuration: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#B45309" },
  gapTime: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: "#B45309" },
  timelineStop: { flexDirection: "row", paddingHorizontal: 24, paddingVertical: 8 },
  stopTimelineIcon: { width: 35, height: 35, borderRadius: 18, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", marginLeft: 3, marginRight: 34 },
  stopTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  stopTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  stopDuration: { fontSize: 16, fontFamily: "Inter_500Medium", color: C.accent },
  stopTime: { marginTop: 6, fontSize: 15, fontFamily: "Inter_400Regular", color: "#737373" },
  stopAddress: { marginTop: 7, fontSize: 16, lineHeight: 21, fontFamily: "Inter_400Regular", color: "#737373" },
  emptyTrip: { alignItems: "center", gap: 8, paddingVertical: 34 },
  emptyText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary, textAlign: "center" },
  emptyAction: {
    marginTop: 12,
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: C.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyActionText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  optionsOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)" },
  optionsMenu: {
    position: "absolute",
    width: 220,
    borderRadius: 14,
    backgroundColor: "#fff",
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionText: { fontSize: 15, fontFamily: "Inter_500Medium", color: C.text },
  navBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 11,
  },
  navBannerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
  navBannerPrimary: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#0B2A3A" },
  navBannerSecondary: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  turnListOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  turnListSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    maxHeight: "70%",
  },
  turnListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  turnListTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#0B2A3A" },
  turnItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  turnInstruction: { fontSize: 15, fontFamily: "Inter_500Medium", color: "#0B2A3A" },
  turnDistance: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  snappingBadge: {
    position: "absolute",
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 11,
  },
  snappingText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.text },
});