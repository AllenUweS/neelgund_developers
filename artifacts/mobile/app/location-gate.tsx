import React, { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  AppState,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
type IoniconsName = ComponentProps<typeof Ionicons>["name"];
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";

const C = Colors.light;
const BATTERY_OPT_SHOWN_KEY = "neelgund:battery_opt_shown";

export default function LocationGateScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<"idle" | "checking" | "denied" | "background-denied">("idle");
  const [showBatteryOpt, setShowBatteryOpt] = useState(false);

  const checkPermission = useCallback(async () => {
    setStatus("checking");
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "permissions" in navigator) {
        try {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          if (perm.state === "granted") {
            router.replace("/(tabs)");
            return;
          }
          if (perm.state === "denied") {
            setStatus("denied");
            return;
          }
        } catch {}
      }
      setStatus("idle");
      return;
    }
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    const { status: background } = await Location.getBackgroundPermissionsAsync();
    if (existing === "granted" && background === "granted") {
      router.replace("/(tabs)");
    } else if (existing === "denied") {
      setStatus("denied");
    } else if (existing === "granted" && background === "denied") {
      setStatus("background-denied");
    } else {
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    checkPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkPermission();
    });
    return () => {
      sub.remove();
    };
  }, [checkPermission]);

  const requestPermission = async () => {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          () => router.replace("/(tabs)"),
          () => setStatus("denied"),
          { timeout: 10000 }
        );
      } else {
        setStatus("denied");
      }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { status: foregroundPerm } = await Location.requestForegroundPermissionsAsync();
    if (foregroundPerm !== "granted") {
      setStatus("denied");
      return;
    }

    const { status: backgroundPerm } = await Location.requestBackgroundPermissionsAsync();
    if (backgroundPerm !== "granted") {
      setStatus(backgroundPerm === "denied" ? "background-denied" : "idle");
      return;
    }

    // On Android, show battery optimization screen once
    if (Platform.OS === "android") {
      try {
        const alreadyShown = await AsyncStorage.getItem(BATTERY_OPT_SHOWN_KEY);
        if (!alreadyShown) {
          setShowBatteryOpt(true);
          return;
        }
      } catch {
        // ignore
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  };

  const openBatteryOptimizationSettings = async () => {
    try {
      // Open the app info page where users can find battery settings
      await Linking.openSettings();
    } catch {
      // ignore
    }
    try {
      await AsyncStorage.setItem(BATTERY_OPT_SHOWN_KEY, "true");
    } catch {
      // ignore
    }
    setShowBatteryOpt(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  };

  const skipBatteryOptimization = async () => {
    try {
      await AsyncStorage.setItem(BATTERY_OPT_SHOWN_KEY, "true");
    } catch {
      // ignore
    }
    setShowBatteryOpt(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  };

  const openSettings = () => {
    if (Platform.OS !== "web") {
      Linking.openSettings();
    }
  };

  if (showBatteryOpt) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.content}>
          <View style={[styles.iconWrapper, { backgroundColor: "#FFF3E0" }]}>
            <Ionicons name="battery-charging" size={52} color="#E65100" />
          </View>

          <Text style={styles.title}>Battery Optimization</Text>
          <Text style={styles.subtitle}>
            Android may pause background tracking to save battery. Please whitelist Neelgund so your daily routes are recorded accurately even when the app is closed.
          </Text>

          <View style={styles.featureList}>
            {(
              [
                { icon: "shield-checkmark-outline" as IoniconsName, text: "Prevent Android Doze from killing tracking" },
                { icon: "navigate-outline" as IoniconsName, text: "Keep GPS running in the background" },
                { icon: "time-outline" as IoniconsName, text: "Record complete travel routes" },
              ] as const
            ).map(({ icon, text }) => (
              <View key={text} style={styles.featureRow}>
                <Ionicons name={icon} size={20} color="#E65100" />
                <Text style={styles.featureText}>{text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: "#E65100" }]}
            onPress={openBatteryOptimizationSettings}
            activeOpacity={0.85}
          >
            <Ionicons name="battery-charging" size={20} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Whitelist from Battery Optimization</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: "#E5E7EB", marginTop: 8 }]}
            onPress={skipBatteryOptimization}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { color: C.text }]}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0), paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) }]}>
      <View style={styles.content}>
        <View style={styles.iconWrapper}>
          <Ionicons name="location" size={52} color={C.brand} />
        </View>

        <Text style={styles.title}>Location Required</Text>
        <Text style={styles.subtitle}>
          Neelgund Developers requires Always Allow location access to track field activity, auto-capture lead locations, and record daily travel routes in the background.
        </Text>

        <View style={styles.featureList}>
          {(
            [
              { icon: "navigate-circle-outline" as IoniconsName, text: "Auto-capture lead location" },
              { icon: "map-outline" as IoniconsName, text: "Record daily travel trail" },
              { icon: "people-outline" as IoniconsName, text: "Team location visibility" },
            ] as const
          ).map(({ icon, text }) => (
            <View key={text} style={styles.featureRow}>
              <Ionicons name={icon} size={20} color={C.brand} />
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
        </View>

        {status === "denied" || status === "background-denied" ? (
          <>
            <Text style={styles.deniedText}>
              {status === "background-denied"
                ? "Background location is required. Set Location to Always Allow in Settings to use the app."
                : "Permission was denied. Please enable Location permission as Always Allow in Settings to continue."}
            </Text>
            {Platform.OS !== "web" && (
              <TouchableOpacity style={styles.primaryBtn} onPress={openSettings}>
                <Text style={styles.primaryBtnText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </>
        ) : status === "checking" ? (
          <View style={styles.primaryBtn}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Checking permissions…</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission} activeOpacity={0.85}>
            <Ionicons name="location-outline" size={20} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Allow Location Access</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "center",
    gap: 20,
  },
  iconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: "#EBF3FF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: C.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  featureList: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
  deniedText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.danger,
    textAlign: "center",
    lineHeight: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    height: 54,
    backgroundColor: C.brand,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
