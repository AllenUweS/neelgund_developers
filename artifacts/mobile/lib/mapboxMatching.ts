import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAPBOX_ACCESS_TOKEN } from "@/lib/mapboxToken";

const MATCHING_BASE = "https://api.mapbox.com/matching/v5/mapbox/driving";
const MAX_POINTS_PER_REQUEST = 60;

/**
 * Chunks an array into smaller arrays of max size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function cacheKey(employeeId: string, date: string): string {
  return `mapbox-matched-route:${employeeId}:${date}`;
}

export type MapMatchingResult = {
  coordinates: number[][]; // [lng, lat]
  confidence: number;
};

/**
 * Client-side Mapbox Map Matching.
 * Chunks trail into 100-point segments, calls Mapbox Matching API,
 * stitches results together. Results cached in AsyncStorage.
 */
export async function matchTrail(
  points: { latitude: number; longitude: number; recordedAt: string }[],
  employeeId: string,
  date: string,
): Promise<MapMatchingResult | null> {
  if (!MAPBOX_ACCESS_TOKEN) return null;
  if (points.length < 2) return null;

  const key = cacheKey(employeeId, date);
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as MapMatchingResult;
      if (parsed.coordinates?.length >= 2) return parsed;
    }
  } catch {
    // ignore cache read errors
  }

  const validPoints = points.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (validPoints.length < 2) return null;

  const chunks = chunkArray(validPoints, MAX_POINTS_PER_REQUEST);
  const allCoords: number[][] = [];
  let totalConfidence = 0;
  let chunkCount = 0;

  for (const chunk of chunks) {
    const coordsParam = chunk.map((p) => `${p.longitude},${p.latitude}`).join(";");
    const radiuses = chunk.map(() => "50").join(";");
    const url = `${MATCHING_BASE}/${coordsParam}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`[Map Matching] HTTP ${res.status}: ${err.message ?? "unknown"} (code: ${err.code ?? "none"})`);
        continue;
      }
      const data = await res.json();
      const match = data?.matchings?.[0];
      if (match?.geometry?.coordinates) {
        const coords = match.geometry.coordinates as number[][];
        // Avoid duplicating the last/first point between chunks
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
        totalConfidence += match.confidence ?? 0;
        chunkCount++;
      }
    } catch (e) {
      console.warn("[Map Matching] Network error:", e);
    }
  }

  if (allCoords.length < 2) return null;

  const result: MapMatchingResult = {
    coordinates: allCoords,
    confidence: chunkCount > 0 ? totalConfidence / chunkCount : 0,
  };

  try {
    await AsyncStorage.setItem(key, JSON.stringify(result));
  } catch {
    // ignore cache write errors
  }

  return result;
}

export async function clearMatchedRouteCache(employeeId: string, date: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(employeeId, date));
  } catch {
    // ignore
  }
}
