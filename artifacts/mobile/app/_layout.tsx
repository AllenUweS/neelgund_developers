import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Stack, router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Location from "expo-location";
import React, { useEffect, useRef } from "react";
import { AppState, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useLocationTracker } from "@/hooks/useLocationTracker";
import { processQueue } from "@/lib/offlineQueue";
import { setNotificationHandler } from "@/lib/notifications";

// Skip splash screen on web for faster load
if (Platform.OS !== "web") {
  SplashScreen.preventAutoHideAsync();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const initialRouteDone = useRef(false);
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const lastLocationCheckRef = useRef(0);
  const pathname = usePathname();
  useLocationTracker(user?.id ?? null);

  useEffect(() => {
    if (isLoading) return;
    if (initialRouteDone.current) return;
    initialRouteDone.current = true;

    if (!user) {
      router.replace("/login");
    } else {
      router.replace("/location-gate");
    }
  }, [isLoading]);

  // When user logs out, redirect to login
  useEffect(() => {
    if (!isLoading && !user && initialRouteDone.current) {
      router.replace("/login");
    }
  }, [user, isLoading]);

  // When the active user id changes (login, logout, or switch), wipe per-user
  // caches so one account NEVER sees another account's data on the same device.
  useEffect(() => {
    const currentId = user?.id ?? null;
    const prev = lastUserIdRef.current;
    if (prev === undefined) {
      lastUserIdRef.current = currentId;
      return;
    }
    if (prev !== currentId) {
      qc.clear();
      lastUserIdRef.current = currentId;
    }
  }, [user?.id, qc]);

  // Enforce location permission while app is in use. If the user revokes it in
  // system settings and comes back, send them to /location-gate. Without
  // location tracking, the app cannot be used.
  // Enforce location permission — throttled to once per 10s to avoid
  // blocking the JS thread on every navigation event.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user) return;

    const THROTTLE_MS = 10_000;

    const check = async () => {
      const now = Date.now();
      if (now - lastLocationCheckRef.current < THROTTLE_MS) return;
      lastLocationCheckRef.current = now;
      try {
        const foreground = await Location.getForegroundPermissionsAsync();
        const background = await Location.getBackgroundPermissionsAsync();
        if (foreground.status !== "granted" || background.status !== "granted") {
          const path = pathname ?? "";
          if (!path.startsWith("/location-gate") && !path.startsWith("/login")) {
            router.replace("/location-gate");
          }
        }
      } catch {
        // ignore — we'll try again on the next foreground event
      }
    };

    void check();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void check();
        // Attempt to sync any leads that were saved while offline
        void processQueue();
      }
    });

    return () => {
      sub.remove();
    };
  }, [user, pathname]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="location-gate" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="lead/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="add-lead" options={{ headerShown: false }} />
      <Stack.Screen name="attendance/[employeeId]" options={{ headerShown: false }} />
      <Stack.Screen name="regularizations" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  // On web, use system fonts for faster load time
  const [fontsLoaded, fontError] = useFonts(
    Platform.OS === "web"
      ? {}
      : {
          Inter_400Regular,
          Inter_500Medium,
          Inter_600SemiBold,
          Inter_700Bold,
        }
  );

  useEffect(() => {
    if (Platform.OS !== "web") {
      setNotificationHandler();
    }
    if (Platform.OS === "web" || fontsLoaded || fontError) {
      if (Platform.OS !== "web") {
        SplashScreen.hideAsync();
      }
    }
  }, [fontsLoaded, fontError]);

  if (Platform.OS !== "web" && !fontsLoaded && !fontError) return null;

  const GestureWrapper = Platform.OS === "web" ? View : GestureHandlerRootView;

  return (
    <SafeAreaProvider>
      {Platform.OS === "web" && (
        <style type="text/css">{`
          a, button, [role="button"], input, textarea, select {
            -webkit-tap-highlight-color: transparent;
            outline: none;
          }
          * { outline: none; }
        `}</style>
      )}
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureWrapper style={{ flex: 1 }}>
            <AuthProvider>
              <RootLayoutNav />
            </AuthProvider>
          </GestureWrapper>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
