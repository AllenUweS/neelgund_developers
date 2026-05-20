import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";

type Stats = {
  totalEmployees: number; totalLeads: number; checkedInToday: number; activeTrackers: number;
  leadsByStatus: Record<string, number>;
};

const STATUS_COLORS: Record<string, string> = {
  new: "#3B82F6", follow_up: "#F59E0B", meeting_scheduled: "#8B5CF6",
  negotiation: "#06B6D4", closed_won: "#10B981", closed_lost: "#EF4444",
};
const STATUS_LABELS: Record<string, string> = {
  new: "New", follow_up: "Follow Up", meeting_scheduled: "Meeting",
  negotiation: "Negotiation", closed_won: "Closed Won", closed_lost: "Closed Lost",
};

function StatCard({ label, value, icon, delta }: { label: string; value: number; icon: JSX.Element; delta?: string }) {
  return (
    <div className="bg-card rounded-xl p-5 flex flex-col gap-4" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--muted))" }}>
          {icon}
        </div>
        {delta && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#D1FAE5", color: "#065F46" }}>{delta}</span>}
      </div>
      <div>
        <p className="text-2xl font-semibold text-foreground" style={{ letterSpacing: "-0.03em" }}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchStats(); }, []);

  async function fetchStats() {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [empRes, leadRes, attRes, trackRes, recentRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("leads").select("id, status"),
      supabase.from("attendance").select("id", { count: "exact", head: true }).eq("date", today).not("check_in_time", "is", null),
      supabase.from("tracking_status").select("id", { count: "exact", head: true }).eq("tracker_state", "running"),
      supabase.from("leads").select("id, name, status, priority, created_at, profiles!leads_employee_id_fkey(name)").order("created_at", { ascending: false }).limit(8),
    ]);
    const leadsByStatus: Record<string, number> = {};
    (leadRes.data ?? []).forEach((l: any) => { leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1; });
    setStats({ totalEmployees: empRes.count ?? 0, totalLeads: leadRes.data?.length ?? 0, checkedInToday: attRes.count ?? 0, activeTrackers: trackRes.count ?? 0, leadsByStatus });
    setRecentLeads(recentRes.data ?? []);
    setLoading(false);
  }

  if (loading || !stats) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-7 h-7 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );

  const totalLeads = Object.values(stats.leadsByStatus).reduce((a, b) => a + b, 0) || 1;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="p-8 space-y-7 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">{dateStr}</p>
          <h1 className="text-2xl font-semibold text-foreground" style={{ letterSpacing: "-0.02em" }}>
            {greeting}, {user?.name?.split(" ")[0]}
          </h1>
        </div>
        <button onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={stats.totalEmployees}
          icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>}
        />
        <StatCard label="Total Leads" value={stats.totalLeads}
          icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="hsl(213,94%,48%)" strokeWidth="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
        />
        <StatCard label="Checked In Today" value={stats.checkedInToday}
          icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
        />
        <StatCard label="Active Trackers" value={stats.activeTrackers}
          icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>}
        />
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline */}
        <div className="bg-card rounded-xl p-6" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-semibold text-foreground mb-5">Lead Pipeline</h2>
          <div className="space-y-4">
            {Object.entries(stats.leadsByStatus).map(([status, count]) => (
              <div key={status}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{STATUS_LABELS[status] ?? status}</span>
                  <span className="text-xs font-semibold text-foreground">{count}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(count / totalLeads) * 100}%`, background: STATUS_COLORS[status] ?? "#6B7280" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Leads table */}
        <div className="lg:col-span-2 bg-card rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold text-foreground">Recent Leads</h2>
            <span className="text-xs text-muted-foreground">{recentLeads.length} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                  {["Lead", "Assigned To", "Status", "Priority"].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((l) => (
                  <tr key={l.id} className="transition-colors hover:bg-muted/40" style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
                    <td className="py-3 px-4 font-medium text-foreground">{l.name}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{(l.profiles as any)?.name ?? "—"}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium text-white"
                        style={{ background: STATUS_COLORS[l.status] ?? "#6B7280" }}>
                        {STATUS_LABELS[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {l.priority && (
                        <span className="text-[11px] font-semibold capitalize"
                          style={{ color: l.priority === "hot" ? "#EF4444" : l.priority === "warm" ? "#F59E0B" : "#3B82F6" }}>
                          {l.priority}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}