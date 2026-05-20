import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const STATUS_COLORS: Record<string, string> = { new: "#3B82F6", follow_up: "#F59E0B", meeting_scheduled: "#8B5CF6", negotiation: "#06B6D4", closed_won: "#10B981", closed_lost: "#EF4444" };
const STATUS_LABELS: Record<string, string> = { new: "New", follow_up: "Follow Up", meeting_scheduled: "Meeting", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost" };
const PRIORITY_STYLE: Record<string, { color: string; bg: string }> = { hot: { color: "#991B1B", bg: "#FEE2E2" }, warm: { color: "#92400E", bg: "#FEF3C7" }, cold: { color: "#1E3A5F", bg: "#DBEAFE" } };

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => { fetchLeads(); }, []);

  async function fetchLeads() {
    setLoading(true);
    const { data } = await supabase.from("leads").select("id, name, phone, email, status, priority, source, budget, address, created_at, profiles!leads_employee_id_fkey(name)").order("created_at", { ascending: false }).limit(200);
    setLeads(data ?? []);
    setLoading(false);
  }

  const filtered = leads.filter(l => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.phone.includes(search)) return false;
    return true;
  });

  const statusCounts = leads.reduce((acc: Record<string, number>, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {});

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" style={{ letterSpacing: "-0.02em" }}>Leads</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{leads.length} total leads</p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status pills */}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setStatusFilter("all")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={statusFilter === "all" ? { background: "hsl(var(--primary))", color: "white" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            All ({leads.length})
          </button>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={statusFilter === k
                ? { background: STATUS_COLORS[k], color: "white" }
                : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {v} ({statusCounts[k] ?? 0})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 pl-9 pr-4 rounded-lg text-[13px] outline-none w-56"
            style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin w-7 h-7 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                {["Name", "Phone", "Status", "Priority", "Budget", "Assigned To", "Date"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">No leads found</td></tr>
              ) : filtered.map(l => {
                const p = PRIORITY_STYLE[l.priority ?? ""] ?? null;
                return (
                  <tr key={l.id} className="transition-colors hover:bg-muted/30" style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                          style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                          {l.name?.charAt(0) ?? "?"}
                        </div>
                        <span className="font-medium text-foreground">{l.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{l.phone}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold text-white"
                        style={{ background: STATUS_COLORS[l.status] ?? "#6B7280" }}>
                        {STATUS_LABELS[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {p && <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize"
                        style={{ background: p.bg, color: p.color }}>{l.priority}</span>}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{l.budget || "—"}</td>
                    <td className="py-3 px-4 text-muted-foreground">{(l.profiles as any)?.name ?? "—"}</td>
                    <td className="py-3 px-4 text-muted-foreground">{new Date(l.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}