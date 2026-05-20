import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass !== confirmPass) { setStatus({ type: "error", msg: "Passwords do not match." }); return; }
    if (newPass.length < 8) { setStatus({ type: "error", msg: "Password must be at least 8 characters." }); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setLoading(false);
    if (error) setStatus({ type: "error", msg: error.message });
    else { setStatus({ type: "success", msg: "Password updated successfully." }); setNewPass(""); setConfirmPass(""); }
  };

  const initials = user?.name?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) ?? "?";

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground" style={{ letterSpacing: "-0.02em" }}>Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your account details</p>
      </div>

      {/* Identity card */}
      <div className="bg-card rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div className="h-20" style={{ background: "hsl(var(--primary))" }} />
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-8 mb-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-semibold flex-shrink-0"
              style={{ background: "hsl(var(--sidebar-primary))", color: "hsl(222 47% 11%)", boxShadow: "0 0 0 3px hsl(var(--card))" }}
            >
              {initials}
            </div>
            <div className="pb-1">
              <h2 className="text-base font-semibold text-foreground">{user?.name}</h2>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Role", value: user?.role?.replace(/_/g, " ") ?? "—" },
              { label: "Department", value: user?.department ?? "—" },
              { label: "User ID", value: user?.id?.slice(0, 12) + "…" ?? "—" },
              { label: "Access Level", value: user?.role === "super_admin" ? "Super Admin" : user?.role === "admin" ? "Administrator" : "HR" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg px-4 py-3" style={{ background: "hsl(var(--muted))" }}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm font-medium text-foreground capitalize">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-card rounded-xl p-6" style={{ border: "1px solid hsl(var(--border))", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--muted))" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Change Password</p>
            <p className="text-xs text-muted-foreground">Use at least 8 characters</p>
          </div>
        </div>

        {status && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
            style={status.type === "success"
              ? { background: "#D1FAE5", color: "#065F46" }
              : { background: "hsl(var(--destructive) / 0.08)", color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.2)" }}>
            {status.type === "success"
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
            {status.msg}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4">
          {[
            { label: "New Password", val: newPass, set: setNewPass, show: showNew, toggle: () => setShowNew(!showNew) },
            { label: "Confirm Password", val: confirmPass, set: setConfirmPass, show: showConfirm, toggle: () => setShowConfirm(!showConfirm) },
          ].map(({ label, val, set, show, toggle }) => (
            <div key={label}>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">{label}</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  value={val}
                  onChange={e => set(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  required
                  className="w-full h-11 px-4 pr-11 rounded-lg text-sm outline-none transition-all"
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--primary))")}
                  onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
                />
                <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {show
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity"
              style={{ background: "hsl(var(--primary))", color: "white", opacity: loading ? 0.7 : 1 }}>
              {loading ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? "Updating…" : "Update Password"}
            </button>
          </div>
        </form>
      </div>

      {/* Sign out */}
      <div className="bg-card rounded-xl p-6" style={{ border: "1px solid hsl(var(--border))" }}>
        <p className="text-sm font-semibold text-foreground mb-1">Sign Out</p>
        <p className="text-xs text-muted-foreground mb-4">You will be logged out of this session.</p>
        <button onClick={signOut}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: "hsl(var(--destructive) / 0.08)", color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.2)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}