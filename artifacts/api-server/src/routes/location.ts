import { Router } from "express";
import { db, locationPointsTable, usersTable, zonesTable, zoneVisitsTable, stopsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, asc, desc, isNull, count } from "drizzle-orm";
import { authenticate, requireRole, AuthRequest } from "../middlewares/auth";

const router = Router();

type EmployeeLocationRow = {
  employeeId: string;
  employeeName: string;
  latitude: number;
  longitude: number;
  recordedAt: string | Date;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !isNaN(d.getTime());
}

// --- In-memory cache for matched routes (24h TTL) ---

type MatchedRouteCacheEntry = {
  coordinates: number[][]; // [lng, lat] pairs
  confidence: number;
  cachedAt: number;
};

const matchedRouteCache = new Map<string, MatchedRouteCacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(employeeId: string, date: string): string {
  return `${employeeId}:${date}`;
}

function getCachedRoute(key: string): MatchedRouteCacheEntry | null {
  const entry = matchedRouteCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    matchedRouteCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedRoute(key: string, coordinates: number[][], confidence: number): void {
  matchedRouteCache.set(key, { coordinates, confidence, cachedAt: Date.now() });
}

// --- Mapbox Map Matching ---

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const MAPBOX_MATCHING_URL = "https://api.mapbox.com/matching/v5/mapbox/driving";
const MAX_MAPBOX_POINTS = 100;

async function callMapboxMatching(coordinates: { lat: number; lng: number }[]): Promise<{ coordinates: number[][]; confidence: number } | null> {
  if (!MAPBOX_TOKEN || coordinates.length < 2) return null;

  // Chunk into 100-point segments
  const chunks: { lat: number; lng: number }[][] = [];
  for (let i = 0; i < coordinates.length; i += MAX_MAPBOX_POINTS) {
    chunks.push(coordinates.slice(i, i + MAX_MAPBOX_POINTS));
  }

  const allCoords: number[][] = [];
  let totalConfidence = 0;
  let chunkCount = 0;

  for (const chunk of chunks) {
    const coordsStr = chunk.map((c) => `${c.lng},${c.lat}`).join(";");
    const url = `${MAPBOX_MATCHING_URL}/${coordsStr}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full`;

    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        console.error(`Mapbox matching failed: ${response.status}`);
        continue;
      }
      const data = await response.json() as {
        code?: string;
        matchings?: Array<{ confidence: number; geometry: { coordinates: number[][] } }>;
      };
      if (data.code !== "Ok" || !data.matchings || data.matchings.length === 0) {
        continue;
      }
      const matching = data.matchings[0];
      const matchCoords = matching.geometry.coordinates;
      // Skip first point of subsequent chunks to avoid duplicates
      const coordsToAdd = allCoords.length === 0 ? matchCoords : matchCoords.slice(1);
      allCoords.push(...coordsToAdd);
      totalConfidence += matching.confidence;
      chunkCount++;
    } catch (err) {
      console.error("Mapbox matching error:", err);
    }
  }

  if (allCoords.length < 2) return null;
  return {
    coordinates: allCoords,
    confidence: chunkCount > 0 ? totalConfidence / chunkCount : 0,
  };
}

async function matchRouteForEmployee(employeeId: string, date: string): Promise<MatchedRouteCacheEntry | null> {
  const key = cacheKey(employeeId, date);
  const cached = getCachedRoute(key);
  if (cached) return cached;

  const startOfDay = new Date(date + "T00:00:00.000Z");
  const endOfDay = new Date(date + "T23:59:59.999Z");

  const points = await db
    .select()
    .from(locationPointsTable)
    .where(
      and(
        eq(locationPointsTable.employeeId, employeeId),
        gte(locationPointsTable.recordedAt, startOfDay),
        lte(locationPointsTable.recordedAt, endOfDay)
      )
    )
    .orderBy(asc(locationPointsTable.recordedAt));

  if (points.length < 2) return null;

  const coords = points.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  const result = await callMapboxMatching(coords);
  if (!result) return null;

  const entry: MatchedRouteCacheEntry = {
    coordinates: result.coordinates,
    confidence: result.confidence,
    cachedAt: Date.now(),
  };
  setCachedRoute(key, entry.coordinates, entry.confidence);
  return entry;
}

// --- Background point processing trigger ---

const pendingMatchJobs = new Set<string>();

async function maybeTriggerMapMatching(employeeId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${employeeId}:${today}`;
  if (pendingMatchJobs.has(key)) return;

  // Check if there are 10+ unmatched points in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const startOfDay = new Date(today + "T00:00:00.000Z");
  const since = oneHourAgo > startOfDay ? oneHourAgo : startOfDay;

  const [countRes] = await db
    .select({ count: count() })
    .from(locationPointsTable)
    .where(
      and(
        eq(locationPointsTable.employeeId, employeeId),
        gte(locationPointsTable.recordedAt, since)
      )
    );

  const pointCount = countRes?.count ?? 0;
  if (pointCount >= 10) {
    pendingMatchJobs.add(key);
    // Run asynchronously; don't await
    matchRouteForEmployee(employeeId, today).finally(() => {
      pendingMatchJobs.delete(key);
    });
  }
}

// --- Geo helpers ---

const EARTH_RADIUS_METERS = 6_371_000;

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function pointInCircle(lat: number, lng: number, centerLat: number, centerLng: number, radiusMeters: number): boolean {
  return haversineDistance(lat, lng, centerLat, centerLng) <= radiusMeters;
}

function pointInPolygon(lat: number, lng: number, polygon: number[][][]): boolean {
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// --- Geofence engine ---

async function runGeofenceChecks(employeeId: string, lat: number, lng: number, locationPointId: number) {
  try {
    const zones = await db.select().from(zonesTable);
    for (const zone of zones) {
      let isInside = false;
      if (zone.type === "circle" && zone.centerLatitude != null && zone.centerLongitude != null && zone.radiusMeters != null) {
        isInside = pointInCircle(lat, lng, zone.centerLatitude, zone.centerLongitude, zone.radiusMeters);
      } else if (zone.type === "polygon" && zone.polygonGeoJson) {
        try {
          const geo = JSON.parse(zone.polygonGeoJson);
          if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
            isInside = pointInPolygon(lat, lng, geo.coordinates);
          }
        } catch {
          // ignore invalid geojson
        }
      }

      const openVisits = await db
        .select()
        .from(zoneVisitsTable)
        .where(
          and(
            eq(zoneVisitsTable.zoneId, zone.id),
            eq(zoneVisitsTable.employeeId, employeeId),
            isNull(zoneVisitsTable.exitedAt)
          )
        );

      if (isInside && openVisits.length === 0) {
        await db.insert(zoneVisitsTable).values({
          zoneId: zone.id,
          employeeId,
          enteredAt: new Date(),
          locationPointId,
        });
      } else if (!isInside && openVisits.length > 0) {
        await db
          .update(zoneVisitsTable)
          .set({ exitedAt: new Date() })
          .where(eq(zoneVisitsTable.id, openVisits[0].id));
      }
    }
  } catch (err) {
    console.error("Geofence check error:", err);
  }
}

// --- Activity classification ---

function classifyActivity(speedKmh: number | null | undefined): string {
  if (speedKmh == null) return "unknown";
  if (speedKmh > 15) return "driving";
  if (speedKmh > 2) return "walking";
  return "stationary";
}

// --- Stop detection engine ---

const STOP_CONFIGS = [
  { radiusM: 20,  minDurationMs: 60_000,       type: "micro" as const },
  { radiusM: 30,  minDurationMs: 5 * 60_000,   type: "short" as const },
  { radiusM: 50,  minDurationMs: 15 * 60_000,  type: "long" as const },
  { radiusM: 100, minDurationMs: 60 * 60_000,  type: "overnight" as const },
];

async function detectAndUpdateStops(employeeId: string): Promise<void> {
  try {
    // Get today's points for this employee
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const points = await db
      .select()
      .from(locationPointsTable)
      .where(
        and(
          eq(locationPointsTable.employeeId, employeeId),
          gte(locationPointsTable.recordedAt, today)
        )
      )
      .orderBy(asc(locationPointsTable.recordedAt));

    if (points.length < 2) return;

    // Find clusters within each config radius
    for (const config of STOP_CONFIGS) {
      let i = 0;
      while (i < points.length) {
        const anchor = points[i];
        let endIdx = i;

        for (let j = i + 1; j < points.length; j++) {
          const dist = haversineDistance(
            anchor.latitude, anchor.longitude,
            points[j].latitude, points[j].longitude
          );
          if (dist > config.radiusM) break;
          endIdx = j;
        }

        if (endIdx > i) {
          const startMs = new Date(points[i].recordedAt).getTime();
          const endMs = new Date(points[endIdx].recordedAt).getTime();
          const durationMs = endMs - startMs;

          if (durationMs >= config.minDurationMs) {
            // Calculate centroid
            const cluster = points.slice(i, endIdx + 1);
            const centroid = {
              lat: cluster.reduce((s, p) => s + p.latitude, 0) / cluster.length,
              lng: cluster.reduce((s, p) => s + p.longitude, 0) / cluster.length,
            };

            // Check for existing stop that overlaps
            const existing = await db
              .select()
              .from(stopsTable)
              .where(
                and(
                  eq(stopsTable.employeeId, employeeId),
                  gte(stopsTable.startAt, new Date(startMs - config.minDurationMs)),
                  lte(stopsTable.startAt, new Date(endMs + config.minDurationMs))
                )
              )
              .orderBy(asc(stopsTable.startAt))
              .limit(1);

            if (existing.length === 0) {
              await db.insert(stopsTable).values({
                employeeId,
                startAt: new Date(startMs),
                endAt: new Date(endMs),
                latitude: centroid.lat,
                longitude: centroid.lng,
                radiusMeters: config.radiusM,
                durationMs,
                stopType: config.type,
              });
            } else {
              // Update existing stop if this one is more specific (smaller radius)
              const ex = existing[0];
              if (ex.radiusMeters > config.radiusM) {
                await db
                  .update(stopsTable)
                  .set({
                    endAt: new Date(endMs),
                    durationMs: durationMs + (ex.durationMs ?? 0),
                    stopType: config.type,
                    radiusMeters: config.radiusM,
                    latitude: centroid.lat,
                    longitude: centroid.lng,
                  })
                  .where(eq(stopsTable.id, ex.id));
              } else if (new Date(endMs) > (ex.endAt ?? new Date(0))) {
                await db
                  .update(stopsTable)
                  .set({
                    endAt: new Date(endMs),
                    durationMs: new Date(endMs).getTime() - new Date(ex.startAt).getTime(),
                  })
                  .where(eq(stopsTable.id, ex.id));
              }
            }
          }
          i = endIdx + 1;
        } else {
          i++;
        }
      }
    }
  } catch (err) {
    console.error("Stop detection error:", err);
  }
}

// Track location - legacy single-point endpoint
router.post("/location/track", authenticate, async (req: AuthRequest, res) => {
  try {
    const { latitude, longitude, accuracy, speedKmh, heading, altitude, batteryLevel, activityType, recordedAt } = req.body as {
      latitude?: unknown;
      longitude?: unknown;
      accuracy?: unknown;
      speedKmh?: unknown;
      heading?: unknown;
      altitude?: unknown;
      batteryLevel?: unknown;
      activityType?: unknown;
      recordedAt?: unknown;
    };
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (latitude == null || longitude == null || isNaN(lat) || isNaN(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: "Valid latitude (-90..90) and longitude (-180..180) are required" });
      return;
    }
    const [point] = await db.insert(locationPointsTable).values({
      employeeId: req.user!.id,
      latitude: lat,
      longitude: lng,
      accuracy: accuracy != null ? Number(accuracy) : null,
      speedKmh: speedKmh != null ? Number(speedKmh) : null,
      heading: heading != null ? Number(heading) : null,
      altitude: altitude != null ? Number(altitude) : null,
      batteryLevel: batteryLevel != null ? Number(batteryLevel) : null,
      activityType: typeof activityType === "string" ? activityType : classifyActivity(Number(speedKmh)),
      recordedAt: recordedAt && typeof recordedAt === "string" ? new Date(recordedAt) : new Date(),
    }).returning();

    runGeofenceChecks(req.user!.id, lat, lng, point.id).catch(() => {});
    maybeTriggerMapMatching(req.user!.id).catch(() => {});
    detectAndUpdateStops(req.user!.id).catch(() => {});

    res.status(201).json({ ...point, recordedAt: point.recordedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Batch track location
router.post("/location/track-batch", authenticate, async (req: AuthRequest, res) => {
  try {
    const { points } = req.body as {
      points?: Array<{
        latitude?: unknown;
        longitude?: unknown;
        accuracy?: unknown;
        speedKmh?: unknown;
        heading?: unknown;
        altitude?: unknown;
        batteryLevel?: unknown;
        activityType?: unknown;
        source?: unknown;
        recordedAt?: unknown;
      }>;
    };

    if (!Array.isArray(points) || points.length === 0) {
      res.status(400).json({ error: "points array is required" });
      return;
    }

    const values = points
      .map((p) => {
        const lat = Number(p.latitude);
        const lng = Number(p.longitude);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return null;
        }
        return {
          employeeId: req.user!.id,
          latitude: lat,
          longitude: lng,
          accuracy: p.accuracy != null ? Number(p.accuracy) : null,
          speedKmh: p.speedKmh != null ? Number(p.speedKmh) : null,
          heading: p.heading != null ? Number(p.heading) : null,
          altitude: p.altitude != null ? Number(p.altitude) : null,
          batteryLevel: p.batteryLevel != null ? Number(p.batteryLevel) : null,
          activityType: typeof p.activityType === "string" ? p.activityType : classifyActivity(Number(p.speedKmh)),
          source: typeof p.source === "string" ? p.source : "background",
          recordedAt: p.recordedAt && typeof p.recordedAt === "string" ? new Date(p.recordedAt) : new Date(),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (values.length === 0) {
      res.status(400).json({ error: "No valid points" });
      return;
    }

    const inserted = await db.insert(locationPointsTable).values(values).returning();

    // Run async tasks on last point
    const last = inserted[inserted.length - 1];
    if (last) {
      runGeofenceChecks(req.user!.id, last.latitude, last.longitude, last.id).catch(() => {});
      detectAndUpdateStops(req.user!.id).catch(() => {});
    }

    res.status(201).json({
      inserted: inserted.length,
      lastRecordedAt: last?.recordedAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Heartbeat endpoint for background-fetch
router.post("/location/heartbeat", authenticate, async (req: AuthRequest, res) => {
  try {
    const { trackerState, platform } = req.body as { trackerState?: string; platform?: string };
    res.status(200).json({
      ok: true,
      serverTime: new Date().toISOString(),
      trackerState: trackerState ?? "unknown",
      platform: platform ?? "unknown",
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// View trail: admin/manager can view any employee; employees can only view their own
router.get("/location/trail", authenticate, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.id;
    const requestedEmployeeId = String(req.query.employeeId ?? "");
    const date = String(req.query.date ?? "");
    const matchRoads = req.query.matchRoads === "true" || req.query.matchRoads === "1";

    if (!requestedEmployeeId) {
      res.status(400).json({ error: "employeeId is required" });
      return;
    }
    if (!date || !isValidDate(date)) {
      res.status(400).json({ error: "date is required and must be in YYYY-MM-DD format" });
      return;
    }

    // Employees can only view their own trail
    if (role === "employee" && requestedEmployeeId !== (userId as string)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const startOfDay = new Date(date + "T00:00:00.000Z");
    const endOfDay = new Date(date + "T23:59:59.999Z");

    const points = await db
      .select()
      .from(locationPointsTable)
      .where(
        and(
          eq(locationPointsTable.employeeId, requestedEmployeeId as string),
          gte(locationPointsTable.recordedAt, startOfDay),
          lte(locationPointsTable.recordedAt, endOfDay)
        )
      )
      .orderBy(asc(locationPointsTable.recordedAt));

    const response: {
      points: ReturnType<typeof formatPoint>[];
      matchedRoute: number[][] | null;
      matchConfidence: number | null;
      matchPending: boolean;
    } = {
      points: points.map(formatPoint),
      matchedRoute: null,
      matchConfidence: null,
      matchPending: false,
    };

    if (matchRoads && points.length >= 2) {
      const cached = getCachedRoute(cacheKey(requestedEmployeeId, date));
      if (cached) {
        response.matchedRoute = cached.coordinates;
        response.matchConfidence = cached.confidence;
        response.matchPending = false;
      } else {
        response.matchPending = true;
        // Kick off async matching; next request will get cached result
        matchRouteForEmployee(requestedEmployeeId, date).catch(() => {});
      }
    }

    res.json(response);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function formatPoint(p: typeof locationPointsTable.$inferSelect) {
  return { ...p, recordedAt: p.recordedAt.toISOString() };
}

// --- Stops API ---

// Get stops for an employee on a date
router.get("/location/stops", authenticate, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.id;
    const requestedEmployeeId = String(req.query.employeeId ?? "");
    const date = String(req.query.date ?? "");
    const type = String(req.query.type ?? "");

    if (!requestedEmployeeId) {
      res.status(400).json({ error: "employeeId is required" });
      return;
    }
    if (!date || !isValidDate(date)) {
      res.status(400).json({ error: "date is required" });
      return;
    }
    if (role === "employee" && requestedEmployeeId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const startOfDay = new Date(date + "T00:00:00.000Z");
    const endOfDay = new Date(date + "T23:59:59.999Z");

    let conditions = and(
      eq(stopsTable.employeeId, requestedEmployeeId),
      gte(stopsTable.startAt, startOfDay),
      lte(stopsTable.startAt, endOfDay)
    );

    if (type && ["micro", "short", "long", "overnight"].includes(type)) {
      conditions = and(conditions, eq(stopsTable.stopType, type));
    }

    const stops = await db
      .select()
      .from(stopsTable)
      .where(conditions)
      .orderBy(asc(stopsTable.startAt));

    res.json(stops.map((s) => ({
      ...s,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt?.toISOString() ?? null,
      createdAt: s.createdAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get today's activity summary for all employees (admin/manager)
router.get("/location/activity/today", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get latest point per employee with activity
    const result = await db.execute(sql`
      SELECT DISTINCT ON (lp.employee_id)
        lp.employee_id as "employeeId",
        u.name as "employeeName",
        lp.latitude,
        lp.longitude,
        lp.speed_kmh as "speedKmh",
        lp.activity_type as "activityType",
        lp.battery_level as "batteryLevel",
        lp.recorded_at as "recordedAt"
      FROM location_points lp
      JOIN users u ON u.id = lp.employee_id
      WHERE lp.recorded_at >= ${today}
      ORDER BY lp.employee_id, lp.recorded_at DESC
    `);

    res.json((result.rows as any[]).map((r) => ({
      ...r,
      recordedAt: r.recordedAt instanceof Date ? r.recordedAt.toISOString() : r.recordedAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /location/match-route
router.post("/location/match-route", authenticate, async (req: AuthRequest, res) => {
  try {
    const { employeeId, date, points } = req.body as {
      employeeId?: unknown;
      date?: unknown;
      points?: Array<{ lat?: unknown; lng?: unknown; timestamp?: unknown }>;
    };

    if (!employeeId || typeof employeeId !== "string") {
      res.status(400).json({ error: "employeeId is required" });
      return;
    }
    if (!date || typeof date !== "string" || !isValidDate(date)) {
      res.status(400).json({ error: "date is required and must be in YYYY-MM-DD format" });
      return;
    }
    if (!Array.isArray(points) || points.length < 2) {
      res.status(400).json({ error: "At least 2 points are required" });
      return;
    }

    // Role check: employees can only match their own routes
    if (req.user!.role === "employee" && employeeId !== req.user!.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const key = cacheKey(employeeId, date);
    const cached = getCachedRoute(key);
    if (cached) {
      res.json({ coordinates: cached.coordinates, confidence: cached.confidence });
      return;
    }

    const coords = points
      .map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
      }))
      .filter((c) => !isNaN(c.lat) && !isNaN(c.lng));

    const result = await callMapboxMatching(coords);
    if (!result) {
      res.status(502).json({ error: "Map matching failed" });
      return;
    }

    setCachedRoute(key, result.coordinates, result.confidence);
    res.json({ coordinates: result.coordinates, confidence: result.confidence });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// View all employees' latest locations today: admin/manager only
router.get("/location/employees/today", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    // FIX: Use UTC date string to build start-of-day in UTC, not local server time.
    // setHours(0,0,0,0) was using server local time which could be wrong on UTC-hosted servers.
    const todayStr = new Date().toISOString().slice(0, 10);
    const startOfDay = new Date(todayStr + "T00:00:00.000Z");

    const result = await db.execute(sql`
      SELECT DISTINCT ON (lp.employee_id)
        lp.employee_id as "employeeId",
        u.name as "employeeName",
        lp.latitude,
        lp.longitude,
        lp.recorded_at as "recordedAt"
      FROM location_points lp
      JOIN users u ON u.id = lp.employee_id
      WHERE lp.recorded_at >= ${startOfDay}
      ORDER BY lp.employee_id, lp.recorded_at DESC
    `);
    const rows = result.rows as EmployeeLocationRow[];
    res.json(rows.map(r => ({
      ...r,
      recordedAt: r.recordedAt instanceof Date ? r.recordedAt.toISOString() : r.recordedAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// View employees with location data for a specific date: admin/manager only
router.get("/location/employees/date", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const date = String(req.query.date ?? "");
    if (!date || !isValidDate(date)) {
      res.status(400).json({ error: "date is required and must be in YYYY-MM-DD format" });
      return;
    }

    const startOfDay = new Date(date + "T00:00:00.000Z");
    const endOfDay = new Date(date + "T23:59:59.999Z");

    const result = await db.execute(sql`
      SELECT DISTINCT ON (lp.employee_id)
        lp.employee_id as "employeeId",
        u.name as "employeeName",
        lp.latitude,
        lp.longitude,
        lp.recorded_at as "recordedAt"
      FROM location_points lp
      JOIN users u ON u.id = lp.employee_id
      WHERE lp.recorded_at >= ${startOfDay} AND lp.recorded_at <= ${endOfDay}
      ORDER BY lp.employee_id, lp.recorded_at DESC
    `);
    const rows = result.rows as EmployeeLocationRow[];
    res.json(rows.map(r => ({
      ...r,
      recordedAt: r.recordedAt instanceof Date ? r.recordedAt.toISOString() : r.recordedAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Zones CRUD ---

// List all zones
router.get("/location/zones", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const zones = await db.select().from(zonesTable).orderBy(desc(zonesTable.createdAt));
    res.json(zones.map(z => ({
      ...z,
      createdAt: z.createdAt ? z.createdAt.toISOString() : null,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a zone
router.post("/location/zones", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const { name, type, color, centerLatitude, centerLongitude, radiusMeters, polygonGeoJson } = req.body as {
      name?: unknown;
      type?: unknown;
      color?: unknown;
      centerLatitude?: unknown;
      centerLongitude?: unknown;
      radiusMeters?: unknown;
      polygonGeoJson?: unknown;
    };
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!type || (type !== "circle" && type !== "polygon")) {
      res.status(400).json({ error: "type must be 'circle' or 'polygon'" });
      return;
    }
    if (type === "circle") {
      const lat = Number(centerLatitude);
      const lng = Number(centerLongitude);
      const r = Number(radiusMeters);
      if (isNaN(lat) || isNaN(lng) || isNaN(r)) {
        res.status(400).json({ error: "centerLatitude, centerLongitude, and radiusMeters are required for circle zones" });
        return;
      }
    } else if (type === "polygon") {
      if (!polygonGeoJson || typeof polygonGeoJson !== "string") {
        res.status(400).json({ error: "polygonGeoJson is required for polygon zones" });
        return;
      }
      try {
        const geo = JSON.parse(polygonGeoJson);
        if (geo.type !== "Polygon") throw new Error("Invalid");
      } catch {
        res.status(400).json({ error: "polygonGeoJson must be a valid GeoJSON Polygon" });
        return;
      }
    }
    const [zone] = await db.insert(zonesTable).values({
      name,
      type,
      color: typeof color === "string" ? color : null,
      centerLatitude: centerLatitude != null ? Number(centerLatitude) : null,
      centerLongitude: centerLongitude != null ? Number(centerLongitude) : null,
      radiusMeters: radiusMeters != null ? Number(radiusMeters) : null,
      polygonGeoJson: typeof polygonGeoJson === "string" ? polygonGeoJson : null,
    }).returning();
    res.status(201).json({ ...zone, createdAt: zone.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a zone
router.put("/location/zones/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid zone id" });
      return;
    }
    const { name, type, color, centerLatitude, centerLongitude, radiusMeters, polygonGeoJson } = req.body as {
      name?: unknown;
      type?: unknown;
      color?: unknown;
      centerLatitude?: unknown;
      centerLongitude?: unknown;
      radiusMeters?: unknown;
      polygonGeoJson?: unknown;
    };
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!type || (type !== "circle" && type !== "polygon")) {
      res.status(400).json({ error: "type must be 'circle' or 'polygon'" });
      return;
    }
    if (type === "circle") {
      const lat = Number(centerLatitude);
      const lng = Number(centerLongitude);
      const r = Number(radiusMeters);
      if (isNaN(lat) || isNaN(lng) || isNaN(r)) {
        res.status(400).json({ error: "centerLatitude, centerLongitude, and radiusMeters are required for circle zones" });
        return;
      }
    } else if (type === "polygon") {
      if (!polygonGeoJson || typeof polygonGeoJson !== "string") {
        res.status(400).json({ error: "polygonGeoJson is required for polygon zones" });
        return;
      }
      try {
        const geo = JSON.parse(polygonGeoJson);
        if (geo.type !== "Polygon") throw new Error("Invalid");
      } catch {
        res.status(400).json({ error: "polygonGeoJson must be a valid GeoJSON Polygon" });
        return;
      }
    }
    const [zone] = await db
      .update(zonesTable)
      .set({
        name,
        type,
        color: typeof color === "string" ? color : null,
        centerLatitude: centerLatitude != null ? Number(centerLatitude) : null,
        centerLongitude: centerLongitude != null ? Number(centerLongitude) : null,
        radiusMeters: radiusMeters != null ? Number(radiusMeters) : null,
        polygonGeoJson: typeof polygonGeoJson === "string" ? polygonGeoJson : null,
      })
      .where(eq(zonesTable.id, id))
      .returning();
    if (!zone) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json({ ...zone, createdAt: zone.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a zone
router.delete("/location/zones/:id", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid zone id" });
      return;
    }
    const [zone] = await db.delete(zonesTable).where(eq(zonesTable.id, id)).returning();
    if (!zone) {
      res.status(404).json({ error: "Zone not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List zone visits for a zone
router.get("/location/zones/:id/visits", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const zoneId = Number(req.params.id);
    if (isNaN(zoneId)) {
      res.status(400).json({ error: "Invalid zone id" });
      return;
    }
    const visits = await db
      .select({
        id: zoneVisitsTable.id,
        zoneId: zoneVisitsTable.zoneId,
        employeeId: zoneVisitsTable.employeeId,
        enteredAt: zoneVisitsTable.enteredAt,
        exitedAt: zoneVisitsTable.exitedAt,
        locationPointId: zoneVisitsTable.locationPointId,
        employeeName: usersTable.name,
      })
      .from(zoneVisitsTable)
      .leftJoin(usersTable, eq(usersTable.id, zoneVisitsTable.employeeId))
      .where(eq(zoneVisitsTable.zoneId, zoneId))
      .orderBy(desc(zoneVisitsTable.enteredAt));
    res.json(visits.map(v => ({
      ...v,
      enteredAt: v.enteredAt.toISOString(),
      exitedAt: v.exitedAt ? v.exitedAt.toISOString() : null,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List zone visits for an employee
router.get("/location/employees/:id/visits", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  try {
    const employeeId = req.params.id;
    if (!employeeId) {
      res.status(400).json({ error: "employeeId is required" });
      return;
    }
    const visits = await db
      .select({
        id: zoneVisitsTable.id,
        zoneId: zoneVisitsTable.zoneId,
        employeeId: zoneVisitsTable.employeeId,
        enteredAt: zoneVisitsTable.enteredAt,
        exitedAt: zoneVisitsTable.exitedAt,
        locationPointId: zoneVisitsTable.locationPointId,
        zoneName: zonesTable.name,
      })
      .from(zoneVisitsTable)
      .leftJoin(zonesTable, eq(zonesTable.id, zoneVisitsTable.zoneId))
      .where(eq(zoneVisitsTable.employeeId, String(employeeId)))
      .orderBy(desc(zoneVisitsTable.enteredAt));
    res.json(visits.map(v => ({
      ...v,
      enteredAt: v.enteredAt.toISOString(),
      exitedAt: v.exitedAt ? v.exitedAt.toISOString() : null,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
