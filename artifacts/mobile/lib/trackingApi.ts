/**
 * trackingApi.ts
 *
 * ROOT CAUSE FIX:
 *   The original version sent location batches to the Express API server
 *   (`/api/location/track-batch`) using the Supabase JWT as a Bearer token.
 *   The API server's auth middleware verifies tokens with its own JWT_SECRET
 *   ("neelgund-jwt-secret-..."), which is completely different from Supabase's
 *   signing key. Every request returned 401 Unauthorized — silently dropped
 *   in the catch block — so NO location data was ever saved to the database.
 *   That is why the map showed "0 M", "0 stops", "No location data".
 *
 * FIX:
 *   Write location points directly to Supabase using the supabase-js client,
 *   the same way `api.ts` reads them back (listEmployeeLocationsByDate,
 *   getLocationTrail). This bypasses the JWT mismatch entirely.
 *   The Supabase anon key + RLS policies handle auth correctly.
 *
 *   trackLocationBatch  → supabase.from("location_points").insert(...)
 *   sendHeartbeatRest   → supabase.from("tracking_status").upsert(...)
 *   trackLocationRest   → kept as thin wrapper over single-point batch
 */

import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { getPersistedAuthToken } from "@/utils/tokenStorage";

export type TrackingPointInput = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speedKmh?: number;
  heading?: number;
  altitude?: number;
  batteryLevel?: number;
  activityType?: string;
  source?: string;
  recordedAt?: string;
};

/**
 * Decode the Supabase JWT stored in SecureStore to get the current user's UUID.
 * We can't use supabase.auth.getUser() in background tasks (it may time out),
 * so we parse the JWT directly — it is always a Supabase-issued JWT whose
 * payload contains `sub` = the auth user UUID.
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    // First try the live session (fast path, works in foreground)
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;

    // Background fallback: decode the persisted token
    const token = await getPersistedAuthToken();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert a batch of location points directly into Supabase.
 * RLS on location_points requires auth.uid() = employee_id, which is
 * satisfied because the supabase client carries the user's session token.
 */
export async function trackLocationBatch(
  points: TrackingPointInput[]
): Promise<void> {
  if (points.length === 0) return;

  const userId = await getCurrentUserId();
  if (!userId) {
    // Not authenticated — queue will retry on next flush when session is active
    throw new Error("No authenticated user for location batch");
  }

  const rows = points
    .map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
      }
      return {
        employee_id: userId,
        latitude: lat,
        longitude: lng,
        accuracy: p.accuracy != null ? Number(p.accuracy) : null,
        speed_kmh: p.speedKmh != null ? Number(p.speedKmh) : null,
        heading: p.heading != null ? Number(p.heading) : null,
        altitude: p.altitude != null ? Number(p.altitude) : null,
        battery_level: p.batteryLevel != null ? Number(p.batteryLevel) : null,
        activity_type: p.activityType ?? "unknown",
        source: p.source ?? (Platform.OS === "web" ? "web" : "mobile"),
        recorded_at: p.recordedAt
          ? new Date(p.recordedAt).toISOString()
          : new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  const { error } = await supabase.from("location_points").insert(rows);

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
}

/**
 * Single-point convenience wrapper (used in some places).
 */
export async function trackLocationRest(input: {
  latitude: number;
  longitude: number;
  accuracy?: number;
  recordedAt?: string;
}): Promise<void> {
  await trackLocationBatch([input]);
}

/**
 * Upsert heartbeat / tracker status directly in Supabase.
 */
export async function sendHeartbeatRest(input: {
  trackerState: string;
  platform: string;
}): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return; // silently skip — not authenticated

  const { error } = await supabase.from("tracking_status").upsert(
    {
      employee_id: userId,
      tracker_state: input.trackerState,
      platform: input.platform,
      last_ping_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "employee_id" }
  );

  if (error && __DEV__) {
    console.warn("[trackingApi] heartbeat upsert failed:", error.message);
  }
}

// ── Legacy REST types kept for import compatibility ───────────────────────────

export type TrailResponse = {
  points: Array<{
    id: number;
    employeeId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    address: string | null;
    recordedAt: string;
  }>;
  matchedRoute: number[][] | null;
  matchConfidence: number | null;
  matchPending: boolean;
};
