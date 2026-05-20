/**
 * googleRoadsMatching.ts
 * Replaces mapboxMatching.ts — snaps GPS trail points to roads
 * using the Google Roads API (snapToRoads endpoint).
 *
 * Google Roads API snaps up to 100 points per request, so we chunk
 * the trail exactly the same way the old Mapbox version did.
 *
 * API docs: https://developers.google.com/maps/documentation/roads/snap-to-roads
 *
 * FIXES applied vs original:
 *   1. AsyncStorage is no longer imported unconditionally. On web (map.web.tsx)
 *      this module is used directly and AsyncStorage does not exist. We now
 *      use a platform-safe KV wrapper (localStorage on web, AsyncStorage
 *      on native) — identical pattern to geocoding.ts.
 */

import { Platform } from "react-native";
import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

const ROADS_BASE = "https://roads.googleapis.com/v1/snapToRoads";
const MAX_POINTS_PER_REQUEST = 100; // Google Roads hard limit

// ── Platform-safe KV storage ─────────────────────────────────────────────────
// FIX #1: AsyncStorage crashes on web. Use localStorage as a shim.
const kv = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Ignore quota errors
      }
      return;
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        localStorage.removeItem(key);
      } catch {}
      return;
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.removeItem(key);
  },
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function cacheKey(employeeId: string, date: string): string {
  return `google-roads-matched:${employeeId}:${date}`;
}

export type MapMatchingResult = {
  /** Road-snapped coordinates as [lng, lat] pairs (same shape as Mapbox result) */
  coordinates: number[][];
  confidence: number;
};

/**
 * Snaps a GPS trail to roads using the Google Roads snapToRoads API.
 * Results are cached for the given employee+date.
 */
export async function matchTrail(
  points: { latitude: number; longitude: number; recordedAt: string }[],
  employeeId: string,
  date: string
): Promise<MapMatchingResult | null> {
  if (!GOOGLE_MAPS_KEY) return null;
  if (points.length < 2) return null;

  // Check cache first
  const key = cacheKey(employeeId, date);
  try {
    const cached = await kv.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as MapMatchingResult;
      if (parsed.coordinates?.length >= 2) return parsed;
    }
  } catch {
    // ignore cache errors
  }

  const validPoints = points.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  if (validPoints.length < 2) return null;

  const chunks = chunkArray(validPoints, MAX_POINTS_PER_REQUEST);
  const allCoords: number[][] = []; // [lng, lat] pairs

  for (const chunk of chunks) {
    // Google Roads wants "lat,lng|lat,lng|..." as a path param
    const pathParam = chunk
      .map((p) => `${p.latitude},${p.longitude}`)
      .join("|");

    const url = `${ROADS_BASE}?path=${encodeURIComponent(pathParam)}&interpolate=true&key=${GOOGLE_MAPS_KEY}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(
          `[Roads] HTTP ${res.status}: ${err?.error?.message ?? "unknown"}`
        );
        continue;
      }
      const data = await res.json();

      // snappedPoints: [{ location: { latitude, longitude }, ... }]
      const snapped: { location: { latitude: number; longitude: number } }[] =
        data?.snappedPoints ?? [];

      if (snapped.length > 0) {
        const coords = snapped.map((sp) => [
          sp.location.longitude,
          sp.location.latitude,
        ]);

        // Avoid duplicate join point between chunks
        if (allCoords.length > 0 && coords.length > 0) {
          const last = allCoords[allCoords.length - 1];
          const first = coords[0];
          if (last[0] === first[0] && last[1] === first[1]) {
            allCoords.push(...coords.slice(1));
          } else {
            allCoords.push(...coords);
          }
        } else {
          allCoords.push(...coords);
        }
      }
    } catch (e) {
      console.warn("[Roads] Network error:", e);
    }
  }

  if (allCoords.length < 2) return null;

  const result: MapMatchingResult = {
    coordinates: allCoords,
    confidence: 1, // Google Roads doesn't expose a confidence score
  };

  try {
    await kv.setItem(key, JSON.stringify(result));
  } catch {
    // ignore cache write errors
  }

  return result;
}

export async function clearMatchedRouteCache(
  employeeId: string,
  date: string
): Promise<void> {
  try {
    await kv.removeItem(cacheKey(employeeId, date));
  } catch {
    // ignore
  }
}
