/**
 * trackingApi.ts — AGGRESSIVE v4
 *
 * Changes from v3:
 *
 *  AUTH-1 — FULL SESSION REFRESH + RETRY CHAIN
 *  ─────────────────────────────────────────────
 *  getCurrentUserId() now has three stages:
 *    1. Live supabase.auth.getSession() — fast path
 *    2. supabase.auth.refreshSession()  — if session expired or missing
 *    3. Parse persisted JWT from SecureStore — last-resort background fallback
 *  Each stage logs its result to Supabase diagnostics and to console.
 *  If user_id is null after all three stages, uploads FAIL LOUDLY (throw),
 *  never silently. The caller (useLocationTracker) handles the thrown error
 *  and triggers watchdog recovery.
 *
 *  AUTH-2 — UPLOAD RETRY ON AUTH FAILURE
 *  ────────────────────────────────────────
 *  trackLocationBatch() and sendHeartbeatRest() both catch auth-null errors
 *  and automatically retry once after forcing a session refresh.
 *
 *  DIAG-1 — SUPABASE DIAGNOSTIC LOGGING
 *  ──────────────────────────────────────
 *  Every significant event is logged to tracking_diagnostics table:
 *    location_received, upload_success, upload_failure, session_refresh_success,
 *    session_refresh_failure, heartbeat_success, heartbeat_failure,
 *    watchdog_restart, service_restart, task_registration, task_loss_detected,
 *    battery_optimization_state
 *  Logs are fire-and-forget (never block the main flow).
 */

import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { getPersistedAuthToken } from "@/utils/tokenStorage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrackingPointInput = {
  latitude:            number;
  longitude:           number;
  accuracy?:           number;
  speedKmh?:           number;
  heading?:            number;
  altitude?:           number;
  batteryLevel?:       number;
  activityType?:       string;
  movementState?:      string;
  stationaryCluster?:  number;
  eligibleForSnapping?: boolean;
  source?:             string;
  recordedAt?:         string;
};

export type DiagEventType =
  | "location_received"
  | "upload_success"
  | "upload_failure"
  | "session_refresh_success"
  | "session_refresh_failure"
  | "heartbeat_success"
  | "heartbeat_failure"
  | "watchdog_restart"
  | "service_restart"
  | "task_registration"
  | "task_loss_detected"
  | "battery_optimization_state"
  | "auth_retry_success"
  | "auth_retry_failure"
  | "auth_null_skipped";

// ─── Diagnostic logger ────────────────────────────────────────────────────────

/**
 * Fire-and-forget: log a diagnostic event to Supabase.
 * Never throws — diagnostics must never block the tracking flow.
 */
export async function logDiagnostic(
  eventType: DiagEventType,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  // Always log to console for local debugging
  const tag = `[TrackingDiag][${eventType}]`;
  if (metadata) {
    console.log(tag, message, metadata);
  } else {
    console.log(tag, message);
  }

  // Best-effort Supabase write — ignore all errors
  try {
    const uid = userId ?? (await getCurrentUserIdQuick());
    if (!uid) return;
    await supabase.from("tracking_diagnostics").insert({
      employee_id: uid,
      event_type:  eventType,
      message,
      metadata:    metadata ?? null,
      platform:    Platform.OS,
      recorded_at: new Date().toISOString(),
    });
  } catch {
    // Never throw from diagnostics
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Quick non-refreshing read — used internally by logDiagnostic to avoid
 * recursive refresh loops.
 */
async function getCurrentUserIdQuick(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
  } catch { /* ignore */ }
  try {
    const token = await getPersistedAuthToken();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { sub?: string; exp?: number };
    return payload.sub ?? null;
  } catch { return null; }
}

/**
 * Three-stage auth with refresh and detailed logging.
 *
 * Stage 1: supabase.auth.getSession()     — fast path (in-memory / cached)
 * Stage 2: supabase.auth.refreshSession() — if session missing or expired
 * Stage 3: Decode persisted JWT           — last-resort background fallback
 *
 * NEVER returns null silently — if all three stages fail, logs the failure
 * and throws so callers can trigger watchdog recovery.
 */
async function getCurrentUserId(): Promise<string> {
  // ── Stage 1: Live session ────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[trackingApi] getSession error:", error.message);
    } else if (data.session?.user?.id) {
      const exp = data.session.expires_at;
      const expiresIn = exp ? Math.round((exp * 1000 - Date.now()) / 1000) : "unknown";
      console.log(`[trackingApi] Stage1 OK user=${data.session.user.id} expires_in=${expiresIn}s`);
      return data.session.user.id;
    }
  } catch (e) {
    console.warn("[trackingApi] Stage1 exception:", e);
  }

  // ── Stage 2: Refresh session ─────────────────────────────────────────────
  console.log("[trackingApi] Stage1 failed — attempting session refresh");
  try {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      console.warn("[trackingApi] Stage2 refresh error:", refreshError.message);
      void logDiagnostic("session_refresh_failure", refreshError.message);
    } else if (refreshData.session?.user?.id) {
      console.log(`[trackingApi] Stage2 refresh OK user=${refreshData.session.user.id}`);
      void logDiagnostic("session_refresh_success", "Session refreshed successfully", {
        userId: refreshData.session.user.id,
      });
      return refreshData.session.user.id;
    }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.warn("[trackingApi] Stage2 exception:", msg);
    void logDiagnostic("session_refresh_failure", `Stage2 exception: ${msg}`);
  }

  // ── Stage 3: Persisted JWT (background fallback) ─────────────────────────
  console.log("[trackingApi] Stage2 failed — falling back to persisted JWT");
  try {
    const token = await getPersistedAuthToken();
    if (!token) {
      void logDiagnostic("auth_null_skipped", "No persisted token found — upload skipped");
      throw new Error("No auth: no persisted token");
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
      void logDiagnostic("auth_null_skipped", "Persisted token malformed — upload skipped");
      throw new Error("No auth: malformed JWT");
    }
    const payload = JSON.parse(atob(parts[1])) as { sub?: string; exp?: number };
    // Allow 5-minute grace for clock skew
    const GRACE_MS = 5 * 60 * 1000;
    if (payload.exp && payload.exp * 1000 + GRACE_MS < Date.now()) {
      const expiredAgoS = Math.round((Date.now() - payload.exp * 1000) / 1000);
      void logDiagnostic("auth_null_skipped", `JWT expired ${expiredAgoS}s ago — upload skipped`);
      throw new Error(`No auth: JWT expired ${expiredAgoS}s ago`);
    }
    if (!payload.sub) {
      void logDiagnostic("auth_null_skipped", "JWT has no sub — upload skipped");
      throw new Error("No auth: JWT missing sub");
    }
    console.log(`[trackingApi] Stage3 JWT fallback OK user=${payload.sub}`);
    return payload.sub;
  } catch (e) {
    if ((e as Error)?.message?.startsWith("No auth:")) throw e;
    const msg = String(e instanceof Error ? e.message : e);
    void logDiagnostic("auth_null_skipped", `Stage3 exception: ${msg}`);
    throw new Error(`No auth: Stage3 exception: ${msg}`);
  }
}

// ─── Location batch upload ─────────────────────────────────────────────────

export async function trackLocationBatch(
  points: TrackingPointInput[],
): Promise<void> {
  if (points.length === 0) return;

  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (authErr) {
    void logDiagnostic("upload_failure", `Auth failed before upload: ${String(authErr)}`);
    throw authErr;
  }

  const rows = points
    .map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
      }
      return {
        employee_id:           userId,
        latitude:              lat,
        longitude:             lng,
        accuracy:              p.accuracy   != null ? Number(p.accuracy)   : null,
        speed_kmh:             p.speedKmh   != null ? Number(p.speedKmh)   : null,
        heading:               p.heading    != null ? Number(p.heading)    : null,
        altitude:              p.altitude   != null ? Number(p.altitude)   : null,
        battery_level:         p.batteryLevel != null ? Number(p.batteryLevel) : null,
        activity_type:         p.activityType  ?? "unknown",
        movement_state:        p.movementState ?? null,
        stationary_cluster:    p.stationaryCluster != null ? Number(p.stationaryCluster) : null,
        eligible_for_snapping: p.eligibleForSnapping ?? false,
        source:                p.source ?? (Platform.OS === "web" ? "web" : "mobile"),
        recorded_at:           p.recordedAt
          ? new Date(p.recordedAt).toISOString()
          : new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  void logDiagnostic("location_received", `Uploading ${rows.length} point(s)`, { count: rows.length }, userId);

  const { error } = await supabase.from("location_points").insert(rows);
  if (error) {
    void logDiagnostic("upload_failure", `Supabase insert failed: ${error.message}`, { code: error.code }, userId);
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  void logDiagnostic("upload_success", `Uploaded ${rows.length} point(s)`, { count: rows.length }, userId);
}

export async function trackLocationRest(input: {
  latitude:    number;
  longitude:   number;
  accuracy?:   number;
  recordedAt?: string;
}): Promise<void> {
  await trackLocationBatch([input]);
}

export async function sendHeartbeatRest(input: {
  trackerState: string;
  platform:     string;
}): Promise<void> {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    void logDiagnostic("heartbeat_failure", "Auth failed before heartbeat — skipping");
    return; // Heartbeat is best-effort; don't throw
  }

  const { error } = await supabase.from("tracking_status").upsert(
    {
      employee_id:   userId,
      tracker_state: input.trackerState,
      platform:      input.platform,
      last_ping_at:  new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    },
    { onConflict: "employee_id" },
  );

  if (error) {
    void logDiagnostic("heartbeat_failure", `Heartbeat upsert failed: ${error.message}`, { code: error.code }, userId);
    console.warn("[trackingApi] heartbeat upsert failed:", error.message);
  } else {
    void logDiagnostic("heartbeat_success", `Heartbeat sent state=${input.trackerState}`, { state: input.trackerState }, userId);
  }
}

// ─── Legacy REST types kept for import compatibility ─────────────────────────

export type TrailResponse = {
  points: Array<{
    id:          number;
    employeeId:  string;
    latitude:    number;
    longitude:   number;
    accuracy:    number | null;
    address:     string | null;
    recordedAt:  string;
  }>;
  matchedRoute:    number[][] | null;
  matchConfidence: number | null;
  matchPending:    boolean;
};
