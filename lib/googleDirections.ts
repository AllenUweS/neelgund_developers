/**
 * googleDirections.ts
 * Replaces mapboxDirections.ts — fetches turn-by-turn driving directions
 * using the Google Directions API.
 *
 * API docs: https://developers.google.com/maps/documentation/directions
 */

import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

const DIRECTIONS_BASE =
  "https://maps.googleapis.com/maps/api/directions/json";

export type Maneuver = {
  instruction: string;   // HTML stripped to plain text
  type: string;          // maneuver value from Google (e.g. "turn-left")
  modifier?: string;
  distance: number;      // meters
  duration: number;      // seconds
};

export type RouteLeg = {
  distance: number;      // meters
  duration: number;      // seconds
  summary: string;
  steps: Maneuver[];
};

export type DirectionsResult = {
  distance: number;      // total meters
  duration: number;      // total seconds
  legs: RouteLeg[];
  geometry: number[][];  // [lng, lat] — decoded from overview_polyline
};

/** Strip basic HTML tags from Google's html_instructions */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** Google's encoded polyline decoder */
function decodePolyline(encoded: string): number[][] {
  const coords: number[][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push([lng / 1e5, lat / 1e5]); // [lng, lat]
  }
  return coords;
}

/**
 * Fetch driving directions between waypoints using Google Directions API.
 * @param waypoints — Array of [lng, lat] coordinates (same shape as the old Mapbox call)
 */
export async function fetchDirections(
  waypoints: number[][]
): Promise<DirectionsResult | null> {
  if (!GOOGLE_MAPS_KEY) return null;
  if (waypoints.length < 2) return null;

  const origin = `${waypoints[0][1]},${waypoints[0][0]}`;
  const destination = `${waypoints[waypoints.length - 1][1]},${waypoints[waypoints.length - 1][0]}`;

  // Intermediate waypoints (if any)
  const waypointsParam =
    waypoints.length > 2
      ? "&waypoints=" +
        waypoints
          .slice(1, -1)
          .map((w) => `${w[1]},${w[0]}`)
          .join("|")
      : "";

  const url =
    `${DIRECTIONS_BASE}?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    waypointsParam +
    `&mode=driving&overview=full&key=${GOOGLE_MAPS_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (data.status !== "OK") {
      console.warn("[Directions] Status:", data.status, data.error_message);
      return null;
    }

    const route = data.routes?.[0];
    if (!route) return null;

    const legs: RouteLeg[] = (route.legs || []).map((leg: any) => ({
      distance: leg.distance?.value ?? 0,
      duration: leg.duration?.value ?? 0,
      summary: leg.summary ?? "",
      steps: (leg.steps || []).map((step: any) => ({
        instruction: stripHtml(step.html_instructions ?? ""),
        type: step.maneuver ?? "straight",
        modifier: undefined,
        distance: step.distance?.value ?? 0,
        duration: step.duration?.value ?? 0,
      })),
    }));

    const totalDistance = legs.reduce((s, l) => s + l.distance, 0);
    const totalDuration = legs.reduce((s, l) => s + l.duration, 0);

    // Decode the overview polyline into [lng, lat] pairs
    const geometry = route.overview_polyline?.points
      ? decodePolyline(route.overview_polyline.points)
      : [];

    return {
      distance: totalDistance,
      duration: totalDuration,
      legs,
      geometry,
    };
  } catch (e) {
    console.warn("[Directions] Error:", e);
    return null;
  }
}

/** Maps Google maneuver strings to Ionicons names (same interface as before) */
export function formatManeuverIcon(
  type: string,
  _modifier?: string
): string {
  const map: Record<string, string> = {
    "turn-left": "arrow-back",
    "turn-right": "arrow-forward",
    "turn-slight-left": "arrow-back",
    "turn-slight-right": "arrow-forward",
    "turn-sharp-left": "arrow-back",
    "turn-sharp-right": "arrow-forward",
    "uturn-left": "arrow-undo",
    "uturn-right": "arrow-undo",
    straight: "arrow-up",
    "keep-left": "arrow-back",
    "keep-right": "arrow-forward",
    "merge": "git-merge",
    "fork-left": "git-branch",
    "fork-right": "git-branch",
    "ferry": "boat",
    "ferry-train": "train",
    "roundabout-left": "sync",
    "roundabout-right": "sync",
    ramp: "arrow-up-circle",
  };
  return map[type] || "arrow-up";
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
