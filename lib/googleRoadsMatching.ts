/**
 * googleRoadsMatching.ts
 * Replaces mapboxMatching.ts — snaps GPS trail points to roads
 * using the Google Roads API (snapToRoads endpoint).
 *
 * Google Roads API snaps up to 100 points per request, so we chunk
 * the trail exactly the same way the old Mapbox version did.
 *
 * API docs: https://developers.google.com/maps/documentation/roads/snap-to-roads
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

const ROADS_BASE = "https://roads.googleapis.com/v1/snapToRoads";
const MAX_POINTS_PER_REQUEST = 100; // Google Roads hard limit

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
 * Results are cached in AsyncStorage for the given employee+date.
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
    const cached = await AsyncStorage.getItem(key);
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
    await AsyncStorage.setItem(key, JSON.stringify(result));
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
    await AsyncStorage.removeItem(cacheKey(employeeId, date));
  } catch {
    // ignore
  }
}
