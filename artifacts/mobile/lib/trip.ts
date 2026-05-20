import type { LocationPoint, ActivityType } from "@/lib/types";
import { isFiniteCoord } from "@/lib/mapGeo";

export type TripPoint = LocationPoint;

export type StopType = "micro" | "short" | "long" | "overnight";

export type TripStop = {
  id: string;
  number: number;
  startIndex: number;
  endIndex: number;
  startAt: string;
  endAt: string;
  durationMs: number;
  latitude: number;
  longitude: number;
  address?: string | null;
  stopType: StopType;
};

export type TripDriveSegment = {
  id: string;
  type: "driving";
  startIndex: number;
  endIndex: number;
  startAt: string;
  endAt: string;
  durationMs: number;
  distanceMeters: number;
  startAddress?: string | null;
  endAddress?: string | null;
};

export type TripGapSegment = {
  id: string;
  type: "gap";
  startAt: string;
  endAt: string;
  durationMs: number;
};

export type TripStopSegment = TripStop & { type: "stop" };
export type TripTimelineItem = TripDriveSegment | TripStopSegment | TripGapSegment;

export type TripGap = {
  startAt: string;
  endAt: string;
  durationMs: number;
};

export type TripSummary = {
  points: TripPoint[];
  stops: TripStop[];
  timeline: TripTimelineItem[];
  distanceMeters: number;
  durationMs: number;
  drivingDurationMs: number;
  stoppedDurationMs: number;
  gapDurationMs: number;
  gaps: TripGap[];
  firstAt: string | null;
  lastAt: string | null;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  currentMovement: "moving" | "stopped" | "unknown";
  microStops: number;
  shortStops: number;
  longStops: number;
  overnightStops: number;
  idleTimeMs: number;
  drivingTimeMs: number;
  avgMovingSpeedKmh: number;
  activityBreakdown: Record<ActivityType, number>;
};

const STOP_CONFIGS = [
  { radiusM: 20,  minDurationMs: 60_000,       type: "micro" as const },
  { radiusM: 30,  minDurationMs: 5 * 60_000,   type: "short" as const },
  { radiusM: 50,  minDurationMs: 15 * 60_000,  type: "long" as const },
  { radiusM: 100, minDurationMs: 60 * 60_000,  type: "overnight" as const },
];

export function speedColor(speedKmh: number): string {
  if (speedKmh <= 2)  return "#EF4444"; // red - stopped
  if (speedKmh <= 15) return "#F59E0B"; // yellow - slow
  if (speedKmh <= 60) return "#10B981"; // green - normal
  return "#3B82F6";                     // blue - fast
}

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const earthRadius = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function classifyActivityFromSpeed(speedKmh: number | null | undefined): ActivityType {
  if (speedKmh == null) return "unknown";
  if (speedKmh > 15) return "driving";
  if (speedKmh > 2) return "walking";
  return "stationary";
}

export function deriveTripSummary(trail: LocationPoint[]): TripSummary {
  const points = trail
    .filter((p) => isFiniteCoord(p.latitude, p.longitude) && Number.isFinite(new Date(p.recordedAt).getTime()))
    .slice()
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  const distanceMeters = totalDistance(points);
  const firstAt = points[0]?.recordedAt ?? null;
  const lastAt = points[points.length - 1]?.recordedAt ?? null;
  const durationMs = firstAt && lastAt ? Math.max(0, new Date(lastAt).getTime() - new Date(firstAt).getTime()) : 0;
  const stops = detectStops(points);
  const stoppedDurationMs = stops.reduce((sum, stop) => sum + stop.durationMs, 0);
  const gaps = detectGaps(points);
  const gapDurationMs = gaps.reduce((sum, gap) => sum + gap.durationMs, 0);
  const timeline = buildTimeline(points, stops);
  const drivingDurationMs = Math.max(0, durationMs - stoppedDurationMs - gapDurationMs);
  const { avgSpeedKmh, maxSpeedKmh, avgMovingSpeedKmh } = calculateSpeeds(points, drivingDurationMs);
  const currentMovement = detectCurrentMovement(points);
  const activityBreakdown = calculateActivityBreakdown(points);
  const idleTimeMs = activityBreakdown.stationary * 1000;
  const drivingTimeMs = activityBreakdown.driving * 1000;

  return {
    points,
    stops,
    timeline,
    distanceMeters,
    durationMs,
    drivingDurationMs,
    stoppedDurationMs,
    gapDurationMs,
    gaps,
    firstAt,
    lastAt,
    avgSpeedKmh,
    maxSpeedKmh,
    currentMovement,
    microStops: stops.filter((s) => s.stopType === "micro").length,
    shortStops: stops.filter((s) => s.stopType === "short").length,
    longStops: stops.filter((s) => s.stopType === "long").length,
    overnightStops: stops.filter((s) => s.stopType === "overnight").length,
    idleTimeMs,
    drivingTimeMs,
    avgMovingSpeedKmh,
    activityBreakdown,
  };
}

function detectStops(points: TripPoint[]): TripStop[] {
  const stops: TripStop[] = [];

  // Try each config from most specific (micro) to least specific (overnight)
  // and collect stops. Then merge overlapping ones, keeping the most specific.
  for (const config of STOP_CONFIGS) {
    let index = 0;
    while (index < points.length - 1) {
      const anchor = points[index];
      let endIndex = index;

      for (let next = index + 1; next < points.length; next += 1) {
        if (haversineMeters(anchor, points[next]) > config.radiusM) break;
        endIndex = next;
      }

      if (endIndex > index) {
        const startMs = new Date(points[index].recordedAt).getTime();
        const endMs = new Date(points[endIndex].recordedAt).getTime();
        const durationMs = endMs - startMs;

        if (durationMs >= config.minDurationMs) {
          const cluster = points.slice(index, endIndex + 1);
          const center = cluster.reduce(
            (acc, point) => ({
              latitude: acc.latitude + point.latitude,
              longitude: acc.longitude + point.longitude,
            }),
            { latitude: 0, longitude: 0 },
          );
          const addressPoint = cluster.find((point) => point.address);

          // Check if this overlaps with an already-detected stop
          const overlap = stops.find((s) => {
            const sStart = new Date(s.startAt).getTime();
            const sEnd = new Date(s.endAt).getTime();
            return (
              (startMs >= sStart && startMs <= sEnd) ||
              (endMs >= sStart && endMs <= sEnd) ||
              (startMs <= sStart && endMs >= sEnd)
            );
          });

          if (!overlap) {
            stops.push({
              id: `stop-${stops.length + 1}`,
              number: stops.length + 1,
              startIndex: index,
              endIndex,
              startAt: points[index].recordedAt,
              endAt: points[endIndex].recordedAt,
              durationMs,
              latitude: center.latitude / cluster.length,
              longitude: center.longitude / cluster.length,
              address: addressPoint?.address ?? null,
              stopType: config.type,
            });
          }
          index = endIndex + 1;
          continue;
        }
      }
      index += 1;
    }
  }

  // Re-number and sort by time
  stops.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  stops.forEach((s, i) => { s.number = i + 1; s.id = `stop-${i + 1}`; });
  return stops;
}

function buildTimeline(points: TripPoint[], stops: TripStop[]): TripTimelineItem[] {
  const timeline: TripTimelineItem[] = [];
  if (points.length === 0) return timeline;

  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — matches stop-detection minimum

  function addGapIfNeeded(prevEndAt: string, nextStartAt: string) {
    const gap = new Date(nextStartAt).getTime() - new Date(prevEndAt).getTime();
    if (gap > GAP_THRESHOLD_MS) {
      timeline.push({
        id: `gap-${timeline.length}`,
        type: "gap",
        startAt: prevEndAt,
        endAt: nextStartAt,
        durationMs: gap,
      });
    }
  }

  let cursor = 0;
  for (const stop of stops) {
    if (stop.startIndex > cursor) {
      const drive = makeDriveSegment(points, cursor, stop.startIndex);
      timeline.push(drive);
      addGapIfNeeded(drive.endAt, stop.startAt);
    }
    timeline.push({ ...stop, type: "stop" });
    cursor = Math.min(stop.endIndex + 1, points.length - 1);
  }

  if (cursor < points.length - 1) {
    timeline.push(makeDriveSegment(points, cursor, points.length - 1));
  }

  return timeline.filter((item) => {
    if (item.type === "gap") return true;
    if (item.type === "stop") return true;
    return item.distanceMeters > 1 || item.durationMs > 0;
  });
}

function makeDriveSegment(points: TripPoint[], startIndex: number, endIndex: number): TripDriveSegment {
  const startAt = points[startIndex].recordedAt;
  const endAt = points[endIndex].recordedAt;
  const startPoint = points[startIndex];
  const endPoint = points[endIndex];
  return {
    id: `drive-${startIndex}-${endIndex}`,
    type: "driving",
    startIndex,
    endIndex,
    startAt,
    endAt,
    durationMs: Math.max(0, new Date(endAt).getTime() - new Date(startAt).getTime()),
    distanceMeters: totalDistance(points.slice(startIndex, endIndex + 1)),
    startAddress: startPoint?.address ?? null,
    endAddress: endPoint?.address ?? null,
  };
}

function totalDistance(points: TripPoint[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    meters += haversineMeters(points[i - 1], points[i]);
  }
  return meters;
}

function calculateSpeeds(points: TripPoint[], drivingDurationMs: number): { avgSpeedKmh: number; maxSpeedKmh: number; avgMovingSpeedKmh: number } {
  if (points.length < 2 || drivingDurationMs <= 0) {
    return { avgSpeedKmh: 0, maxSpeedKmh: 0, avgMovingSpeedKmh: 0 };
  }
  const avgSpeedKmh = (totalDistance(points) / 1000) / (drivingDurationMs / 3600000);

  let maxSpeedKmh = 0;
  let movingDistance = 0;
  let movingTimeMs = 0;

  for (let i = 1; i < points.length; i += 1) {
    const dist = haversineMeters(points[i - 1], points[i]);
    const timeMs = new Date(points[i].recordedAt).getTime() - new Date(points[i - 1].recordedAt).getTime();
    if (timeMs > 0) {
      const speedKmh = (dist / 1000) / (timeMs / 3600000);
      if (speedKmh > maxSpeedKmh && speedKmh < 200) {
        maxSpeedKmh = speedKmh;
      }
      if (speedKmh > 2) {
        movingDistance += dist;
        movingTimeMs += timeMs;
      }
    }
  }

  const avgMovingSpeedKmh = movingTimeMs > 0 ? (movingDistance / 1000) / (movingTimeMs / 3600000) : 0;

  return {
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
    avgMovingSpeedKmh: Math.round(avgMovingSpeedKmh * 10) / 10,
  };
}

function calculateActivityBreakdown(points: TripPoint[]): Record<ActivityType, number> {
  const breakdown: Record<ActivityType, number> = { driving: 0, walking: 0, stationary: 0, unknown: 0 };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const activity = p.activityType ?? classifyActivityFromSpeed(p.speedKmh);
    breakdown[activity]++;
  }
  return breakdown;
}

function detectGaps(points: TripPoint[]): TripGap[] {
  const gaps: TripGap[] = [];
  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — matches stop-detection minimum
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const gap = new Date(curr.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
    if (gap > GAP_THRESHOLD_MS) {
      gaps.push({ startAt: prev.recordedAt, endAt: curr.recordedAt, durationMs: gap });
    }
  }
  return gaps;
}

function detectCurrentMovement(points: TripPoint[]): "moving" | "stopped" | "unknown" {
  if (points.length < 2) return "unknown";
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  const timeGap = new Date(last.recordedAt).getTime() - new Date(secondLast.recordedAt).getTime();
  const dist = haversineMeters(secondLast, last);
  // If last update was > 15 min ago, assume unknown/stopped
  if (timeGap > 15 * 60 * 1000) return "stopped";
  // If moved > 50m in last interval, consider moving
  return dist > 50 ? "moving" : "stopped";
}