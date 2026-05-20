import { useState } from "react";
import { useAuth } from "../App";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await signIn(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12"
        style={{ background: "hsl(var(--sidebar))" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
            style={{ background: "hsl(var(--sidebar-primary))", color: "hsl(222 47% 11%)" }}
          >
            N
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>Neelgund Developers</p>
            <p className="text-[10px] tracking-widest uppercase opacity-40" style={{ color: "hsl(var(--sidebar-foreground))" }}>Property & CRM</p>
          </div>
        </div>

        {/* Centre copy */}
        <div>
          <h1
            className="text-4xl leading-tight mb-4"
            style={{ fontFamily: "'DM Serif Display', serif", color: "hsl(var(--sidebar-accent-foreground))" }}
          >
            Manage your<br />
            <span style={{ color: "hsl(var(--sidebar-primary))" }}>field teams</span><br />
            & leads.
          </h1>
          <p className="text-[13px] leading-relaxed max-w-xs" style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.6 }}>
            Real-time location tracking, lead pipeline management, and attendance — all in one place.
          </p>
        </div>

        {/* Bottom label */}
        <p className="text-[11px] opacity-30" style={{ color: "hsl(var(--sidebar-foreground))" }}>© 2026 Neelgund Developers</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-10">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
              style={{ background: "hsl(var(--primary))", color: "white" }}
            >N</div>
            <p className="text-[15px] font-semibold text-foreground">Neelgund Developers</p>
          </div>

          <h2 className="text-2xl font-semibold text-foreground mb-1" style={{ letterSpacing: "-0.02em" }}>Welcome back</h2>
          <p className="text-sm text-muted-foreground mb-8">Sign in to your admin account</p>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 px-4 py-3 rounded-lg text-sm"
              style={{ background: "hsl(var(--destructive) / 0.07)", color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.2)" }}>
              <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@neelgund.com"
                required
                className="w-full h-11 px-4 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 transition-all outline-none"
                style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--primary))")}
                onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-foreground mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full h-11 px-4 pr-11 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 transition-all outline-none"
                  style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--primary))")}
                  onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
                />
                <button type="button" onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {show
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg text-sm font-semibold transition-all mt-2"
              style={{ background: "hsl(var(--primary))", color: "white", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}