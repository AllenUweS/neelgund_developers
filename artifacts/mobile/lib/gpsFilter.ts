/**
 * lib/gpsFilter.ts
 *
 * Client-side GPS point filter for polyline drawing.
 *
 * Eliminates the three sources of back-and-forth scribbles:
 *   1. Weak GPS fixes (accuracy > 65 m — indoors, tunnels, weak signal)
 *   2. Impossible speed jumps (single bad fix appears to teleport the user)
 *   3. GPS drift at stops (< 8 m movement between consecutive points)
 *
 * Used in:
 *   - lib/api.ts → getLocationTrail()  (historical trail from Supabase)
 *   - TripNavigationView polyline memo  (same data, second gate)
 */

export interface FilterablePoint {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speedKmh?: number | null;
  recordedAt: string; // ISO string
}

const EARTH_R = 6_371_000; // metres

export function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export function filterPointsForPolyline<T extends FilterablePoint>(
  points: T[],
  opts: {
    maxAccuracyMetres?: number; // default 65
    maxSpeedKmh?: number;       // default 250
    minDistanceMetres?: number; // default 8
  } = {},
): T[] {
  const {
    maxAccuracyMetres = 65,
    maxSpeedKmh = 250,
    minDistanceMetres = 8,
  } = opts;

  if (points.length === 0) return [];

  // 1. Drop weak GPS fixes
  const accurate = points.filter(
    (p) => p.accuracy == null || p.accuracy <= maxAccuracyMetres,
  );
  if (accurate.length === 0) return points; // safety fallback

  // 2. Drop impossible speed-spike outliers
  const maxSpeedMs = maxSpeedKmh / 3.6;
  const noSpikes: T[] = [accurate[0]];
  for (let i = 1; i < accurate.length; i++) {
    const prev = noSpikes[noSpikes.length - 1];
    const curr = accurate[i];
    const dist = haversineMetres(
      prev.latitude, prev.longitude,
      curr.latitude, curr.longitude,
    );
    const dtSec = Math.max(
      1,
      (new Date(curr.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 1000,
    );
    if (dist / dtSec <= maxSpeedMs) {
      noSpikes.push(curr);
    }
  }

  // 3. Collapse GPS drift: only keep a point if it moved >= minDistanceMetres
  const out: T[] = [noSpikes[0]];
  for (let i = 1; i < noSpikes.length; i++) {
    const last = out[out.length - 1];
    const curr = noSpikes[i];
    if (
      haversineMetres(last.latitude, last.longitude, curr.latitude, curr.longitude) >=
      minDistanceMetres
    ) {
      out.push(curr);
    }
  }

  return out;
}