import Colors from "@/constants/colors";

const C = Colors.light;

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    new: C.brand,
    not_contacted: "#9CA3AF",
    follow_up: C.warning,
    meeting_scheduled: "#8B5CF6",
    negotiation: C.accent,
    closed_won: C.success,
    closed_lost: C.danger,
  };
  return map[status] ?? C.textSecondary;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    new: "New",
    not_contacted: "Not Contacted",
    follow_up: "Follow Up",
    meeting_scheduled: "Meeting",
    negotiation: "Negotiation",
    closed_won: "Won",
    closed_lost: "Lost",
  };
  return map[status] ?? status;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (dateStr === todayISODate()) return "Today";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short" });
}

export function calcDuration(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "";
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function totalHoursWorked(records: { checkInTime: string | null; checkOutTime: string | null }[]): string {
  let totalMs = 0;
  for (const r of records) {
    if (r.checkInTime && r.checkOutTime) {
      totalMs += new Date(r.checkOutTime).getTime() - new Date(r.checkInTime).getTime();
    }
  }
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISODate(): string {
  return localDateStr(new Date());
}

export function thisMonthLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function hhmmToIso(date: string, hhmm: string): string | null {
  if (!hhmm.trim()) return null;
  const clean = hhmm.trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = date.split("-").map(Number);
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return localDate.toISOString();
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && localDateStr(parsed) === date;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 5-minute window: matches the stop-detection threshold and the fleet-map
// live-status check so admins see a consistent "live" signal everywhere.
export const LIVE_THRESHOLD_MS = 5 * 60 * 1000;

export function isLive(lastPingAt?: string | null): boolean {
  if (!lastPingAt) return false;
  return Date.now() - new Date(lastPingAt).getTime() <= LIVE_THRESHOLD_MS;
}

export const PRIORITY_COLORS: Record<string, string> = {
  hot: C.danger,
  warm: C.warning,
  cold: C.brand,
};

export const PRIORITY_LABELS: Record<string, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  not_contacted: "Not Contacted",
  follow_up: "Follow Up",
  meeting_scheduled: "Meeting",
  negotiation: "Negotiation",
  closed_won: "Won",
  closed_lost: "Lost",
};

export const SOURCE_LABELS: Record<string, string> = {
  referral: "Referral",
  walk_in: "Walk-in",
  online: "Online",
  social: "Social",
  broker: "Broker",
  cold_call: "Cold Call",
  field_activity: "Field Activity",
};