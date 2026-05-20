import { useEffect, useState } from "react";
import { Download, Filter, MapPin, Clock } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

interface StopItem {
  id: number;
  employeeId: string;
  startAt: string;
  endAt: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  durationMs: number | null;
  stopType: "micro" | "short" | "long" | "overnight";
  address: string | null;
  zoneId: number | null;
  leadId: number | null;
}

interface StopLogProps {
  employeeId: string;
  date: string;
  onCenterMap?: (lat: number, lng: number) => void;
}

const TYPE_LABELS: Record<StopItem["stopType"], string> = {
  micro: "Micro",
  short: "Short",
  long: "Long",
  overnight: "Overnight",
};

const TYPE_COLORS: Record<StopItem["stopType"], string> = {
  micro: "bg-amber-100 text-amber-700",
  short: "bg-blue-100 text-blue-700",
  long: "bg-purple-100 text-purple-700",
  overnight: "bg-red-100 text-red-700",
};

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "-";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function StopLog({ employeeId, date, onCenterMap }: StopLogProps) {
  const [stops, setStops] = useState<StopItem[]>([]);
  const [filter, setFilter] = useState<StopItem["stopType"] | "all">("all");
  const [loading, setLoading] = useState(false);

  async function fetchStops() {
    if (!employeeId || !date) return;
    setLoading(true);
    try {
      const url = `/api/location/stops?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}`;
      const data = (await customFetch(url)) as StopItem[];
      setStops(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStops();
  }, [employeeId, date]);

  const filtered = filter === "all" ? stops : stops.filter((s) => s.stopType === filter);

  function exportCSV() {
    const rows = [
      ["Time", "Duration", "Type", "Address", "Latitude", "Longitude"],
      ...filtered.map((s) => [
        formatTime(s.startAt),
        formatDuration(s.durationMs),
        TYPE_LABELS[s.stopType],
        s.address ?? "",
        String(s.latitude),
        String(s.longitude),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stops-${employeeId}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col max-h-[400px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Stop Log</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as StopItem["stopType"] | "all")}
              className="text-xs bg-background border border-border rounded px-2 py-1"
            >
              <option value="all">All</option>
              <option value="micro">Micro (1-5m)</option>
              <option value="short">Short (5-15m)</option>
              <option value="long">Long (15-60m)</option>
              <option value="overnight">Overnight (60m+)</option>
            </select>
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:bg-accent transition-colors"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && stops.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading stops…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No stops found</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Duration</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Address</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((stop) => (
                <tr
                  key={stop.id}
                  className="border-b border-border/50 hover:bg-accent/30 cursor-pointer"
                  onClick={() => onCenterMap?.(stop.latitude, stop.longitude)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {formatTime(stop.startAt)}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDuration(stop.durationMs)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${TYPE_COLORS[stop.stopType]}`}>
                      {TYPE_LABELS[stop.stopType]}
                    </span>
                  </td>
                  <td className="px-3 py-2 truncate max-w-[200px]">
                    {stop.address ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCenterMap?.(stop.latitude, stop.longitude);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
