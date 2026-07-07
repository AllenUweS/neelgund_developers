/**
 * useLocationTracker.ts — AGGRESSIVE v4
 *
 * Objective: continuous location uploads + heartbeats for 8+ hours,
 * surviving screen-off, Doze, process kill, overnight execution.
 * Reliability > battery savings.
 *
 * Changes from v3:
 *
 *  TIMING — ALL intervals now ≤ 2 minutes
 *  ──────────────────────────────────────
 *  WATCHDOG_INTERVAL_MS        60s → 30s   (JS foreground watchdog)
 *  BG heartbeat throttle       60s → 30s   (piggyback on GPS flush)
 *  BG explicit heartbeat       60s → 30s   (in LOCATION_TASK_NAME)
 *  BackgroundFetch interval    10m → 2m    (JS BG watchdog)
 *  StickyLocationService alarm  5m → 2m    (native Doze alarm)  ← see .kt
 *
 *  WATCHDOG — auto full-recovery on ANY of:
 *  ─────────────────────────────────────────
 *  • no location upload for > 2 minutes
 *  • no heartbeat for > 2 minutes
 *  • task missing
 *  • JS location subscription missing
 *  → restart tracking, re-register task, reconnect Supabase, restart listeners
 *  → log "watchdog_restart" diagnostic
 *
 *  AUTH — uses new 3-stage getCurrentUserId with refresh + retry
 *  ─────────────────────────────────────────────────────────────
 *  Failures now throw; the watchdog catches them and force-restarts.
 *
 *  DIAGNOSTICS — every key event logged to Supabase via logDiagnostic()
 *  ──────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef } from "react";
import { AppState, Platform, Linking, NativeModules } from "react-native";
import { persistUserId } from "@/utils/tokenStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import * as Battery from "expo-battery";
import { getPersistedAuthToken } from "@/utils/tokenStorage";
import { trackLocationBatch, sendHeartbeatRest, logDiagnostic } from "@/lib/trackingApi";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

// ─── Task / storage keys ──────────────────────────────────────────────────────

const LOCATION_TASK_NAME  = "neelgund-background-location";
const HEARTBEAT_TASK_NAME = "neelgund-heartbeat";
const BG_FETCH_TASK_NAME  = "neelgund-bg-fetch";

const TRACKING_QUEUE_PREFIX = "neelgund:tracking:queue:v2:";
const TRACKING_QUEUE_MAX    = 200;

// ─── Timing constants — ALL ≤ 2 minutes ──────────────────────────────────────

/** JS-side flush loop: flush every 5 s */
const BATCH_FLUSH_INTERVAL_MS = 5_000;

/** JS foreground watchdog: check tracking health every 30 s */
const WATCHDOG_INTERVAL_MS = 30_000;

/**
 * If no GPS upload or heartbeat arrives within this window, the watchdog
 * triggers a full recovery restart.
 */
const STALE_TRACKING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/** Heartbeat piggybacked on GPS flush (throttled) */
const FLUSH_HEARTBEAT_THROTTLE_MS = 30_000;

/** Explicit BG heartbeat throttle inside LOCATION_TASK_NAME */
const BG_HEARTBEAT_THROTTLE_MS = 30_000;

const BATTERY_CRITICAL = 10;
const BATTERY_LOW      = 20;
const MAX_SPEED_KMH    = 200;
const MAX_ACCURACY_METERS = 50;

// ─── Stationary / distance filter ────────────────────────────────────────────

const STATIONARY_CONFIRM_POINTS      = 2;
const STATIONARY_RADIUS_M            = 15;
const MIN_DIST_MOVING_M              = 5;
const MIN_DIST_WALKING_M             = 5;
const MIN_DIST_STATIONARY_M          = 8;
const MOVING_SPEED_KMH               = 5;
const WALKING_SPEED_KMH              = 2;
const DISPLACEMENT_MOVING_OVERRIDE_M = 30;

// ─── Tracking intervals — aggressive ─────────────────────────────────────────

const TRACKING_CONFIG = {
  movingFast: { intervalMs: 1_000,  distanceM: MIN_DIST_MOVING_M },
  movingSlow: { intervalMs: 3_000,  distanceM: MIN_DIST_MOVING_M },
  walking:    { intervalMs: 3_000,  distanceM: MIN_DIST_WALKING_M },
  stationary: { intervalMs: 10_000, distanceM: MIN_DIST_STATIONARY_M },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityType  = "driving" | "walking" | "stationary" | "unknown";
export type MovementState = "moving"  | "walking"  | "stationary";

export type TrackingPoint = {
  latitude:            number;
  longitude:           number;
  accuracy?:           number;
  speedKmh?:           number;
  heading?:            number;
  altitude?:           number;
  batteryLevel?:       number;
  activityType:        ActivityType;
  movementState:       MovementState;
  stationaryCluster:   number;
  eligibleForSnapping: boolean;
  source:              "foreground" | "background";
  recordedAt:          string;
};

type QueuedPoint = TrackingPoint & { ownerId: string };

// ─── Shared keys ─────────────────────────────────────────────────────────────

const STATIONARY_STATE_KEY = "neelgund:stationary:state:v1";
const POINTS_TODAY_KEY     = "neelgund:points:today:v1";

/** Key for "last successful upload timestamp" — used by watchdog */
const LAST_UPLOAD_AT_KEY   = "neelgund:last_upload_at";
/** Key for "last successful heartbeat timestamp" — used by watchdog */
const LAST_HEARTBEAT_AT_KEY = "neelgund:last_heartbeat_at";

// ─── Today point count ────────────────────────────────────────────────────────

async function getTodayPointCount(userId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(`${POINTS_TODAY_KEY}:${userId}`);
    if (!raw) return 0;
    const { date, count } = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    return date === today ? (count as number) : 0;
  } catch { return 0; }
}

async function incrementTodayPointCount(userId: string): Promise<number> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await AsyncStorage.getItem(`${POINTS_TODAY_KEY}:${userId}`);
    let count = 0;
    if (raw) {
      const parsed = JSON.parse(raw);
      count = parsed.date === today ? (parsed.count as number) : 0;
    }
    count += 1;
    await AsyncStorage.setItem(`${POINTS_TODAY_KEY}:${userId}`, JSON.stringify({ date: today, count }));
    return count;
  } catch { return 0; }
}

// ─── Stationary state ─────────────────────────────────────────────────────────

type StationaryState = {
  recentPositions: Array<{ lat: number; lng: number }>;
  confirmed: boolean;
  clusterId: number;
};

async function loadStationaryState(): Promise<StationaryState> {
  try {
    const raw = await AsyncStorage.getItem(STATIONARY_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StationaryState;
      if (parsed && typeof parsed.clusterId === "number") return parsed;
    }
  } catch { /* ignore */ }
  return { recentPositions: [], confirmed: false, clusterId: 0 };
}

async function saveStationaryState(s: StationaryState): Promise<void> {
  try {
    await AsyncStorage.setItem(STATIONARY_STATE_KEY, JSON.stringify(s));
  } catch { /* best effort */ }
}

// ─── Classify stationary state ────────────────────────────────────────────────

type ClassifyResult = {
  movementState:     MovementState;
  stationaryCluster: number;
  minDistM:          number;
  newState:          StationaryState;
};

function classifyWithStationaryFilter(
  lat: number,
  lng: number,
  speedKmh: number,
  state: StationaryState,
  lastPoint?: { latitude: number; longitude: number; recordedAt: string } | null,
): ClassifyResult {
  const { recentPositions, confirmed, clusterId } = state;

  let effectiveSpeedKmh = speedKmh;
  if (lastPoint && speedKmh < MOVING_SPEED_KMH) {
    const displacement = haversineMeters(
      { lat, lng },
      { lat: lastPoint.latitude, lng: lastPoint.longitude },
    );
    const timeDiffMs = Date.now() - new Date(lastPoint.recordedAt).getTime();
    const timeDiffHours = timeDiffMs / 3_600_000;
    if (displacement >= DISPLACEMENT_MOVING_OVERRIDE_M && timeDiffHours > 0) {
      effectiveSpeedKmh = Math.min(displacement / 1000 / timeDiffHours, MAX_SPEED_KMH);
    }
  }

  if (lastPoint) {
    const immediateDisplacement = haversineMeters(
      { lat, lng },
      { lat: lastPoint.latitude, lng: lastPoint.longitude },
    );
    if (immediateDisplacement >= STATIONARY_RADIUS_M) {
      const ms: MovementState = effectiveSpeedKmh >= MOVING_SPEED_KMH ? "moving" : "walking";
      return {
        movementState: ms,
        stationaryCluster: clusterId,
        minDistM: ms === "moving" ? MIN_DIST_MOVING_M : MIN_DIST_WALKING_M,
        newState: { recentPositions: [{ lat, lng }], confirmed: false, clusterId },
      };
    }
  }

  const window = [...recentPositions, { lat, lng }].slice(-STATIONARY_CONFIRM_POINTS);
  const centroid = {
    lat: window.reduce((s, p) => s + p.lat, 0) / window.length,
    lng: window.reduce((s, p) => s + p.lng, 0) / window.length,
  };
  const allClose = window.every(
    (p) => haversineMeters(p, centroid) <= STATIONARY_RADIUS_M,
  );
  const isSlowEnough = effectiveSpeedKmh < WALKING_SPEED_KMH;

  if (window.length < STATIONARY_CONFIRM_POINTS) {
    const ms: MovementState = effectiveSpeedKmh >= MOVING_SPEED_KMH ? "moving"
      : effectiveSpeedKmh >= WALKING_SPEED_KMH ? "walking"
      : "stationary";
    return {
      movementState: ms,
      stationaryCluster: clusterId,
      minDistM: ms === "stationary" ? MIN_DIST_STATIONARY_M
        : ms === "walking" ? MIN_DIST_WALKING_M
        : MIN_DIST_MOVING_M,
      newState: { recentPositions: window, confirmed: false, clusterId },
    };
  }

  if (allClose && isSlowEnough) {
    const newClusterId = confirmed ? clusterId : clusterId + 1;
    return {
      movementState: "stationary",
      stationaryCluster: newClusterId,
      minDistM: MIN_DIST_STATIONARY_M,
      newState: { recentPositions: window, confirmed: true, clusterId: newClusterId },
    };
  }

  const ms: MovementState = effectiveSpeedKmh >= MOVING_SPEED_KMH ? "moving" : "walking";
  return {
    movementState: ms,
    stationaryCluster: clusterId,
    minDistM: ms === "moving" ? MIN_DIST_MOVING_M : MIN_DIST_WALKING_M,
    newState: { recentPositions: window, confirmed: false, clusterId },
  };
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

function queueKeyFor(userId: string): string {
  return `${TRACKING_QUEUE_PREFIX}${userId}`;
}

async function loadQueue(userId: string): Promise<QueuedPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKeyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedPoint =>
        typeof (item as { ownerId?: unknown })?.ownerId === "string" &&
        typeof (item as { latitude?: unknown })?.latitude === "number" &&
        typeof (item as { longitude?: unknown })?.longitude === "number" &&
        typeof (item as { recordedAt?: unknown })?.recordedAt === "string",
    );
  } catch {
    return [];
  }
}

async function saveQueue(userId: string, queue: QueuedPoint[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      queueKeyFor(userId),
      JSON.stringify(queue.slice(-TRACKING_QUEUE_MAX)),
    );
  } catch { /* best effort */ }
}

async function enqueuePoint(point: QueuedPoint): Promise<void> {
  const queue = await loadQueue(point.ownerId);
  const alreadyQueued = queue.some((q) => q.recordedAt === point.recordedAt);
  if (alreadyQueued) return;
  queue.push(point);
  await saveQueue(point.ownerId, queue);
}

// ─── Enqueue + immediate flush ────────────────────────────────────────────────

async function enqueueAndFlush(point: QueuedPoint): Promise<void> {
  await enqueuePoint(point);
  try {
    await flushBatch(point.ownerId);
    // Piggyback heartbeat throttled to FLUSH_HEARTBEAT_THROTTLE_MS
    const HB_KEY = `neelgund:flush_heartbeat:${point.ownerId}`;
    const lastRaw = await AsyncStorage.getItem(HB_KEY).catch(() => null);
    const lastMs = lastRaw ? parseInt(lastRaw, 10) : 0;
    if (Date.now() - lastMs >= FLUSH_HEARTBEAT_THROTTLE_MS) {
      await sendHeartbeatRest({ trackerState: "running", platform: Platform.OS });
      await AsyncStorage.setItem(HB_KEY, String(Date.now()));
      await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));
    }
    // Record last successful upload time for watchdog
    await AsyncStorage.setItem(LAST_UPLOAD_AT_KEY, String(Date.now()));
  } catch (err) {
    // Keep in queue — will be retried
    void logDiagnostic("upload_failure", `enqueueAndFlush error: ${String(err)}`);
  }
}

// ─── Auth helper (background, token only) ────────────────────────────────────

async function getActiveUserIdFromToken(): Promise<string | null> {
  try {
    const token = await getPersistedAuthToken();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { sub?: string; exp?: number };
    const GRACE_MS = 5 * 60 * 1000;
    if (payload.exp && payload.exp * 1000 + GRACE_MS < Date.now()) return null;
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ─── Native wakelock helpers ──────────────────────────────────────────────────

function acquireNativeWakeLock(): void {
  if (Platform.OS !== "android") return;
  try { NativeModules.WakeLockModule?.acquire?.(); } catch { /* non-critical */ }
}

function releaseNativeWakeLock(): void {
  if (Platform.OS !== "android") return;
  try { NativeModules.WakeLockModule?.release?.(); } catch { /* non-critical */ }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function buildNotificationBody(pointsToday: number, batteryPct: number, speedKmh: number, movementState?: string): string {
  const speedStr = (movementState === "stationary" || speedKmh < 1)
    ? "Stationary"
    : `${speedKmh.toFixed(0)} km/h`;
  return `${pointsToday} pts today · ${batteryPct}% · ${speedStr}`;
}

function updateTrackingNotification(pointsToday: number, batteryPct: number, speedKmh: number, movementState?: string): void {
  try {
    if (Platform.OS !== "android") return;
    const wl = NativeModules.WakeLockModule;
    if (wl?.updateStatus) {
      wl.updateStatus(
        "Neelgund tracking active",
        buildNotificationBody(pointsToday, batteryPct, speedKmh, movementState),
      );
    }
  } catch { /* non-critical */ }
}

// ─── Flush helpers ────────────────────────────────────────────────────────────

async function flushBatch(userId: string): Promise<void> {
  const queue = await loadQueue(userId);
  if (queue.length === 0) return;

  const activeId = await getActiveUserIdFromToken();
  if (!activeId || activeId !== userId) return;

  const seen = new Set<string>();
  const deduped = queue.filter((p) => {
    if (p.ownerId !== userId) return false;
    const key = p.recordedAt;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length === 0) {
    await saveQueue(userId, []);
    return;
  }

  const flushedTimestamps = new Set(deduped.map((p) => p.recordedAt));
  const points = deduped.map((p) => ({
    latitude:            p.latitude,
    longitude:           p.longitude,
    accuracy:            p.accuracy,
    speedKmh:            p.speedKmh,
    heading:             p.heading,
    altitude:            p.altitude,
    batteryLevel:        p.batteryLevel,
    activityType:        p.activityType,
    movementState:       p.movementState,
    stationaryCluster:   p.stationaryCluster,
    source:              p.source,
    recordedAt:          p.recordedAt,
  }));

  try {
    await trackLocationBatch(points);
    const remaining = await loadQueue(userId);
    await saveQueue(
      userId,
      remaining.filter((p) => !flushedTimestamps.has(p.recordedAt)),
    );
    await AsyncStorage.setItem(LAST_UPLOAD_AT_KEY, String(Date.now()));
  } catch (e) {
    void logDiagnostic("upload_failure", `flushBatch error: ${String(e)}`);
  }
}

// ─── Distance helper ──────────────────────────────────────────────────────────

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ─── Core point processor ─────────────────────────────────────────────────────

async function processLocation(
  ownerId:      string,
  loc:          Location.LocationObject,
  batteryLevel: number,
  lastPoint:    QueuedPoint | null,
): Promise<QueuedPoint | null> {
  const lat      = loc.coords.latitude;
  const lng      = loc.coords.longitude;
  const accuracy = loc.coords.accuracy ?? undefined;
  const speedMs  = loc.coords.speed;
  const speedKmh = speedMs != null && !isNaN(speedMs) ? speedMs * 3.6 : 0;
  const heading  = loc.coords.heading ?? undefined;
  const altitude = loc.coords.altitude ?? undefined;

  if (accuracy !== undefined && accuracy > MAX_ACCURACY_METERS) return null;
  if (speedKmh > MAX_SPEED_KMH) return null;

  const stationaryState = await loadStationaryState();
  const { movementState, stationaryCluster, minDistM, newState } =
    classifyWithStationaryFilter(lat, lng, speedKmh, stationaryState, lastPoint);

  if (lastPoint) {
    const dist = haversineMeters(
      { lat: lastPoint.latitude, lng: lastPoint.longitude },
      { lat, lng },
    );
    if (dist < minDistM) {
      await saveStationaryState(newState);
      return null;
    }
  }

  await saveStationaryState(newState);

  const activityType: ActivityType =
    speedKmh > 15 ? "driving"
    : speedKmh > WALKING_SPEED_KMH ? "walking"
    : "stationary";

  const eligibleForSnapping =
    movementState === "moving" &&
    accuracy !== undefined &&
    accuracy < 30;

  void logDiagnostic("location_received", `GPS fix lat=${lat.toFixed(5)} lng=${lng.toFixed(5)} acc=${accuracy?.toFixed(0)}m spd=${speedKmh.toFixed(1)}kmh`, {
    lat, lng, accuracy, speedKmh, movementState,
  }, ownerId);

  return {
    ownerId,
    latitude:            lat,
    longitude:           lng,
    accuracy,
    speedKmh,
    heading,
    altitude,
    batteryLevel,
    activityType,
    movementState,
    stationaryCluster,
    eligibleForSnapping,
    source: AppState.currentState === "active" ? "foreground" : "background",
    recordedAt: new Date().toISOString(),
  };
}

// ─── Battery helper ───────────────────────────────────────────────────────────

async function getBatteryLevel(): Promise<number> {
  if (Platform.OS === "web") return 100;
  try {
    const level: unknown = await Battery.getBatteryLevelAsync();
    if (typeof level === "number" && isFinite(level) && level >= 0 && level <= 1) {
      return Math.round(level * 100);
    }
    return 100;
  } catch {
    return 100;
  }
}

// ─── Battery optimization ─────────────────────────────────────────────────────

const BATTERY_OPT_ASKED_KEY  = "neelgund:battery_opt_asked:v1";
const WATCHDOG_NOTIF_ID_KEY  = "neelgund:watchdog_notif_id:v1";
const WATCHDOG_NOTIF_DELAY_S = 25 * 60;

// Watchdog notifications are handled natively by TrackingAlarmReceiver.
// These JS-side stubs are kept so call sites compile without changes.
async function rescheduleWatchdogNotification(): Promise<void> { /* handled natively */ }
async function cancelWatchdogNotification(): Promise<void> { /* handled natively */ }

async function requestIgnoreBatteryOptimizationsIfNeeded(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const isOptimized = await Battery.isBatteryOptimizationEnabledAsync();
    void logDiagnostic("battery_optimization_state", `Battery optimized=${isOptimized}`, { isOptimized });

    if (!isOptimized) {
      // Already whitelisted — remove the asked flag so we re-ask if it changes
      await AsyncStorage.removeItem(BATTERY_OPT_ASKED_KEY);
      return;
    }

    // Check how recently we last asked — re-ask every 30 minutes while optimized
    // (much more aggressive than before — this is critical for reliability)
    const lastAskedRaw = await AsyncStorage.getItem(BATTERY_OPT_ASKED_KEY);
    if (lastAskedRaw) {
      const lastAskedMs = parseInt(lastAskedRaw, 10);
      const thirtyMinMs = 30 * 60 * 1000;
      if (Date.now() - lastAskedMs < thirtyMinMs) return;
    }
    await AsyncStorage.setItem(BATTERY_OPT_ASKED_KEY, String(Date.now()));

    // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS shows a direct system dialog
    // saying "Allow app to always run in background?" — much clearer than
    // navigating to settings and asking the user to find the toggle themselves.
    const pkg = "com.neelgund.employeemonitor.iamjeevanhhh";
    try {
      await Linking.openURL(`android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS?package=${pkg}`);
      return;
    } catch { /* some OEMs block this intent, fall through */ }

    // Fallback: open app battery settings page directly
    try {
      await Linking.openURL(`android.settings.APPLICATION_DETAILS_SETTINGS?package=${pkg}`);
    } catch { /* non-critical */ }
  } catch { /* non-critical */ }
}

// ─── Stop / start helpers ─────────────────────────────────────────────────────

async function stopTrackingTaskIfRunning(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch { /* ignore */ }
  releaseNativeWakeLock();
}

export async function wipeAllTrackingQueues(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => k.startsWith(TRACKING_QUEUE_PREFIX));
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
    await AsyncStorage.removeItem(STATIONARY_STATE_KEY);
  } catch { /* best effort */ }
}

async function wipeOtherTrackingQueues(currentUserId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      (k) => k.startsWith(TRACKING_QUEUE_PREFIX) && k !== queueKeyFor(currentUserId),
    );
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch { /* best effort */ }
}

function getTrackingInterval(
  speedKmh: number,
  movementState: MovementState,
  batteryLevel: number,
): { intervalMs: number; distanceM: number } {
  const cfg =
    movementState === "stationary"  ? TRACKING_CONFIG.stationary
    : movementState === "moving"    ? TRACKING_CONFIG.movingFast
    : speedKmh > 20                 ? TRACKING_CONFIG.movingFast
    : speedKmh > MOVING_SPEED_KMH  ? TRACKING_CONFIG.movingSlow
    : TRACKING_CONFIG.walking;

  let intervalMs = cfg.intervalMs;
  if (batteryLevel < BATTERY_CRITICAL) intervalMs *= 4;
  else if (batteryLevel < BATTERY_LOW) intervalMs *= 2;

  // Hard cap: never wait more than 30 s between fixes
  if (intervalMs > 30_000) intervalMs = 30_000;

  return { intervalMs, distanceM: cfg.distanceM };
}

function buildLocationTaskOptions(
  intervalMs: number,
  distanceM: number,
  batteryLevel: number,
  notificationBody: string,
): Parameters<typeof Location.startLocationUpdatesAsync>[1] {
  return {
    accuracy: batteryLevel < BATTERY_CRITICAL
      ? Location.Accuracy.Balanced
      : Location.Accuracy.High,
    timeInterval: intervalMs,
    distanceInterval: distanceM,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    stopOnTerminate: false,
    startOnBoot: true,
    foregroundService: {
      notificationTitle: "📍 Neelgund tracking active",
      notificationBody,
      notificationColor: "#1E4E8A",
      notificationChannelId: "location-tracking",
      killServiceOnDestroy: false,
    },
  };
}

// ─── Full recovery restart ────────────────────────────────────────────────────
/**
 * Hard restart: stop everything, reconnect Supabase, restart location task,
 * re-acquire wakelock, re-register BG fetch. Called by watchdog on stale state.
 */
async function performFullRecovery(userId: string, reason: string): Promise<void> {
  void logDiagnostic("watchdog_restart", `Full recovery triggered: ${reason}`, { reason }, userId);
  console.warn(`[Watchdog] Full recovery: ${reason}`);

  try {
    // 1. Stop any lingering task
    await stopTrackingTaskIfRunning();

    // 2. Reconnect Supabase realtime
    try {
      await supabase.realtime.disconnect();
      await supabase.realtime.connect();
    } catch { /* ignore */ }

    // 3. Attempt session refresh
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        void logDiagnostic("session_refresh_failure", error.message, {}, userId);
      } else if (data.session) {
        void logDiagnostic("session_refresh_success", "Session refreshed in recovery", {}, userId);
      }
    } catch { /* ignore */ }

    // 4. Restart location task
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    if (fg.status === "granted" && bg.status === "granted") {
      const battery = await getBatteryLevel();
      const stState = await loadStationaryState();
      const ms: MovementState = stState.confirmed ? "stationary" : "moving";
      const { intervalMs, distanceM } = getTrackingInterval(0, ms, battery);
      await Location.startLocationUpdatesAsync(
        LOCATION_TASK_NAME,
        buildLocationTaskOptions(intervalMs, distanceM, battery, "Tracking active (recovered)"),
      );
      void logDiagnostic("service_restart", "Location task restarted by watchdog", {}, userId);
    }

    // 5. Re-acquire wakelock
    acquireNativeWakeLock();

    // 6. Re-register BG fetch
    await ensureBackgroundFetchRegistered();
    void logDiagnostic("task_registration", "BG fetch re-registered by watchdog", {}, userId);

    // 7. Send heartbeat to signal recovery
    await sendHeartbeatRest({ trackerState: "running", platform: Platform.OS });
    await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));

    // 8. Flush any queued points
    await flushBatch(userId);
  } catch (e) {
    console.error("[Watchdog] Recovery error:", e);
    void logDiagnostic("watchdog_restart", `Recovery failed: ${String(e)}`, { error: String(e) }, userId);
  }
}

// ─── Background task definitions ─────────────────────────────────────────────

if (Platform.OS !== "web") {
  if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
    TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
      try {
        if (error) {
          void logDiagnostic("upload_failure", `BG location task error: ${String(error)}`);
          return;
        }
        const ownerId = await getActiveUserIdFromToken();
        if (!ownerId) {
          void logDiagnostic("auth_null_skipped", "BG task: no user ID from token");
          return;
        }

        const rawLocations =
          (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
        if (rawLocations.length === 0) return;

        const locations = [...rawLocations].sort((a, b) => a.timestamp - b.timestamp);
        const bgBattery = await getBatteryLevel();
        let lastPoint = (await loadQueue(ownerId)).slice(-1)[0] ?? null;
        let latestRawSpeedKmh = 0;

        for (const loc of locations) {
          if (lastPoint) {
            const lastMs = new Date(lastPoint.recordedAt).getTime();
            if (loc.timestamp <= lastMs) continue;
          }
          const rawSpeedMs = loc.coords.speed;
          if (rawSpeedMs != null && rawSpeedMs >= 0 && isFinite(rawSpeedMs)) {
            latestRawSpeedKmh = rawSpeedMs * 3.6;
          }
          const point = await processLocation(ownerId, loc, bgBattery, lastPoint);
          if (point) {
            await enqueueAndFlush(point);
            lastPoint = point;
            await incrementTodayPointCount(ownerId);
          }
        }

        try {
          const freshBattery = await getBatteryLevel();
          const pointsToday = await getTodayPointCount(ownerId);
          updateTrackingNotification(pointsToday, freshBattery, latestRawSpeedKmh);
        } catch { /* non-critical */ }

        await flushBatch(ownerId);
        void rescheduleWatchdogNotification();

        // BG explicit heartbeat throttled to BG_HEARTBEAT_THROTTLE_MS (30s)
        try {
          const HB_KEY = `neelgund:last_bg_heartbeat:${ownerId}`;
          const lastHbRaw = await AsyncStorage.getItem(HB_KEY);
          const lastHbMs = lastHbRaw ? parseInt(lastHbRaw, 10) : 0;
          if (Date.now() - lastHbMs >= BG_HEARTBEAT_THROTTLE_MS) {
            await sendHeartbeatRest({ trackerState: "running", platform: Platform.OS });
            await AsyncStorage.setItem(HB_KEY, String(Date.now()));
            await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));
          }
        } catch { /* heartbeat failure is non-critical */ }
      } catch (outerErr) {
        void logDiagnostic("upload_failure", `BG location task unhandled error: ${String(outerErr)}`);
      }
    });
  }

  if (!TaskManager.isTaskDefined(HEARTBEAT_TASK_NAME)) {
    TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
      try {
        const ownerId = await getActiveUserIdFromToken();
        if (!ownerId) return BackgroundFetch.BackgroundFetchResult.NoData;

        const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        await sendHeartbeatRest({ trackerState: isRunning ? "running" : "stopped", platform: Platform.OS });
        await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));
        await flushBatch(ownerId);
        if (isRunning) acquireNativeWakeLock();

        // Watchdog: if task not running, restart it
        if (!isRunning) {
          void logDiagnostic("task_loss_detected", "HEARTBEAT_TASK: location task not running — triggering recovery", {}, ownerId);
          await performFullRecovery(ownerId, "heartbeat task detected location task not running");
        }

        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }

  if (!TaskManager.isTaskDefined(BG_FETCH_TASK_NAME)) {
    TaskManager.defineTask(BG_FETCH_TASK_NAME, async () => {
      try {
        const ownerId = await getActiveUserIdFromToken();
        if (!ownerId) return BackgroundFetch.BackgroundFetchResult.NoData;

        const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

        if (!isRunning) {
          void logDiagnostic("task_loss_detected", "BG_FETCH: location task not running — performing full recovery", {}, ownerId);
          await performFullRecovery(ownerId, "BG_FETCH watchdog: task not running");
        } else {
          acquireNativeWakeLock();
          // Check staleness
          const lastUploadRaw = await AsyncStorage.getItem(LAST_UPLOAD_AT_KEY);
          const lastHbRaw     = await AsyncStorage.getItem(LAST_HEARTBEAT_AT_KEY);
          const lastUpload = lastUploadRaw ? parseInt(lastUploadRaw, 10) : 0;
          const lastHb     = lastHbRaw    ? parseInt(lastHbRaw, 10)     : 0;
          const mostRecent = Math.max(lastUpload, lastHb);
          if (mostRecent > 0 && Date.now() - mostRecent > STALE_TRACKING_THRESHOLD_MS) {
            void logDiagnostic("task_loss_detected", `BG_FETCH: stale for ${Math.round((Date.now() - mostRecent) / 1000)}s — recovery`, { staleMs: Date.now() - mostRecent }, ownerId);
            await performFullRecovery(ownerId, `BG_FETCH watchdog: stale ${Math.round((Date.now() - mostRecent) / 1000)}s`);
          }
        }

        await flushBatch(ownerId);
        await sendHeartbeatRest({ trackerState: "running", platform: Platform.OS });
        await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }
}

// ─── Register BackgroundFetch — 2-minute interval ────────────────────────────

async function ensureBackgroundFetchRegistered(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const status = await BackgroundFetch.getStatusAsync();
    const available =
      status === BackgroundFetch.BackgroundFetchStatus.Available ||
      status === BackgroundFetch.BackgroundFetchStatus.Restricted;
    if (!available) return;

    // 2 minutes — aggressive. OS may deliver at 15-min minimum on stock Android
    // but OEM job schedulers (MIUI, One UI) often honour shorter intervals when
    // the app is whitelisted from battery optimization.
    const INTERVAL_S = 2 * 60;

    try {
      await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK_NAME, {
        minimumInterval: INTERVAL_S,
        stopOnTerminate: false,
        startOnBoot: true,
      });
      void logDiagnostic("task_registration", `BG_FETCH registered interval=${INTERVAL_S}s`);
    } catch (e: any) {
      if (!String(e?.message ?? e).includes("already")) {
        console.warn("[BGFetch] BG_FETCH registration error:", e);
      }
    }

    try {
      await BackgroundFetch.registerTaskAsync(HEARTBEAT_TASK_NAME, {
        minimumInterval: INTERVAL_S,
        stopOnTerminate: false,
        startOnBoot: true,
      });
      void logDiagnostic("task_registration", `HEARTBEAT registered interval=${INTERVAL_S}s`);
    } catch (e: any) {
      if (!String(e?.message ?? e).includes("already")) {
        console.warn("[BGFetch] HEARTBEAT registration error:", e);
      }
    }
  } catch (err) {
    console.warn("[BGFetch] ensureBackgroundFetchRegistered failed:", err);
  }
}

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const { Notifications } = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync("location-tracking", {
      name: "Location Tracking",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
      enableLights: false,
      enableVibrate: false,
      showBadge: false,
      description: "Keeps location tracking active in the background",
    });
  } catch { /* non-critical */ }
}

void ensureBackgroundFetchRegistered();
void ensureNotificationChannel();

// ─── Permission flag ──────────────────────────────────────────────────────────
let backgroundPermissionRequested = false;

// ─── React hook ───────────────────────────────────────────────────────────────

export function useLocationTracker(userId: string | null, trackingEnabled = true) {
  const { user } = useAuth();
  const syncInFlightRef  = useRef(false);
  const batteryCacheRef  = useRef<{ value: number; readAt: number } | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef     = useRef<QueuedPoint | null>(null);
  const movementStateRef = useRef<MovementState>("stationary");
  const pointsTodayRef   = useRef(0);
  const prevUserIdRef    = useRef<string | null>(null);

  if (prevUserIdRef.current !== userId) {
    prevUserIdRef.current    = userId;
    lastPointRef.current     = null;
    movementStateRef.current = "stationary";
    pointsTodayRef.current   = 0;
    void AsyncStorage.removeItem(STATIONARY_STATE_KEY);
  }

  useEffect(() => {
    if (Platform.OS === "web") return;

    void ensureBackgroundFetchRegistered();

    const syncTracking = async (forceRestart = false) => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

        if (!userId) {
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          releaseNativeWakeLock();
          await wipeAllTrackingQueues();
          try { await sendHeartbeatRest({ trackerState: "stopped", platform: Platform.OS }); } catch { /* swallow */ }
          return;
        }

        // Check-in gate: if employee hasn't checked in (or has checked out), stop tracking.
        if (!trackingEnabled) {
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          releaseNativeWakeLock();
          try { await sendHeartbeatRest({ trackerState: "stopped", platform: Platform.OS }); } catch { /* swallow */ }
          return;
        }

        // Write userId to native bridge so NativeTrackingService can read it
        void persistUserId(userId);

        await wipeOtherTrackingQueues(userId);
        void requestIgnoreBatteryOptimizationsIfNeeded();

        const foreground = await Location.getForegroundPermissionsAsync();
        if (foreground.status !== "granted") {
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          try { await sendHeartbeatRest({ trackerState: "stopped", platform: Platform.OS }); } catch { /* swallow */ }
          return;
        }

        const background = await Location.getBackgroundPermissionsAsync();
        if (background.status !== "granted") {
          if (!backgroundPermissionRequested) {
            backgroundPermissionRequested = true;
            const requested = await Location.requestBackgroundPermissionsAsync();
            if (requested.status !== "granted") {
              if (alreadyRunning) await stopTrackingTaskIfRunning();
              try { await sendHeartbeatRest({ trackerState: "stopped", platform: Platform.OS }); } catch { /* swallow */ }
              return;
            }
          } else {
            if (alreadyRunning) await stopTrackingTaskIfRunning();
            try { await sendHeartbeatRest({ trackerState: "stopped", platform: Platform.OS }); } catch { /* swallow */ }
            return;
          }
        }

        const now = Date.now();
        const cached = batteryCacheRef.current;
        const batteryLevel =
          cached && now - cached.readAt < 60_000
            ? cached.value
            : await getBatteryLevel();
        batteryCacheRef.current = { value: batteryLevel, readAt: now };

        const lastSpeed = lastPointRef.current?.speedKmh ?? 0;
        const ms        = movementStateRef.current;
        const { intervalMs, distanceM } = getTrackingInterval(lastSpeed, ms, batteryLevel);

        if (alreadyRunning && forceRestart) {
          await stopTrackingTaskIfRunning();
        }

        const taskDefined = TaskManager.isTaskDefined(LOCATION_TASK_NAME);
        const runningNow  = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

        if (!runningNow && taskDefined) {
          await Location.startLocationUpdatesAsync(
            LOCATION_TASK_NAME,
            buildLocationTaskOptions(intervalMs, distanceM, batteryLevel, "Tracking active"),
          );
          acquireNativeWakeLock();
          void logDiagnostic("service_restart", "Location task started from syncTracking", { forceRestart }, userId);
        } else if (runningNow) {
          acquireNativeWakeLock();
        }

        {
          const pointsToday = await getTodayPointCount(userId ?? "");
          updateTrackingNotification(pointsToday, batteryLevel, lastSpeed, ms);
        }

        const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        try {
          await sendHeartbeatRest({ trackerState: running ? "running" : "stopped", platform: Platform.OS });
          await AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now()));
        } catch { /* swallow */ }

        void ensureNotificationChannel();

        // Immediate foreground fix
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: batteryLevel < BATTERY_CRITICAL
              ? Location.Accuracy.Balanced
              : Location.Accuracy.High,
          });
          const point = await processLocation(userId, loc, batteryLevel, lastPointRef.current);
          if (point) {
            await enqueueAndFlush(point);
            lastPointRef.current = point;
            movementStateRef.current = point.movementState;
            pointsTodayRef.current++;
            void incrementTodayPointCount(userId);
          }
        } catch { /* best-effort */ }
      } catch (err) {
        console.error("[useLocationTracker] sync error:", err);
        void logDiagnostic("watchdog_restart", `syncTracking error: ${String(err)}`);
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const startFlushLoop = () => {
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = setInterval(() => {
        if (userId) void flushBatch(userId);
      }, BATCH_FLUSH_INTERVAL_MS);
    };

    const stopFlushLoop = () => {
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = null;
      }
    };

    void syncTracking(false);
    startFlushLoop();

    const appStateSub = AppState.addEventListener("change", async (state) => {
      if (!userId) return;
      if (state === "active") {
        const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
        if (alreadyRunning) {
          void flushBatch(userId);
          void sendHeartbeatRest({ trackerState: "running", platform: Platform.OS })
            .then(() => AsyncStorage.setItem(LAST_HEARTBEAT_AT_KEY, String(Date.now())))
            .catch(() => {});
          void cancelWatchdogNotification();
          void requestIgnoreBatteryOptimizationsIfNeeded();
          acquireNativeWakeLock();
          startFlushLoop();
        } else {
          void syncTracking(true);
          startFlushLoop();
        }
      } else if (state === "background") {
        if (userId) void flushBatch(userId);
      }
    });

    // ── Aggressive watchdog: runs every 30 s ──────────────────────────────────
    const watchdog = setInterval(async () => {
      if (!userId || !trackingEnabled) return;

      // Always flush queued points
      void flushBatch(userId);

      if (AppState.currentState !== "active") return;

      // Check if tracking task is alive
      const taskRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (!taskRunning) {
        void logDiagnostic("task_loss_detected", "Watchdog: task not running in foreground — recovering", {}, userId);
        await performFullRecovery(userId, "watchdog: foreground task missing");
        return;
      }

      // Check staleness — if no upload or heartbeat for 2 min, force restart
      const lastUploadRaw = await AsyncStorage.getItem(LAST_UPLOAD_AT_KEY);
      const lastHbRaw     = await AsyncStorage.getItem(LAST_HEARTBEAT_AT_KEY);
      const lastUpload = lastUploadRaw ? parseInt(lastUploadRaw, 10) : 0;
      const lastHb     = lastHbRaw    ? parseInt(lastHbRaw, 10)     : 0;
      const mostRecent = Math.max(lastUpload, lastHb);
      if (mostRecent > 0 && Date.now() - mostRecent > STALE_TRACKING_THRESHOLD_MS) {
        void logDiagnostic("task_loss_detected", `Watchdog: stale ${Math.round((Date.now() - mostRecent) / 1000)}s`, { staleMs: Date.now() - mostRecent }, userId);
        await performFullRecovery(userId, `watchdog: stale ${Math.round((Date.now() - mostRecent) / 1000)}s`);
        return;
      }

      // Re-acquire wakelock proactively
      acquireNativeWakeLock();

      // Regular sync
      void syncTracking();
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      appStateSub.remove();
      clearInterval(watchdog);
      stopFlushLoop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, user?.role, trackingEnabled]);
}