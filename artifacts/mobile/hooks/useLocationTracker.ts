/**
 * useLocationTracker.ts
 *
 * FIXES applied vs original:
 *   1. getBatteryLevel: expo-battery's getBatteryLevelAsync is called through
 *      the module object correctly, but wrapped in an extra try/catch to handle
 *      devices where the Battery API is unavailable (returns undefined instead
 *      of a number on some Android versions). Guard added: if result is not a
 *      finite number in [0, 1], default to 1.0 (100%).
 *   2. Background task: Added explicit check that the TaskManager task is
 *      defined before calling startLocationUpdatesAsync to avoid a rare crash
 *      when the JS bundle reloads mid-session.
 *   3. Permission flow: requestBackgroundPermissionsAsync is now called only
 *      once per app lifecycle (guarded by a module-level flag) to avoid the
 *      "permission dialog shown repeatedly" UX issue on Android 12+.
 *   4. Foreground service notification: pointsTodayRef.current update moved
 *      inside the successful processLocation block so the count is accurate.
 *   5. Added Platform.OS === "web" guard in getBatteryLevel (Battery module
 *      not available on web).
 */

import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getPersistedAuthToken } from "@/utils/tokenStorage";
import { reportTrackingStatus } from "@/lib/api";
import { trackLocationBatch, sendHeartbeatRest } from "@/lib/trackingApi";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "expo-router";

const LOCATION_TASK_NAME = "neelgund-background-location";
const HEARTBEAT_TASK_NAME = "neelgund-heartbeat";
const TRACKING_QUEUE_PREFIX = "neelgund:tracking:queue:v2:";
const TRACKING_QUEUE_MAX = 200;
const BATCH_FLUSH_INTERVAL_MS = 10_000;

// Adaptive tracking config based on speed
const TRACKING_CONFIG = {
  movingFast:  { intervalMs: 1000,  distanceM: 5 },  // >20 km/h
  movingSlow:  { intervalMs: 3000,  distanceM: 5 },  // 5-20 km/h
  walking:     { intervalMs: 5000,  distanceM: 3 },  // <5 km/h
  stationary:  { intervalMs: 30000, distanceM: 10 }, // Not moving
};

const BATTERY_CRITICAL_THRESHOLD = 10;
const BATTERY_LOW_THRESHOLD = 20;
const WATCHDOG_INTERVAL_MS = 60_000;
const MAX_SPEED_KMH = 200;
const MAX_ACCURACY_METERS = 50;
const STATIONARY_THRESHOLD_MS = 5 * 60 * 1000; // 5 min

export type ActivityType = "driving" | "walking" | "stationary" | "unknown";

export type TrackingPoint = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speedKmh?: number;
  heading?: number;
  altitude?: number;
  batteryLevel?: number;
  activityType: ActivityType;
  source: "foreground" | "background";
  recordedAt: string;
};

type QueuedPoint = TrackingPoint & { ownerId: string };

function classifyActivity(speedKmh: number): ActivityType {
  if (speedKmh > 15) return "driving";
  if (speedKmh > 2) return "walking";
  return "stationary";
}

function getTrackingConfig(speedKmh: number, stationaryMs: number) {
  if (stationaryMs >= STATIONARY_THRESHOLD_MS) return TRACKING_CONFIG.stationary;
  if (speedKmh > 20) return TRACKING_CONFIG.movingFast;
  if (speedKmh > 5) return TRACKING_CONFIG.movingSlow;
  return TRACKING_CONFIG.walking;
}

function queueKeyFor(userId: string): string {
  return `${TRACKING_QUEUE_PREFIX}${userId}`;
}

async function getActiveUserIdFromToken(): Promise<string | null> {
  try {
    const token = await getPersistedAuthToken();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
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
    await AsyncStorage.setItem(queueKeyFor(userId), JSON.stringify(queue.slice(-TRACKING_QUEUE_MAX)));
  } catch {
    // best effort
  }
}

async function enqueuePoint(point: QueuedPoint): Promise<void> {
  const queue = await loadQueue(point.ownerId);
  queue.push(point);
  await saveQueue(point.ownerId, queue);
}

async function flushBatch(userId: string): Promise<void> {
  const queue = await loadQueue(userId);
  if (queue.length === 0) return;

  const activeId = await getActiveUserIdFromToken();
  if (!activeId || activeId !== userId) {
    await saveQueue(userId, []);
    return;
  }

  const points = queue
    .filter((p) => p.ownerId === userId)
    .map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy,
      speedKmh: p.speedKmh,
      heading: p.heading,
      altitude: p.altitude,
      batteryLevel: p.batteryLevel,
      activityType: p.activityType,
      source: p.source,
      recordedAt: p.recordedAt,
    }));

  if (points.length === 0) {
    await saveQueue(userId, []);
    return;
  }

  try {
    await trackLocationBatch(points);
    await saveQueue(userId, []);
  } catch {
    // Keep queue for retry
  }
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function processLocation(
  ownerId: string,
  loc: Location.LocationObject,
  batteryLevel: number,
  lastPoint: QueuedPoint | null,
): Promise<QueuedPoint | null> {
  const lat = loc.coords.latitude;
  const lng = loc.coords.longitude;
  const accuracy = loc.coords.accuracy ?? undefined;
  const speedMs = loc.coords.speed;
  const speedKmh = speedMs != null && !isNaN(speedMs) ? speedMs * 3.6 : undefined;
  const heading = loc.coords.heading ?? undefined;
  const altitude = loc.coords.altitude ?? undefined;

  // Validation
  if (accuracy !== undefined && accuracy > MAX_ACCURACY_METERS) return null;
  if (speedKmh !== undefined && speedKmh > MAX_SPEED_KMH) return null;

  // Client dedup: skip if <2m from last point
  if (lastPoint) {
    const dist = haversineMeters(
      { lat: lastPoint.latitude, lng: lastPoint.longitude },
      { lat, lng },
    );
    if (dist < 2) return null;
  }

  const activityType = classifyActivity(speedKmh ?? 0);

  return {
    ownerId,
    latitude: lat,
    longitude: lng,
    accuracy,
    speedKmh,
    heading,
    altitude,
    batteryLevel,
    activityType,
    source: AppState.currentState === "active" ? "foreground" : "background",
    recordedAt: new Date().toISOString(),
  };
}

async function safeReportTrackingStatus(input: {
  permissionState: "granted" | "denied" | "unknown";
  trackerState: "running" | "stopped";
  platform: string;
  lastPingAt?: string | null;
}) {
  try {
    // FIX: Use sendHeartbeatRest (reads persisted token directly) instead of
    // reportTrackingStatus which calls supabase.auth.getUser(). After logout
    // getUser() returns null so reportTrackingStatus always threw silently,
    // meaning the "stopped" write NEVER reached Supabase. That is the root
    // cause of the employee still showing as Live after logging out.
    await sendHeartbeatRest({
      trackerState: input.trackerState,
      platform: input.platform,
    });
  } catch {
    // swallow
  }
}

export async function wipeAllTrackingQueues(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter((k) => k.startsWith(TRACKING_QUEUE_PREFIX));
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {
    // best effort
  }
}

async function wipeOtherTrackingQueues(currentUserId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      (k) => k.startsWith(TRACKING_QUEUE_PREFIX) && k !== queueKeyFor(currentUserId),
    );
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {
    // best effort
  }
}

// Background location task
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) return;
    const ownerId = await getActiveUserIdFromToken();
    if (!ownerId) return;

    const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
    if (locations.length === 0) return;

    let lastPoint = (await loadQueue(ownerId)).slice(-1)[0] ?? null;

    for (const loc of locations) {
      const point = await processLocation(ownerId, loc, 100, lastPoint);
      if (point) {
        await enqueuePoint(point);
        lastPoint = point;
      }
    }

    // Try to flush immediately in background
    await flushBatch(ownerId);
  });
}

// Heartbeat task
if (!TaskManager.isTaskDefined(HEARTBEAT_TASK_NAME)) {
  TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
    try {
      const ownerId = await getActiveUserIdFromToken();
      if (!ownerId) return;
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      await sendHeartbeatRest({
        trackerState: isRunning ? "running" : "stopped",
        platform: Platform.OS,
      });
    } catch {
      // silently fail
    }
  });
}

async function stopTrackingTaskIfRunning(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (running) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch {
    // ignore
  }
}

// FIX #5: Web guard + robust number check
async function getBatteryLevel(): Promise<number> {
  if (Platform.OS === "web") return 100;
  try {
    // FIX #1: Use dynamic require to avoid issues if module isn't linked
    const Battery = require("expo-battery");
    const level: unknown = await Battery.getBatteryLevelAsync();
    // Guard: expo-battery returns undefined on some devices
    if (typeof level === "number" && isFinite(level) && level >= 0 && level <= 1) {
      return Math.round(level * 100);
    }
    return 100;
  } catch {
    return 100;
  }
}

// FIX #3: Module-level flag to avoid requesting background permission more
// than once per app session (Android 12+ shows repeated prompts as suspicious).
let backgroundPermissionRequested = false;

export function useLocationTracker(userId: string | null) {
  const { user } = useAuth();
  const syncInFlightRef = useRef(false);
  const batteryCacheRef = useRef<{ value: number; readAt: number } | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef = useRef<QueuedPoint | null>(null);
  const stationarySinceRef = useRef<number | null>(null);
  const pointsTodayRef = useRef(0);
  const prevUserIdRef = useRef<string | null>(null);
  const pathname = usePathname();

  if (prevUserIdRef.current !== userId) {
    prevUserIdRef.current = userId;
    lastPointRef.current = null;
    stationarySinceRef.current = null;
    pointsTodayRef.current = 0;
  }

  useEffect(() => {
    if (Platform.OS === "web") return;

    const syncTracking = async (forceRestart = false) => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

        if (!userId) {
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          await wipeAllTrackingQueues();
          await safeReportTrackingStatus({
            permissionState: "unknown",
            trackerState: "stopped",
            platform: Platform.OS,
            lastPingAt: null,
          });
          return;
        }

        await wipeOtherTrackingQueues(userId);

        const foreground = await Location.getForegroundPermissionsAsync();
        if (foreground.status !== "granted") {
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          await safeReportTrackingStatus({
            permissionState: "denied",
            trackerState: "stopped",
            platform: Platform.OS,
            lastPingAt: null,
          });
          return;
        }

        // FIX #3: Only request background permission once
        const background = await Location.getBackgroundPermissionsAsync();
        if (background.status !== "granted" && !backgroundPermissionRequested) {
          backgroundPermissionRequested = true;
          const requested = await Location.requestBackgroundPermissionsAsync();
          if (requested.status !== "granted") {
            if (alreadyRunning) await stopTrackingTaskIfRunning();
            await safeReportTrackingStatus({
              permissionState: "denied",
              trackerState: "stopped",
              platform: Platform.OS,
              lastPingAt: null,
            });
            return;
          }
        } else if (background.status !== "granted") {
          // Permission was already requested and denied — don't re-ask
          if (alreadyRunning) await stopTrackingTaskIfRunning();
          await safeReportTrackingStatus({
            permissionState: "denied",
            trackerState: "stopped",
            platform: Platform.OS,
            lastPingAt: null,
          });
          return;
        }

        // Battery check
        const nowForBattery = Date.now();
        const cachedBattery = batteryCacheRef.current;
        const batteryLevel =
          cachedBattery && nowForBattery - cachedBattery.readAt < 5 * 60_000
            ? cachedBattery.value
            : await getBatteryLevel();
        batteryCacheRef.current = { value: batteryLevel, readAt: nowForBattery };

        // Calculate interval based on last known speed + battery
        const lastSpeed = lastPointRef.current?.speedKmh ?? 0;
        const stationaryMs = stationarySinceRef.current
          ? Date.now() - stationarySinceRef.current
          : 0;
        const config = getTrackingConfig(lastSpeed, stationaryMs);

        let intervalMs = config.intervalMs;
        if (batteryLevel < BATTERY_CRITICAL_THRESHOLD) intervalMs *= 4;
        else if (batteryLevel < BATTERY_LOW_THRESHOLD) intervalMs *= 2;

        if (alreadyRunning && forceRestart) {
          await stopTrackingTaskIfRunning();
        }

        // FIX #2: Check task is defined before starting
        const taskDefined = TaskManager.isTaskDefined(LOCATION_TASK_NAME);
        const runningBeforeStart = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!runningBeforeStart && taskDefined) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy:
              batteryLevel < BATTERY_CRITICAL_THRESHOLD
                ? Location.Accuracy.Balanced
                : Location.Accuracy.High,
            timeInterval: intervalMs,
            distanceInterval: config.distanceM,
            deferredUpdatesInterval: intervalMs,
            deferredUpdatesDistance: config.distanceM,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "Neelgund tracking active",
              notificationBody: `${pointsTodayRef.current} points · ${batteryLevel}% battery · ${lastSpeed?.toFixed(0) ?? 0} km/h`,
              notificationColor: "#1E4E8A",
              killServiceOnDestroy: false,
            },
          });
        }

        const runningNow = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        await safeReportTrackingStatus({
          permissionState: "granted",
          trackerState: runningNow ? "running" : "stopped",
          platform: Platform.OS,
          lastPingAt: null,
        });

        // Immediate foreground point
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy:
              batteryLevel < BATTERY_CRITICAL_THRESHOLD
                ? Location.Accuracy.Balanced
                : Location.Accuracy.High,
          });
          const point = await processLocation(userId, loc, batteryLevel, lastPointRef.current);
          if (point) {
            await enqueuePoint(point);
            lastPointRef.current = point;
            // FIX #4: Increment count only after successful point
            pointsTodayRef.current++;

            // Track stationary state
            if (point.activityType === "stationary") {
              if (!stationarySinceRef.current) stationarySinceRef.current = Date.now();
            } else {
              stationarySinceRef.current = null;
            }
          }
        } catch {
          // ignore — foreground point is best-effort
        }
      } catch (error) {
        console.error("Location tracking error:", error);
      } finally {
        syncInFlightRef.current = false;
      }
    };

    // Flush loop
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

    void syncTracking(true);
    startFlushLoop();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !userId) return;
      void syncTracking();
    });

    const watchdog = setInterval(() => {
      if (AppState.currentState !== "active" || !userId) return;
      void syncTracking();
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      appStateSub.remove();
      clearInterval(watchdog);
      stopFlushLoop();
    };
  }, [userId, user?.role, pathname]);
}