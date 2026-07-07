/**
 * useNativeTrackingLifecycle.ts
 *
 * Single owner of NativeTrackingService lifecycle.
 * Called in TWO places:
 *
 *   _layout.tsx → useNativeTrackingLifecycle(userId, false)
 *     Purpose: warm up permissions on login, stop service on logout.
 *     trackingEnabled=false means service never starts from here.
 *
 *   index.tsx  → useNativeTrackingLifecycle(userId, trackingEnabled)
 *     Purpose: start service on check-in, stop on check-out.
 *     trackingEnabled = isEmployee && hasCheckedIn && !hasCheckedOut
 *
 * WHY TWO INSTANCES:
 *   _layout.tsx is always mounted (handles logout cleanup).
 *   index.tsx has the check-in state (handles start/stop).
 *   Both share the same WakeLockModule bridge so only one service runs.
 *
 * PERMISSION FLOW:
 *   On first login, requests foreground + background location + notifications.
 *   Polls every 3s until granted. Service only starts after both granted.
 *   Battery optimization exemption requested after service starts.
 */

import { useEffect, useRef } from "react";
import { NativeModules, Platform } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as Battery from "expo-battery";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BATTERY_OPT_KEY = "neelgund:battery_opt_asked:v2";

async function hasLocationPermissions(): Promise<boolean> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.status === "granted";
  } catch {
    return false;
  }
}

async function requestAllPermissions(): Promise<boolean> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      const r = await Location.requestForegroundPermissionsAsync();
      if (r.status !== "granted") return false;
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") {
      const r = await Location.requestBackgroundPermissionsAsync();
      if (r.status !== "granted") return false;
    }
    try {
      const n = await Notifications.getPermissionsAsync();
      if (n.status !== "granted") await Notifications.requestPermissionsAsync();
    } catch { /* non-critical */ }
    return true;
  } catch {
    return false;
  }
}

async function requestBatteryOptIfNeeded(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const isOptimized = await Battery.isBatteryOptimizationEnabledAsync();
    if (!isOptimized) return;
    const last = await AsyncStorage.getItem(BATTERY_OPT_KEY);
    if (last && Date.now() - parseInt(last, 10) < 30 * 60 * 1000) return;
    await AsyncStorage.setItem(BATTERY_OPT_KEY, String(Date.now()));
    const pkg = "com.neelgund.employeemonitor.iamjeevanhhh";
    try {
      await Linking.openURL(`android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS?package=${pkg}`);
    } catch {
      try { await Linking.openURL(`android.settings.APPLICATION_DETAILS_SETTINGS?package=${pkg}`); }
      catch { /* non-critical */ }
    }
  } catch { /* non-critical */ }
}

export function useNativeTrackingLifecycle(
  userId: string | null,
  trackingEnabled: boolean,
) {
  const retryRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRef     = useRef<{ userId: string | null; enabled: boolean }>({
    userId: undefined as any,
    enabled: false,
  });

  const clearRetry = () => {
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const prev = prevRef.current;
    prevRef.current = { userId, enabled: trackingEnabled };

    // Nothing changed
    if (prev.userId === userId && prev.enabled === trackingEnabled) return;

    const shouldRun = !!userId && trackingEnabled;
    const wasRunning = !!prev.userId && prev.enabled;

    if (!shouldRun) {
      clearRetry();
      // Stop service only if it was running before
      if (wasRunning || (prev.userId !== undefined && !userId)) {
        try { NativeModules.WakeLockModule?.release?.(); } catch { /* non-critical */ }
      }
      return;
    }

    // Should start — check permissions first
    clearRetry();

    const tryStart = async () => {
      const granted = await hasLocationPermissions();
      if (granted) {
        clearRetry();
        try { NativeModules.WakeLockModule?.acquire?.(); } catch { /* non-critical */ }
        void requestBatteryOptIfNeeded();
      } else {
        await requestAllPermissions();
        if (!retryRef.current) {
          retryRef.current = setInterval(async () => {
            if (await hasLocationPermissions()) {
              clearRetry();
              try { NativeModules.WakeLockModule?.acquire?.(); } catch { /* non-critical */ }
              void requestBatteryOptIfNeeded();
            }
          }, 3_000);
        }
      }
    };

    void tryStart();
    return () => { clearRetry(); };
  }, [userId, trackingEnabled]);
}
