import { MAPBOX_ACCESS_TOKEN } from "@/lib/mapboxToken";

const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";

export type Maneuver = {
  instruction: string;
  type: string;
  modifier?: string;
  distance: number;
  duration: number;
};

export type RouteLeg = {
  distance: number;
  duration: number;
  summary: string;
  steps: Maneuver[];
};

export type DirectionsResult = {
  distance: number; // total meters
  duration: number; // total seconds
  legs: RouteLeg[];
  geometry: number[][]; // [lng, lat]
};

/**
 * Fetch driving directions between waypoints using Mapbox Directions API.
 * @param waypoints - Array of [lng, lat] coordinates
 */
export async function fetchDirections(
  waypoints: number[][],
): Promise<DirectionsResult | null> {
  if (!MAPBOX_ACCESS_TOKEN) return null;
  if (waypoints.length < 2) return null;

  const coordsParam = waypoints.map((w) => `${w[0]},${w[1]}`).join(";");
  const url = `${DIRECTIONS_BASE}/${coordsParam}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;

    const legs: RouteLeg[] = (route.legs || []).map((leg: any) => ({
      distance: leg.distance ?? 0,
      duration: leg.duration ?? 0,
      summary: leg.summary ?? "",
      steps: (leg.steps || []).map((step: any) => ({
        instruction: step.maneuver?.instruction ?? "",
        type: step.maneuver?.type ?? "",
        modifier: step.maneuver?.modifier,
        distance: step.distance ?? 0,
        duration: step.duration ?? 0,
      })),
    }));

    return {
      distance: route.distance ?? 0,
      duration: route.duration ?? 0,
      legs,
      geometry: route.geometry?.coordinates ?? [],
    };
  } catch {
    return null;
  }
}

export function formatManeuverIcon(type: string, modifier?: string): string {
  const map: Record<string, string> = {
    depart: "arrow-up",
    arrive: "flag",
    turn: modifier?.includes("left") ? "arrow-back" : modifier?.includes("right") ? "arrow-forward" : "arrow-up",
    "continue": "arrow-up",
    "new name": "arrow-up",
    "merge": "git-merge",
    "on ramp": "arrow-up-circle",
    "off ramp": "arrow-down-circle",
    "fork": "git-branch",
    "end of road": "stop",
    "roundabout": "sync",
    "rotary": "sync",
    "roundabout turn": "sync",
    "notification": "information-circle",
    "exit roundabout": "sync",
    "exit rotary": "sync",
    uturn: "arrow-undo",
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
