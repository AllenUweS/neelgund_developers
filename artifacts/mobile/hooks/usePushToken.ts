/**
 * usePushToken.ts
 *
 * Registers the device's Expo push token with Supabase on login so the
 * Edge Function can send FCM-backed Expo pushes when tracking goes silent.
 *
 * Call this hook once in RootLayoutNav (alongside useLocationTracker).
 * It is safe to call on web (no-ops).
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { supabase } from "@/lib/supabase";

// Configure foreground notification behaviour once at module load
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert:  true,
      shouldPlaySound:  false,
      shouldSetBadge:   false,
      shouldShowBanner: true,
      shouldShowList:   true,
    }),
  });
}

export function usePushToken(userId: string | null) {
  const registeredForRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!userId) return;
    if (registeredForRef.current === userId) return; // already done this session

    void (async () => {
      try {
        // Physical device required for push tokens
        if (!Device.isDevice) return;

        // Request permission
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        // Android notification channel for incoming alerts
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("tracking-alerts", {
            name: "Tracking Alerts",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 300, 100, 300],
            enableVibrate: true,
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: false,
            showBadge: true,
          });
        }

        // Get Expo push token (works with Expo Go + bare workflow)
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
        });
        const token = tokenData.data;
        if (!token) return;

        // Save to profiles so Edge Function can look it up
        await supabase
          .from("profiles")
          .update({ expo_push_token: token, push_platform: Platform.OS })
          .eq("id", userId);

        registeredForRef.current = userId;
        console.log("[usePushToken] Registered:", token);
      } catch (e) {
        console.warn("[usePushToken] Failed:", e);
      }
    })();
  }, [userId]);
}
