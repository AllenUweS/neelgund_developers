/**
 * location-gate.tsx
 *
 * A forced, unskippable 4-step permission wizard:
 *   Step 1 — Foreground location
 *   Step 2 — Background location ("Always Allow")
 *   Step 3 — Notifications (FORCED — no skip)
 *   Step 4 — Battery optimization exclusion (FORCED — no skip)
 *
 * The user CANNOT proceed past step 3 or 4 without granting.
 * If they deny, we show a red warning and keep them on the screen
 * until they fix it. Battery optimizer has a "check again" button
 * that re-reads the system state before allowing entry.
 *
 * Brand-specific autostart intents are tried after battery opt so
 * Xiaomi/Oppo/Vivo/Huawei users get their hidden "protected apps" page.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router }            from "expo-router";
import { Ionicons }          from "@expo/vector-icons";
import * as Location         from "expo-location";
import * as Notifications    from "expo-notifications";
import * as Haptics          from "expo-haptics";
import * as Battery          from "expo-battery";
import AsyncStorage          from "@react-native-async-storage/async-storage";
import Colors                from "@/constants/colors";

const C       = Colors.light;
const PKG     = "com.neelgund.employeemonitor.iamjeevanhhh";

// ─── Step definitions ─────────────────────────────────────────────────────────

type StepId = "location" | "background" | "notifications" | "battery";

interface Step {
  id:          StepId;
  icon:        string;
  iconColor:   string;
  iconBg:      string;
  title:       string;
  subtitle:    string;
  bullets:     { icon: string; text: string }[];
  btnLabel:    string;
  btnColor:    string;
  forced:      boolean;   // if true, user CANNOT skip or bypass
  forcedNote:  string;    // shown in red when forced and not yet granted
}

const STEPS: Step[] = [
  {
    id:        "location",
    icon:      "navigate",
    iconColor: C.brand,
    iconBg:    "#EBF3FF",
    title:     "Location Access",
    subtitle:  "Neelgund needs location access to track your field activity and record your daily travel trail.",
    bullets: [
      { icon: "map-outline",              text: "Record daily travel routes" },
      { icon: "navigate-circle-outline",  text: "Auto-capture lead locations" },
      { icon: "people-outline",           text: "Team location visibility" },
    ],
    btnLabel:   "Allow Location",
    btnColor:   C.brand,
    forced:     false,
    forcedNote: "",
  },
  {
    id:        "background",
    icon:      "lock-open",
    iconColor: "#7C3AED",
    iconBg:    "#F3EEFF",
    title:     "Always Allow Location",
    subtitle:  "Set location to \"Always Allow\" so Neelgund can track your route even when your screen is locked or the app is minimised.",
    bullets: [
      { icon: "moon-outline",    text: "Tracks while screen is locked" },
      { icon: "phone-portrait-outline", text: "Works when app is in background" },
      { icon: "time-outline",    text: "Complete route recorded all day" },
    ],
    btnLabel:   "Set Always Allow",
    btnColor:   "#7C3AED",
    forced:     false,
    forcedNote: "",
  },
  {
    id:        "notifications",
    icon:      "notifications",
    iconColor: "#D97706",
    iconBg:    "#FFFBEB",
    title:     "Enable Notifications",
    subtitle:  "Notifications are required to show the tracking status bar. Without it Android will kill background tracking within minutes.",
    bullets: [
      { icon: "shield-checkmark-outline", text: "Keeps tracking alive in the background" },
      { icon: "alert-circle-outline",     text: "Alerts you if tracking stops" },
      { icon: "phone-portrait-outline",   text: "Shows live GPS status in status bar" },
    ],
    btnLabel:   "Allow Notifications",
    btnColor:   "#D97706",
    forced:     true,
    forcedNote: "⚠ Notifications are required. Background tracking will not work without this permission.",
  },
  {
    id:        "battery",
    icon:      "battery-charging",
    iconColor: "#DC2626",
    iconBg:    "#FEF2F2",
    title:     "Disable Battery Saver",
    subtitle:  "Android's battery optimizer pauses background apps. You must set Neelgund to \"Unrestricted\" so your routes are recorded all day.",
    bullets: [
      { icon: "flash-outline",           text: "Prevents Doze mode from killing tracking" },
      { icon: "navigate-outline",        text: "GPS keeps running when phone is locked" },
      { icon: "checkmark-circle-outline",text: "Full day route recorded without gaps" },
    ],
    btnLabel:   "Disable Battery Optimizer",
    btnColor:   "#DC2626",
    forced:     true,
    forcedNote: "⚠ Required. Without this your tracking will stop within 5–10 minutes of locking your phone.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isNotificationGranted(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  } catch { return false; }
}

async function isBatteryOptDisabled(): Promise<boolean> {
  try {
    // isBatteryOptimizationEnabledAsync returns TRUE if the OS IS optimizing
    // (i.e. Doze is active). We want it to be FALSE (unrestricted).
    const optimized = await Battery.isBatteryOptimizationEnabledAsync();
    return !optimized;
  } catch { return false; }
}

async function openBatteryOpt() {
  // Try direct intent first — takes user straight to the Allow/Deny popup
  try {
    await Linking.openURL(
      `android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS?package=${PKG}`
    );
    return;
  } catch {}
  // Fallback: battery optimization list
  try {
    await Linking.openURL("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
    return;
  } catch {}
  // Last resort
  try { await Linking.openSettings(); } catch {}
}

/** Try brand-specific autostart / protected-apps settings pages */
async function tryOpenAutostartSettings() {
  const intents = [
    // Xiaomi / MIUI
    "intent:#Intent;action=com.miui.securitycenter.ACTION_APP_PERM_EDITOR;category=android.intent.category.DEFAULT;end",
    // Oppo / ColorOS
    "intent:#Intent;component=com.coloros.safecenter/com.coloros.privacypermissionsentry.PermissionTopActivity;end",
    // Vivo / FuntouchOS
    "intent:#Intent;component=com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity;end",
    // Huawei / EMUI
    "intent:#Intent;component=com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity;end",
    // OnePlus
    "intent:#Intent;component=com.oneplus.security/.StartupAppListActivity;end",
    // Lenovo
    "intent:#Intent;component=com.lenovo.security/com.lenovo.security.purebackground.PureBackgroundMainActivity;end",
    // Asus
    "intent:#Intent;component=com.asus.mobilemanager/.powersaver.PowerSaverSettings;end",
  ];
  for (const uri of intents) {
    try {
      const can = await Linking.canOpenURL(uri).catch(() => false);
      if (can) { await Linking.openURL(uri); return; }
    } catch {}
  }
}

// ─── Progress dots ────────────────────────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i < current  && styles.dotDone,
            i === current && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function LocationGateScreen() {
  const insets    = useSafeAreaInsets();
  const [stepIdx, setStepIdx] = useState(0);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [batteryOk, setBatteryOk] = useState(false);
  const [notifOk,   setNotifOk]   = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const step = STEPS[stepIdx];

  // Re-check state whenever the app comes back to foreground (user may have
  // just changed a setting and returned)
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      const [nb, bb] = await Promise.all([isNotificationGranted(), isBatteryOptDisabled()]);
      setNotifOk(nb);
      setBatteryOk(bb);
      // If the user fixed the current forced step while away, clear the error
      if (step.id === "notifications" && nb) setError(null);
      if (step.id === "battery"       && bb) setError(null);
    });
    return () => sub.remove();
  }, [step.id]);

  // Initial check
  useEffect(() => {
    Promise.all([isNotificationGranted(), isBatteryOptDisabled()]).then(([nb, bb]) => {
      setNotifOk(nb);
      setBatteryOk(bb);
    });
  }, []);

  // Skip steps that are already granted on first load
  useEffect(() => {
    (async () => {
      if (Platform.OS !== "android") { router.replace("/(tabs)"); return; }
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      const nb = await isNotificationGranted();
      const bb = await isBatteryOptDisabled();
      let start = 0;
      if (fg.status === "granted") start = 1;
      if (fg.status === "granted" && bg.status === "granted") start = 2;
      if (fg.status === "granted" && bg.status === "granted" && nb) start = 3;
      if (fg.status === "granted" && bg.status === "granted" && nb && bb) {
        router.replace("/(tabs)"); return;
      }
      setStepIdx(start);
    })();
  }, []);

  function shake() {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 60, useNativeDriver: true, easing: Easing.linear }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 60, useNativeDriver: true, easing: Easing.linear }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }

  function advance() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);
    if (stepIdx + 1 >= STEPS.length) {
      router.replace("/(tabs)");
    } else {
      setStepIdx(stepIdx + 1);
    }
  }

  async function handlePress() {
    setLoading(true);
    setError(null);

    try {
      switch (step.id) {

        case "location": {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") { advance(); break; }
          setError("Location permission is required to continue.");
          shake();
          break;
        }

        case "background": {
          const { status } = await Location.requestBackgroundPermissionsAsync();
          if (status === "granted") { advance(); break; }
          // If denied, send them to settings — no skipping
          setError('Please set Location to "Always Allow" in Settings, then come back.');
          shake();
          break;
        }

        case "notifications": {
          const { status } = await Notifications.requestPermissionsAsync();
          if (status === "granted") {
            setNotifOk(true);
            advance();
            break;
          }
          // If system dialog was already shown and they denied, send to settings
          setError("Notifications were denied. Please enable them in Settings and come back.");
          shake();
          await Linking.openSettings();
          break;
        }

        case "battery": {
          await openBatteryOpt();
          // After returning, user taps "Check & Continue" to verify
          // We don't auto-advance here because openBatteryOpt() returns
          // immediately — the OS dialog is async. The "Check & Continue"
          // secondary button handles the verify flow.
          setError("After tapping 'Allow' in the system dialog, tap \"I've Done It\" below.");
          break;
        }
      }
    } catch (e) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Only for the battery step — re-read system state and advance if fixed */
  async function handleBatteryCheck() {
    setLoading(true);
    const ok = await isBatteryOptDisabled();
    setLoading(false);
    if (ok) {
      setBatteryOk(true);
      // Try to open autostart settings for Chinese ROMs (best-effort)
      await tryOpenAutostartSettings().catch(() => {});
      advance();
    } else {
      setError("Battery optimization is still on. Please tap 'Allow' in the system dialog.");
      shake();
    }
  }

  async function openSettings() {
    await Linking.openSettings();
  }

  const isCurrentStepDone =
    (step.id === "notifications" && notifOk) ||
    (step.id === "battery"       && batteryOk);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ProgressDots current={stepIdx} total={STEPS.length} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
          {/* Icon */}
          <View style={[styles.iconWrap, { backgroundColor: step.iconBg }]}>
            <Ionicons name={step.icon as any} size={56} color={step.iconColor} />
          </View>

          {/* Step counter */}
          <Text style={styles.stepCounter}>Step {stepIdx + 1} of {STEPS.length}</Text>

          {/* Title */}
          <Text style={styles.title}>{step.title}</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>{step.subtitle}</Text>

          {/* Bullet list */}
          <View style={styles.bulletBox}>
            {step.bullets.map((b) => (
              <View key={b.text} style={styles.bulletRow}>
                <Ionicons name={b.icon as any} size={18} color={step.iconColor} />
                <Text style={styles.bulletText}>{b.text}</Text>
              </View>
            ))}
          </View>

          {/* FORCED badge */}
          {step.forced && (
            <View style={styles.forcedBadge}>
              <Ionicons name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.forcedBadgeText}>Required — cannot be skipped</Text>
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="warning-outline" size={16} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Already done indicator */}
          {isCurrentStepDone && (
            <View style={styles.doneBox}>
              <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
              <Text style={styles.doneText}>Permission granted — tap Continue</Text>
            </View>
          )}

          {/* Primary button */}
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: isCurrentStepDone ? "#16A34A" : step.btnColor }]}
            onPress={isCurrentStepDone ? advance : handlePress}
            activeOpacity={0.85}
            disabled={loading}
          >
            <Ionicons
              name={isCurrentStepDone ? "checkmark-circle-outline" : (step.icon as any)}
              size={20}
              color="#fff"
            />
            <Text style={styles.btnText}>
              {loading ? "Please wait…" : isCurrentStepDone ? "Continue →" : step.btnLabel}
            </Text>
          </TouchableOpacity>

          {/* Battery step: secondary "I've Done It" check button */}
          {step.id === "battery" && !batteryOk && (
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={handleBatteryCheck}
              activeOpacity={0.85}
              disabled={loading}
            >
              <Ionicons name="refresh-circle-outline" size={20} color={C.brand} />
              <Text style={[styles.btnText, { color: C.brand }]}>
                {loading ? "Checking…" : "I've Done It — Check Again"}
              </Text>
            </TouchableOpacity>
          )}

          {/* Settings shortcut for denied states */}
          {(step.id === "background" || step.id === "notifications") && error && (
            <TouchableOpacity style={styles.settingsLink} onPress={openSettings}>
              <Ionicons name="settings-outline" size={16} color={C.textSecondary} />
              <Text style={styles.settingsLinkText}>Open App Settings</Text>
            </TouchableOpacity>
          )}

          {/* Non-forced steps can be skipped (location / background) */}
          {!step.forced && (
            <TouchableOpacity style={styles.skipBtn} onPress={advance}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 18,
    gap: 8,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: C.border,
  },
  dotDone: {
    backgroundColor: C.brand,
    width: 8,
  },
  dotActive: {
    backgroundColor: C.brand,
    width: 24,
  },
  scroll: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    gap: 0,
  },
  iconWrap: {
    width: 110, height: 110, borderRadius: 32,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  stepCounter: {
    textAlign: "center",
    fontSize: 13,
    color: C.textSecondary,
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: C.text,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 22,
  },
  bulletBox: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    marginBottom: 20,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bulletText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: C.text,
    flex: 1,
  },
  forcedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  forcedBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#DC2626",
    flex: 1,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#DC2626",
    flex: 1,
    lineHeight: 19,
  },
  doneBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  doneText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#16A34A",
  },
  btn: {
    flexDirection: "row",
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 12,
  },
  btnSecondary: {
    backgroundColor: "#EBF3FF",
  },
  btnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
  settingsLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginBottom: 4,
  },
  settingsLinkText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
});