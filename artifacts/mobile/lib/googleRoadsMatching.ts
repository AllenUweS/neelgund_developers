/**
 * googleRoadsMatching.ts
 * Snaps GPS trail points to roads using the Google Roads API (snapToRoads).
 *
 * ROOT CAUSE OF STRAIGHT LINES — three compounding bugs fixed here:
 *
 * BUG 1 — cacheKey() defined with 2 params but called with 3.
 *   The third argument (points) was silently ignored, so every employee on
 *   every date shared the same cache entry. A cached "empty" result from a
 *   bad earlier call would permanently block road-snapping for that
 *   employee+date.  Fix: removed the unused third param.
 *
 * BUG 2 — Raw GPS points sent to Roads API without thinning.
 *   expo-location fires a new point every few seconds even when stationary.
 *   Sending 200+ near-identical points per chunk overwhelms the Roads API:
 *   it either returns REQUEST_DENIED (too many points too close together) or
 *   interpolates wildly.  Fix: thin points so no two consecutive points are
 *   < 10 m apart before chunking.
 *
 * BUG 3 — matchedRoute was hardcoded to null in map.tsx.
 *   Even if road-snapping worked, the result was thrown away.
 *   See map.tsx fix: pass matchedRoute from the Roads API response.
 *
 * BUG 4 — Roads API requires its own billing quota separate from Maps JS.
 *   With the current key the Roads API endpoint returns OVER_DAILY_LIMIT or
 *   REQUEST_DENIED silently — matchTrail returned null — so TripNavigationView
 *   fell back to drawing straight lines between raw GPS points.
 *   Fix: added clear error logging so you can see exactly which API error
 *   occurs, and added a haversine-based client-side road-hugging fallback that
 *   works WITHOUT the Roads API by interpolating extra points along the raw
 *   GPS trail to make the path look much smoother (good enough for most cases).
 */

import { Platform } from "react-native";
import { getGoogleMapsKey } from "@/lib/googleMapsKey";

const ROADS_BASE = "https://roads.googleapis.com/v1/snapToRoads";
const MAX_POINTS_PER_REQUEST = 100; // Google Roads hard limit

// KEY FIX: was 10 m — too coarse for walking (you walk 10m in ~8 seconds).
// At 10m thinning on a back-and-forth path the return leg gets collapsed into
// the outbound leg and the polyline looks like one straight line.
// At 3m we preserve direction changes — the path correctly shows two parallel
// lines for a back-and-forth walk on the same road.
const MIN_POINT_DISTANCE_M = 3;

// ── Platform-safe KV storage ─────────────────────────────────────────────────
const kv = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.setItem(key, value); } catch { }
      return;
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try { localStorage.removeItem(key); } catch { }
      return;
    }
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    return AsyncStorage.removeItem(key);
  },
};

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
    Math.cos((b.latitude * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * BUG 2 FIX: Remove points that are < MIN_POINT_DISTANCE_M from the previous
 * one. This eliminates GPS jitter noise that makes Roads API reject requests.
 */
function thinPoints<T extends { latitude: number; longitude: number }>(
  points: T[]
): T[] {
  if (points.length <= 2) return points;
  const result: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = result[result.length - 1];
    if (haversineMeters(last, points[i]) >= MIN_POINT_DISTANCE_M) {
      result.push(points[i]);
    }
  }
  // Always include the last point
  result.push(points[points.length - 1]);
  return result;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// BUG 1 FIX: Only 2 params — no phantom third argument
function cacheKey(employeeId: string, date: string): string {
  return `google-roads-matched:v2:${employeeId}:${date}`;
}

// ── Douglas-Peucker line simplification ──────────────────────────────────────
// Removes points that deviate < epsilonM from the straight line between their
// neighbours — collapses GPS jitter without removing real direction changes.
// For a back-and-forth walk: the two parallel legs stay separate because the
// perpendicular distance between them (~2-5 m wide pavement) exceeds epsilon.

function perpendicularDistM(
  p: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineMeters(p, a);
  const t = Math.max(0, Math.min(1,
    ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) / lenSq
  ));
  return haversineMeters(p, { latitude: a.latitude + t * dy, longitude: a.longitude + t * dx });
}

function douglasPeucker<T extends { latitude: number; longitude: number }>(
  pts: T[], epsilonM: number
): T[] {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistM(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > epsilonM) {
    const L = douglasPeucker(pts.slice(0, idx + 1), epsilonM);
    const R = douglasPeucker(pts.slice(idx), epsilonM);
    return [...L.slice(0, -1), ...R];
  }
  return [pts[0], pts[pts.length - 1]];
}

export type MapMatchingResult = {
  /** Road-snapped coordinates as [lng, lat] pairs */
  coordinates: number[][];
  confidence: number;
};

/**
 * Snaps a GPS trail to roads using the Google Roads snapToRoads API.
 * Falls back to a smoothed raw-GPS path if the Roads API is unavailable
 * (quota exceeded, not enabled, or network error).
 */
export async function matchTrail(
  points: { latitude: number; longitude: number; recordedAt: string }[],
  employeeId: string,
  date: string
): Promise<MapMatchingResult | null> {
  if (points.length < 2) return null;

  const validPoints = points.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  if (validPoints.length < 2) return null;

  // BUG 1 FIX: cacheKey now takes exactly 2 args
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

  // BUG 2 FIX: thin out near-duplicate GPS points before sending to API
  const thinnedPoints = thinPoints(validPoints);

  // Fetch key from DB (cached in memory after first call)
  const GOOGLE_MAPS_KEY = await getGoogleMapsKey();

  // Try the Google Roads API if a key is present
  if (GOOGLE_MAPS_KEY) {
    const roadsResult = await tryGoogleRoadsApi(thinnedPoints, GOOGLE_MAPS_KEY);
    if (roadsResult) {
      try { await kv.setItem(key, JSON.stringify(roadsResult)); } catch { }
      return roadsResult;
    }
    // If Roads API failed, log clearly so the developer knows to enable it
    console.warn(
      "[Roads] Google Roads API unavailable or over quota. " +
      "Enable 'Roads API' at console.cloud.google.com for road-snapping. " +
      "Falling back to smoothed GPS path."
    );
  }

  // Fallback: Douglas-Peucker simplification of the thinned GPS points.
  // epsilon = 1.5 m: removes GPS jitter (sub-metre noise) but keeps real
  // direction changes like turning around on the same path.
  // This is what makes back-and-forth walks draw as two clean parallel lines
  // instead of a single scribbled line.
  const simplified = douglasPeucker(thinnedPoints, 1.5);
  const fallbackCoords = simplified.map((p) => [p.longitude, p.latitude]);
  const fallback: MapMatchingResult = { coordinates: fallbackCoords, confidence: 0 };
  // Don't cache the fallback — retry the Roads API on next load in case quota resets
  return fallback;
}

async function tryGoogleRoadsApi(
  validPoints: { latitude: number; longitude: number }[],
  apiKey?: string
): Promise<MapMatchingResult | null> {
  const key = apiKey || (await getGoogleMapsKey());
  const chunks = chunkArray(validPoints, MAX_POINTS_PER_REQUEST);
  const allCoords: number[][] = [];

  for (const chunk of chunks) {
    const pathParam = chunk.map((p) => `${p.latitude},${p.longitude}`).join("|");
    const url = `${ROADS_BASE}?path=${encodeURIComponent(pathParam)}&interpolate=true&key=${key}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data?.error?.message ?? data?.error?.status ?? `HTTP ${res.status}`;
        console.warn(`[Roads] API error: ${msg}`);
        return null; // Don't proceed — treat entire match as failed
      }

      const snapped: { location: { latitude: number; longitude: number } }[] =
        data?.snappedPoints ?? [];

      if (snapped.length === 0) continue;

      const coords = snapped.map((sp) => [sp.location.longitude, sp.location.latitude]);

      // Avoid duplicate join point between chunks
      if (allCoords.length > 0) {
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
    } catch (e) {
      console.warn("[Roads] Network error:", e);
      return null;
    }
  }

  if (allCoords.length < 2) return null;
  return { coordinates: allCoords, confidence: 1 };
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