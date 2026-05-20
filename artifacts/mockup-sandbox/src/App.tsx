// import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
// import { supabase } from "./lib/supabase";
// import type { Session, User } from "@supabase/supabase-js";

// /* ─── Auth Context ─────────────────────────────────────────────────────── */

// type AppUser = {
//   id: string;
//   authId: string;
//   name: string;
//   email: string;
//   role: string;
//   department?: string;
// };

// type AuthCtx = {
//   session: Session | null;
//   user: AppUser | null;
//   loading: boolean;
//   signIn: (email: string, password: string) => Promise<string | null>;
//   signOut: () => Promise<void>;
// };

// const AuthContext = createContext<AuthCtx>({
//   session: null,
//   user: null,
//   loading: true,
//   signIn: async () => null,
//   signOut: async () => {},
// });

// export const useAuth = () => useContext(AuthContext);

// function AuthProvider({ children }: { children: ReactNode }) {
//   const [session, setSession] = useState<Session | null>(null);
//   const [user, setUser] = useState<AppUser | null>(null);
//   const [loading, setLoading] = useState(true);

//   async function fetchProfile(authUser: User) {
//     const { data } = await supabase
//       .from("profiles")
//       .select("id, name, email, role, department")
//       .eq("id", authUser.id)
//       .maybeSingle();
//     if (data) {
//       setUser({
//         id: String(data.id),
//         authId: authUser.id,
//         name: data.name,
//         email: data.email,
//         role: data.role,
//         department: data.department ?? undefined,
//       });
//     }
//   }

//   useEffect(() => {
//     supabase.auth.getSession().then(({ data: { session: s } }) => {
//       setSession(s);
//       if (s?.user) fetchProfile(s.user);
//       setLoading(false);
//     });

//     const {
//       data: { subscription },
//     } = supabase.auth.onAuthStateChange((_event, s) => {
//       setSession(s);
//       if (s?.user) {
//         fetchProfile(s.user);
//       } else {
//         setUser(null);
//       }
//     });
//     return () => subscription.unsubscribe();
//   }, []);

//   const signIn = async (email: string, password: string) => {
//     const { error } = await supabase.auth.signInWithPassword({ email, password });
//     return error?.message ?? null;
//   };

//   const signOut = async () => {
//     await supabase.auth.signOut();
//     setUser(null);
//     setSession(null);
//   };

//   return (
//     <AuthContext.Provider value={{ session, user, loading, signIn, signOut }}>
//       {children}
//     </AuthContext.Provider>
//   );
// }

// /* ─── Pages ─────────────────────────────────────────────────────────────── */
// import LoginPage from "./pages/Login";
// import DashboardPage from "./pages/Dashboard";
// import EmployeesPage from "./pages/Employees";
// import LeadsPage from "./pages/Leads";
// import AttendancePage from "./pages/Attendance";
// import TrackingPage from "./pages/Tracking";

// type Page = "dashboard" | "employees" | "leads" | "attendance" | "tracking";

// function AdminShell() {
//   const { user, signOut } = useAuth();
//   const [page, setPage] = useState<Page>("dashboard");

//   const nav: { id: Page; label: string; icon: string }[] = [
//     { id: "dashboard", label: "Dashboard", icon: "📊" },
//     { id: "employees", label: "Employees", icon: "👥" },
//     { id: "leads", label: "Leads", icon: "🎯" },
//     { id: "attendance", label: "Attendance", icon: "📋" },
//     { id: "tracking", label: "Live Tracking", icon: "📍" },
//   ];

//   return (
//     <div className="flex h-screen bg-background">
//       {/* Sidebar */}
//       <aside className="w-64 bg-card border-r border-border flex flex-col">
//         <div className="p-6 border-b border-border">
//           <h1 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
//             <span className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">N</span>
//             Neelgund Admin
//           </h1>
//         </div>

//         <nav className="flex-1 p-3 space-y-1">
//           {nav.map((n) => (
//             <button
//               key={n.id}
//               onClick={() => setPage(n.id)}
//               className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
//                 page === n.id
//                   ? "bg-primary text-primary-foreground"
//                   : "text-muted-foreground hover:bg-accent hover:text-foreground"
//               }`}
//             >
//               <span className="text-base">{n.icon}</span>
//               {n.label}
//             </button>
//           ))}
//         </nav>

//         <div className="p-4 border-t border-border">
//           <div className="flex items-center gap-3">
//             <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
//               {user?.name?.charAt(0).toUpperCase()}
//             </div>
//             <div className="flex-1 min-w-0">
//               <p className="text-sm font-medium text-foreground truncate">{user?.name}</p>
//               <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace("_", " ")}</p>
//             </div>
//             <button
//               onClick={signOut}
//               className="text-muted-foreground hover:text-destructive transition-colors"
//               title="Sign out"
//             >
//               ⏻
//             </button>
//           </div>
//         </div>
//       </aside>

//       {/* Main content */}
//       <main className="flex-1 overflow-auto">
//         {page === "dashboard" && <DashboardPage />}
//         {page === "employees" && <EmployeesPage />}
//         {page === "leads" && <LeadsPage />}
//         {page === "attendance" && <AttendancePage />}
//         {page === "tracking" && <TrackingPage />}
//       </main>
//     </div>
//   );
// }

// function AppRouter() {
//   const { loading, user } = useAuth();

//   if (loading) {
//     return (
//       <div className="h-screen flex items-center justify-center bg-background">
//         <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
//       </div>
//     );
//   }

//   if (!user) return <LoginPage />;

//   // Only admin/super_admin/hr can use the web panel
//   if (!["admin", "super_admin", "hr"].includes(user.role)) {
//     return (
//       <div className="h-screen flex flex-col items-center justify-center bg-background text-center p-8">
//         <p className="text-4xl mb-4">🚫</p>
//         <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
//         <p className="text-muted-foreground mb-6">The admin panel is only available for admin, HR, and super admin accounts.</p>
//         <button onClick={() => supabase.auth.signOut()} className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium">
//           Sign Out
//         </button>
//       </div>
//     );
//   }

//   return <AdminShell />;
// }

// export default function App() {
//   return (
//     <AuthProvider>
//       <AppRouter />
//     </AuthProvider>
//   );
// }

import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { supabase } from "./lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

/* ─── Auth Context ─────────────────────────────────────────────────────── */
type AppUser = {
  id: string; authId: string; name: string; email: string; role: string; department?: string;
};
type AuthCtx = {
  session: Session | null; user: AppUser | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthCtx>({ session: null, user: null, loading: true, signIn: async () => null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(authUser: User) {
    const { data } = await supabase.from("profiles").select("id, name, email, role, department").eq("id", authUser.id).maybeSingle();
    if (data) setUser({ id: String(data.id), authId: authUser.id, name: data.name, email: data.email, role: data.role, department: data.department ?? undefined });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => { setSession(s); if (s?.user) fetchProfile(s.user); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); if (s?.user) fetchProfile(s.user); else setUser(null); });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => { const { error } = await supabase.auth.signInWithPassword({ email, password }); return error?.message ?? null; };
  const signOut = async () => { await supabase.auth.signOut(); setUser(null); setSession(null); };

  return <AuthContext.Provider value={{ session, user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

/* ─── Pages ─────────────────────────────────────────────────────────────── */
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import EmployeesPage from "./pages/Employees";
import LeadsPage from "./pages/Leads";
import AttendancePage from "./pages/Attendance";
import TrackingPage from "./pages/Tracking";
import ProfilePage from "./pages/Profile";

type Page = "dashboard" | "employees" | "leads" | "attendance" | "tracking" | "profile";

/* SVG icons — no emoji, sharp & consistent */
const Icons: Record<string, () => JSX.Element> = {
  dashboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  employees: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/>
    </svg>
  ),
  leads: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  attendance: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  tracking: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
  ),
  profile: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  ),
  signout: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
};

function AdminShell() {
  const { user, signOut } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");

  const nav: { id: Page; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "employees", label: "Employees" },
    { id: "leads", label: "Leads" },
    { id: "attendance", label: "Attendance" },
    { id: "tracking", label: "Live Tracking" },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col"
        style={{ background: "hsl(var(--sidebar))" }}
      >
        {/* Brand */}
        <div className="px-6 pt-7 pb-6">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "hsl(var(--sidebar-primary))", color: "hsl(var(--navy-900))" }}
            >
              N
            </div>
            <div>
              <p className="text-[13px] font-semibold leading-tight" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>Neelgund</p>
              <p className="text-[10px] uppercase tracking-widest" style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.5 }}>Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-5 h-px" style={{ background: "hsl(var(--sidebar-border))" }} />

        {/* Nav */}
        <nav className="flex-1 px-3 pt-4 space-y-0.5">
          <p className="text-[9px] uppercase tracking-widest font-semibold px-3 pb-2" style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.4 }}>Navigation</p>
          {nav.map((n) => {
            const Icon = Icons[n.id];
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
                style={active
                  ? { background: "hsl(var(--sidebar-accent))", color: "hsl(var(--sidebar-accent-foreground))", borderLeft: "2px solid hsl(var(--sidebar-primary))" }
                  : { color: "hsl(var(--sidebar-foreground))", borderLeft: "2px solid transparent" }
                }
              >
                <Icon />
                {n.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom user area */}
        <div className="px-3 pb-5 pt-3" style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}>
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors"
            style={{ background: "hsl(var(--sidebar-accent))" }}
            onClick={() => setPage("profile")}
          >
            <div
              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-semibold"
              style={{ background: "hsl(var(--sidebar-primary))", color: "hsl(var(--navy-900))" }}
            >
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color: "hsl(var(--sidebar-accent-foreground))" }}>{user?.name}</p>
              <p className="text-[10px] capitalize truncate" style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.6 }}>{user?.role?.replace("_", " ")}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); signOut(); }}
              className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: "hsl(var(--sidebar-foreground))" }}
              title="Sign out"
            >
              <Icons.signout />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto min-w-0">
        {page === "dashboard"   && <DashboardPage />}
        {page === "employees"   && <EmployeesPage />}
        {page === "leads"       && <LeadsPage />}
        {page === "attendance"  && <AttendancePage />}
        {page === "tracking"    && <TrackingPage />}
        {page === "profile"     && <ProfilePage />}
      </main>
    </div>
  );
}

function AppRouter() {
  const { loading, user } = useAuth();
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="animate-spin w-7 h-7 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
  if (!user) return <LoginPage />;
  if (!["admin", "super_admin", "hr"].includes(user.role)) return (
    <div className="h-screen flex flex-col items-center justify-center bg-background text-center p-8">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--destructive))" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">Access Restricted</h2>
      <p className="text-sm text-muted-foreground mb-6">This panel is for Admin, HR and Super Admin accounts only.</p>
      <button onClick={() => supabase.auth.signOut()} className="px-5 py-2 bg-destructive text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">Sign Out</button>
    </div>
  );
  return <AdminShell />;
}

export default function App() {
  return <AuthProvider><AppRouter /></AuthProvider>;
}