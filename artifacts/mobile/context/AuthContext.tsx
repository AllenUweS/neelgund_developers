import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getMe, signOut as apiSignOut, type AppUser } from "@/lib/api";
import { persistAuthToken, clearPersistedAuthToken } from "@/utils/tokenStorage";

type User = AppUser;

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (_token: string, _user: User) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  const qc = useQueryClient();
  userRef.current = user;

  useEffect(() => {
    let mounted = true;

    const applySessionUser = async (event: string) => {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (!mounted) return;
      if (sessionError && __DEV__) {
        console.warn("[Auth] getSession", sessionError.message);
      }
      if (!session?.user) {
        setUser(null);
        return;
      }
      // Persist token for background tasks
      if (session.access_token) {
        await persistAuthToken(session.access_token);
      }
      try {
        const me = await getMe();
        if (!mounted) return;
        if (me) {
          setUser(me);
          return;
        }
        // No profile row — only treat as signed-out on explicit sign-in; keep sticky session on refresh.
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          setUser(null);
        }
      } catch (e) {
        if (!mounted) return;
        const {
          data: { session: s2 },
        } = await supabase.auth.getSession();
        if (!s2?.user) {
          setUser(null);
          return;
        }
        // Transient failure (network / JWT timing): keep last known profile if any.
        if (userRef.current) {
          setUser(userRef.current);
        } else if (__DEV__) {
          console.warn("[Auth] getMe failed while session present", e);
        }
      }
    };

    const boot = async () => {
      try {
        // Ensure AsyncStorage-backed session is hydrated before profile fetch.
        await supabase.auth.getSession();
        if (!mounted) return;
        await applySessionUser("INITIAL_SESSION");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      void (async () => {
        if (!mounted) return;
        if (event === "SIGNED_OUT") {
          setUser(null);
          return;
        }
        await applySessionUser(event);
      })();
    });

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  const login = async (_token: string, newUser: User) => {
    // Persist the Supabase token for background location tasks
    if (_token) {
      await persistAuthToken(_token);
    }
    setUser(newUser);
  };

  const logout = async () => {
    // Step 1: Stop the background location task and flush any queued points
    // BEFORE we clear auth. This ensures the final position is saved and the
    // OS background task is fully unregistered — not just silently abandoned.
    try {
      const Location = await import("expo-location");
      const { wipeAllTrackingQueues } = await import("@/hooks/useLocationTracker");
      const LOCATION_TASK_NAME = "neelgund-background-location";
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
      }
      await wipeAllTrackingQueues();
    } catch {
      // best effort — never block logout
    }

    // Step 2: Write "stopped" to Supabase BEFORE clearing the persisted token.
    // sendHeartbeatRest reads the token from AsyncStorage to get the user ID.
    // If we clear it first, it can't find the user and silently skips the
    // write — leaving tracker_state = "running" in the DB indefinitely.
    try {
      const { supabase } = await import("@/lib/supabase");
      const { sendHeartbeatRest } = await import("@/lib/trackingApi");
      // Use the live session if available; if not, sendHeartbeatRest will fall
      // back to the persisted token in AsyncStorage (still present at this point).
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await sendHeartbeatRest({ trackerState: "stopped", platform: "mobile" });
      }
    } catch {
      // best effort — never block logout
    }

    // Step 3: Clear cache FIRST so any in-flight query results are discarded
    // before the user state flips to null (prevents brief flash of stale data).
    qc.clear();
    await apiSignOut();
    await clearPersistedAuthToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}