/**
 * googleMapsKey.ts
 *
 * Single source-of-truth for the Google Maps API key.
 *
 * Strategy (priority order):
 *   1. Supabase DB  →  public.app_config WHERE key = 'google_maps_api_key'
 *      (allows the admin to rotate the key without rebuilding the APK)
 *   2. Local cache  →  AsyncStorage / localStorage (24-hour TTL)
 *   3. .env fallback → EXPO_PUBLIC_GOOGLE_MAPS_KEY
 *      (used during development or if the DB is unreachable at first boot)
 *
 * Usage:
 *   import { getGoogleMapsKey } from "@/lib/googleMapsKey";
 *   const key = await getGoogleMapsKey();
 *
 * For legacy compatibility a synchronous GOOGLE_MAPS_KEY export is still
 * provided (returns the .env value or the last cached value). Prefer the
 * async getter in new code.
 */

import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

// ── Constants ─────────────────────────────────────────────────────────────────
const ENV_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "";
const CACHE_STORAGE_KEY = "gmaps_api_key_cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type CacheEntry = { value: string; fetchedAt: number };

// ── Platform-safe KV storage ──────────────────────────────────────────────────
const kv = {
  async get(k: string): Promise<string | null> {
    try {
      if (Platform.OS === "web") {
        return localStorage.getItem(k);
      }
      const { default: AsyncStorage } = await import(
        "@react-native-async-storage/async-storage"
      );
      return AsyncStorage.getItem(k);
    } catch {
      return null;
    }
  },
  async set(k: string, v: string): Promise<void> {
    try {
      if (Platform.OS === "web") {
        localStorage.setItem(k, v);
      } else {
        const { default: AsyncStorage } = await import(
          "@react-native-async-storage/async-storage"
        );
        await AsyncStorage.setItem(k, v);
      }
    } catch {
      // storage unavailable — silently ignore
    }
  },
};

// ── In-memory singleton ───────────────────────────────────────────────────────
let _resolvedKey: string | null = null;

// ── Main async getter ─────────────────────────────────────────────────────────
export async function getGoogleMapsKey(): Promise<string> {
  // 1. In-memory singleton (fastest path after first boot)
  if (_resolvedKey !== null) return _resolvedKey;

  // 2. Check local cache
  try {
    const raw = await kv.get(CACHE_STORAGE_KEY);
    if (raw) {
      const cached: CacheEntry = JSON.parse(raw);
      const age = Date.now() - cached.fetchedAt;
      if (age < CACHE_TTL_MS && cached.value) {
        _resolvedKey = cached.value;
        return _resolvedKey;
      }
    }
  } catch {
    // corrupt cache — fall through
  }

  // 3. Fetch from Supabase DB
  try {
    const { data, error } = await supabase.rpc("get_google_maps_key");
    if (!error && data) {
      _resolvedKey = data as string;
      // Persist to cache
      const entry: CacheEntry = { value: _resolvedKey, fetchedAt: Date.now() };
      await kv.set(CACHE_STORAGE_KEY, JSON.stringify(entry));
      return _resolvedKey;
    }
    if (error) {
      console.warn("[GoogleMaps] DB fetch failed:", error.message);
    }
  } catch (err) {
    console.warn("[GoogleMaps] DB unreachable:", err);
  }

  // 4. Fall back to .env value
  if (ENV_KEY) {
    _resolvedKey = ENV_KEY;
    return _resolvedKey;
  }

  console.error(
    "[GoogleMaps] No API key available — set it in the Admin panel or in .env"
  );
  return "";
}

/**
 * Force-refreshes the cached key from the DB.
 * Call this after an admin updates the key in the panel.
 */
export async function refreshGoogleMapsKey(): Promise<string> {
  _resolvedKey = null;
  await kv.set(CACHE_STORAGE_KEY, ""); // invalidate cache
  return getGoogleMapsKey();
}

// ── Legacy synchronous export (returns env value until async key resolves) ────
export const GOOGLE_MAPS_KEY = ENV_KEY;