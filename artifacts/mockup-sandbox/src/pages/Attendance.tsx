import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AttendancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { fetchAttendance(); }, [dateFilter]);

  async function fetchAttendance() {
    setLoading(true);
    const { data } = await supabase.from("attendance").select("id, date, check_in_time, check_out_time, status, profiles!attendance_employee_id_fkey(name, department)").eq("date", dateFilter).order("check_in_time", { ascending: true });
    setRecords(data ?? []);
    setLoading(false);
  }

  const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    on_time:  { bg: "#D1FAE5", text: "#065F46", label: "On Time" },
    late:     { bg: "#FEF3C7", text: "#92400E", label: "Late" },
    half_day: { bg: "#FFEDD5", text: "#9A3412", label: "Half Day" },
    absent:   { bg: "#FEE2E2", text: "#991B1B", label: "Absent" },
  };

  const fmtTime = (t: string | null) => t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
  const summary = { total: records.length, onTime: records.filter(r => r.status === "on_time").length, late: records.filter(r => r.status === "late").length, out: records.filter(r => r.check_out_time).length };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" style={{ letterSpacing: "-0.02em" }}>Attendance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Daily attendance records</p>
        </div>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="h-10 px-4 rounded-lg text-sm outline-none"
          style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: summary.total, color: "#3B82F6" },
          { label: "On Time", value: summary.onTime, color: "#10B981" },
          { label: "Late", value: summary.late, color: "#F59E0B" },
          { label: "Checked Out", value: summary.out, color: "#8B5CF6" },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl px-5 py-4 flex items-center gap-4"
            style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <div>
              <p className="text-xl font-semibold text-foreground" style={{ letterSpacing: "-0.02em" }}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin w-7 h-7 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                {["Employee", "Department", "Check In", "Check Out", "Status"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-sm text-muted-foreground">No records for this date</td></tr>
              ) : records.map(r => {
                const s = STATUS_STYLE[r.status ?? ""] ?? { bg: "#F3F4F6", text: "#374151", label: r.status ?? "—" };
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30" style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                          style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                          {(r.profiles as any)?.name?.charAt(0) ?? "?"}
                        </div>
                        <span className="font-medium text-foreground">{(r.profiles as any)?.name ?? "Unknown"}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground capitalize">{(r.profiles as any)?.department ?? "—"}</td>
                    <td className="py-3 px-4 text-muted-foreground">{fmtTime(r.check_in_time)}</td>
                    <td className="py-3 px-4 text-muted-foreground">{fmtTime(r.check_out_time)}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold"
                        style={{ background: s.bg, color: s.text }}>{s.label}</span>
                    </td>
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