import { useState } from "react";
import { Download, FileText, Calendar } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

interface DailyReportProps {
  employeeId: string;
  employeeName: string;
  date: string;
}

interface ReportData {
  employeeName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  totalDurationMs: number;
  totalDistanceMeters: number;
  drivingTimeMs: number;
  idleTimeMs: number;
  microStops: number;
  shortStops: number;
  longStops: number;
  overnightStops: number;
  avgMovingSpeedKmh: number;
  maxSpeedKmh: number;
  stops: Array<{
    startAt: string;
    durationMs: number;
    stopType: string;
    address: string | null;
    latitude: number;
    longitude: number;
  }>;
  zoneVisits: Array<{
    zoneName: string;
    enteredAt: string;
    exitedAt: string | null;
    durationMs: number;
  }>;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function DailyReport({ employeeId, employeeName, date }: DailyReportProps) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  async function generateReport() {
    setLoading(true);
    try {
      // Fetch trail
      const trailRes = (await customFetch(
        `/api/location/trail?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}`
      )) as any;
      const points = trailRes.points ?? [];

      // Fetch stops
      const stopsRes = (await customFetch(
        `/api/location/stops?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}`
      )) as any[];

      // Fetch zone visits
      const visitsRes = (await customFetch(
        `/api/location/employees/${encodeURIComponent(employeeId)}/visits`
      )) as any[];

      const startOfDay = new Date(date + "T00:00:00.000Z").getTime();
      const endOfDay = new Date(date + "T23:59:59.999Z").getTime();
      const dayVisits = visitsRes.filter((v) => {
        const t = new Date(v.enteredAt).getTime();
        return t >= startOfDay && t <= endOfDay;
      });

      // Calculate simple stats from points
      const speeds = points
        .map((p: any) => p.speedKmh)
        .filter((s: any) => typeof s === "number" && s > 0 && s < 200);
      const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
      const avgSpeed = speeds.length > 0 ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length : 0;

      let distance = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const R = 6371000;
        const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
        const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
        const h =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((a.latitude * Math.PI) / 180) *
            Math.cos((b.latitude * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        distance += R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      }

      const firstAt = points[0]?.recordedAt ?? null;
      const lastAt = points[points.length - 1]?.recordedAt ?? null;
      const totalMs = firstAt && lastAt ? new Date(lastAt).getTime() - new Date(firstAt).getTime() : 0;

      const microStops = stopsRes.filter((s) => s.stopType === "micro").length;
      const shortStops = stopsRes.filter((s) => s.stopType === "short").length;
      const longStops = stopsRes.filter((s) => s.stopType === "long").length;
      const overnightStops = stopsRes.filter((s) => s.stopType === "overnight").length;

      const drivingMs = points.reduce((sum: number, p: any, i: number) => {
        if (i === 0) return sum;
        const prev = points[i - 1];
        const gap = new Date(p.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
        const activity = p.activityType ?? "unknown";
        return sum + (activity === "driving" && gap > 0 && gap < 5 * 60 * 1000 ? gap : 0);
      }, 0);

      const idleMs = totalMs - drivingMs;

      setReport({
        employeeName,
        date,
        startTime: firstAt,
        endTime: lastAt,
        totalDurationMs: totalMs,
        totalDistanceMeters: distance,
        drivingTimeMs: drivingMs,
        idleTimeMs: idleMs,
        microStops,
        shortStops,
        longStops,
        overnightStops,
        avgMovingSpeedKmh: Math.round(avgSpeed * 10) / 10,
        maxSpeedKmh: Math.round(maxSpeed * 10) / 10,
        stops: stopsRes.map((s) => ({
          startAt: s.startAt,
          durationMs: s.durationMs ?? 0,
          stopType: s.stopType,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
        zoneVisits: dayVisits.map((v) => ({
          zoneName: v.zoneName ?? "Unknown",
          enteredAt: v.enteredAt,
          exitedAt: v.exitedAt,
          durationMs: v.exitedAt
            ? new Date(v.exitedAt).getTime() - new Date(v.enteredAt).getTime()
            : Date.now() - new Date(v.enteredAt).getTime(),
        })),
      });
    } catch (err) {
      console.error("Report generation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    if (!report) return;
    const rows = [
      ["Employee", report.employeeName],
      ["Date", report.date],
      ["Start Time", formatTime(report.startTime)],
      ["End Time", formatTime(report.endTime)],
      ["Total Duration", formatDuration(report.totalDurationMs)],
      ["Total Distance", `${(report.totalDistanceMeters / 1000).toFixed(2)} km`],
      ["Driving Time", formatDuration(report.drivingTimeMs)],
      ["Idle Time", formatDuration(report.idleTimeMs)],
      ["Micro Stops", String(report.microStops)],
      ["Short Stops", String(report.shortStops)],
      ["Long Stops", String(report.longStops)],
      ["Overnight Stops", String(report.overnightStops)],
      ["Avg Moving Speed", `${report.avgMovingSpeedKmh} km/h`],
      ["Max Speed", `${report.maxSpeedKmh} km/h`],
      [],
      ["Stops"],
      ["Time", "Duration", "Type", "Address", "Latitude", "Longitude"],
      ...report.stops.map((s) => [
        formatTime(s.startAt),
        formatDuration(s.durationMs),
        s.stopType,
        s.address ?? "",
        String(s.latitude),
        String(s.longitude),
      ]),
      [],
      ["Zone Visits"],
      ["Zone", "Entered", "Exited", "Duration"],
      ...report.zoneVisits.map((v) => [
        v.zoneName,
        formatTime(v.enteredAt),
        v.exitedAt ? formatTime(v.exitedAt) : "Still inside",
        formatDuration(v.durationMs),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-report-${employeeId}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Daily Report</h3>
        </div>
        <button
          onClick={generateReport}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Calendar className="w-3 h-3" />
          {loading ? "Generating..." : "Generate"}
        </button>
      </div>

      {report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Distance" value={`${(report.totalDistanceMeters / 1000).toFixed(2)} km`} />
            <StatCard label="Total Duration" value={formatDuration(report.totalDurationMs)} />
            <StatCard label="Driving Time" value={formatDuration(report.drivingTimeMs)} />
            <StatCard label="Idle Time" value={formatDuration(report.idleTimeMs)} />
            <StatCard label="Micro Stops" value={String(report.microStops)} />
            <StatCard label="Short Stops" value={String(report.shortStops)} />
            <StatCard label="Long Stops" value={String(report.longStops)} />
            <StatCard label="Overnight" value={String(report.overnightStops)} />
            <StatCard label="Avg Speed" value={`${report.avgMovingSpeedKmh} km/h`} />
            <StatCard label="Max Speed" value={`${report.maxSpeedKmh} km/h`} />
            <StatCard label="Start Time" value={formatTime(report.startTime)} />
            <StatCard label="End Time" value={formatTime(report.endTime)} />
          </div>

          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}
