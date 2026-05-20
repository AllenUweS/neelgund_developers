import { useEffect, useState } from "react";
import { Activity, MapPin, Navigation, Pause } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

interface ActivityEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  type: "stopped" | "driving" | "walking" | "entered_zone" | "exited_zone";
  message: string;
  timestamp: string;
}

interface ActivityFeedProps {
  employeeId?: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function activityIcon(type: ActivityEvent["type"]) {
  switch (type) {
    case "stopped":
      return <Pause className="w-3.5 h-3.5 text-red-500" />;
    case "driving":
      return <Navigation className="w-3.5 h-3.5 text-emerald-500" />;
    case "walking":
      return <Activity className="w-3.5 h-3.5 text-amber-500" />;
    case "entered_zone":
    case "exited_zone":
      return <MapPin className="w-3.5 h-3.5 text-blue-500" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

export default function ActivityFeed({ employeeId }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchActivity() {
    setLoading(true);
    try {
      const url = employeeId
        ? `/api/location/activity/today?employeeId=${encodeURIComponent(employeeId)}`
        : "/api/location/activity/today";
      const data = (await customFetch(url)) as any[];
      // Transform raw points into activity events
      const mapped: ActivityEvent[] = data.map((item, idx) => {
        const activity = item.activityType ?? "unknown";
        let type: ActivityEvent["type"] = "driving";
        let message = "";
        if (activity === "stationary") {
          type = "stopped";
          message = `Stopped at "${item.address || "Unknown location"}"`;
        } else if (activity === "walking") {
          type = "walking";
          message = `Walking`;
        } else {
          type = "driving";
          const speed = item.speedKmh ? `${Math.round(item.speedKmh)} km/h` : "";
          message = speed ? `Driving ${speed}` : "Driving";
        }
        return {
          id: `${item.employeeId}-${idx}`,
          employeeId: item.employeeId,
          employeeName: item.employeeName ?? "Unknown",
          type,
          message,
          timestamp: item.recordedAt,
        };
      });
      setEvents(mapped.slice(0, 50));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchActivity();
    const iv = setInterval(fetchActivity, 10000);
    return () => clearInterval(iv);
  }, [employeeId]);

  return (
    <div className="w-[320px] bg-card border-l border-border flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Activity Feed</h3>
        <p className="text-xs text-muted-foreground">Live updates · refreshes every 10s</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && events.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading activity…</div>
        ) : events.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No activity today</div>
        ) : (
          events.map((evt) => (
            <div key={evt.id} className="flex items-start gap-2.5 px-3 py-2 border-b border-border/50">
              <div className="mt-0.5 shrink-0">{activityIcon(evt.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">
                  <span className="font-medium">{evt.employeeName}</span>{" "}
                  {evt.message}
                </p>
                <p className="text-[10px] text-muted-foreground">{timeAgo(evt.timestamp)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
