import { useEffect, useState, useMemo } from "react";
import { Search, Eye, EyeOff, MapPin, Battery, Navigation, Pause, Gauge } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { EmployeeLocation } from "@workspace/api-client-react";

interface TrackerStatus {
  employee_id: string;
  tracker_state: string;
  last_ping_at: string | null;
}

interface ActivityRow {
  employeeId: string;
  employeeName: string;
  speedKmh: number | null;
  activityType: string | null;
  batteryLevel: number | null;
  recordedAt: string;
}

interface EmployeeSidebarProps {
  employees: EmployeeLocation[];
  trackerStatus: TrackerStatus[];
  visibleEmployeeIds: Set<string>;
  selectedEmployeeId?: string | null;
  onToggleVisibility: (id: string) => void;
  onSelectEmployee: (id: string) => void;
}

export default function EmployeeSidebar({
  employees,
  trackerStatus,
  visibleEmployeeIds,
  selectedEmployeeId,
  onToggleVisibility,
  onSelectEmployee,
}: EmployeeSidebarProps) {
  const [query, setQuery] = useState("");
  const [activityMap, setActivityMap] = useState<Record<string, ActivityRow>>({});

  async function fetchActivity() {
    try {
      const data = (await customFetch("/api/location/activity/today")) as ActivityRow[];
      const map: Record<string, ActivityRow> = {};
      data.forEach((row) => {
        map[row.employeeId] = row;
      });
      setActivityMap(map);
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    fetchActivity();
    const iv = setInterval(fetchActivity, 30000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return employees.filter((e) => e.employeeName.toLowerCase().includes(q));
  }, [employees, query]);

  const running = trackerStatus.filter((t) => t.tracker_state === "running").length;
  const stopped = trackerStatus.filter((t) => t.tracker_state === "stopped").length;

  const timeSince = (d: string | null) => {
    if (!d) return "Never";
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  function getStatusText(activity: ActivityRow | undefined): string {
    if (!activity) return "No data";
    const type = activity.activityType ?? "unknown";
    if (type === "stationary") return "Stopped";
    if (type === "walking") return "Walking";
    if (activity.speedKmh != null) return `Driving ${Math.round(activity.speedKmh)} km/h`;
    return "Driving";
  }

  function getStatusIcon(activity: ActivityRow | undefined) {
    if (!activity) return null;
    const type = activity.activityType ?? "unknown";
    if (type === "stationary") return <Pause className="w-3 h-3 text-red-500" />;
    if (type === "walking") return <Navigation className="w-3 h-3 text-amber-500" />;
    return <Gauge className="w-3 h-3 text-emerald-500" />;
  }

  return (
    <div className="w-[280px] bg-card border-r border-border flex flex-col h-full">
      <div className="p-4 border-b border-border space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-500/10 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-emerald-600">{running}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-red-600">{stopped}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Stopped</p>
          </div>
          <div className="bg-blue-500/10 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-blue-600">{trackerStatus.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees..."
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No employees found</div>
        ) : (
          filtered.map((emp) => {
            const id = String(emp.employeeId);
            const tracker = trackerStatus.find((t) => t.employee_id === id);
            const activity = activityMap[id];
            const isOnline = tracker?.tracker_state === "running";
            const isVisible = visibleEmployeeIds.has(id);
            const isSelected = selectedEmployeeId === id;

            return (
              <div
                key={id}
                className={`px-4 py-2.5 border-b border-border/50 cursor-pointer transition-colors ${
                  isSelected ? "bg-primary/10" : "hover:bg-accent/50"
                }`}
                onClick={() => onSelectEmployee(id)}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {emp.employeeName.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        isOnline ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{emp.employeeName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {getStatusIcon(activity)}
                      <p className="text-[11px] text-muted-foreground">{getStatusText(activity)}</p>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility(id);
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>

                  <MapPin className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* Mini stats row */}
                {activity && (
                  <div className="flex items-center gap-3 mt-1.5 ml-11">
                    {activity.batteryLevel != null && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Battery className="w-3 h-3" />
                        {activity.batteryLevel}%
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      {timeSince(tracker?.last_ping_at ?? null)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
