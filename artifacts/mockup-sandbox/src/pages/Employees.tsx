import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Employee = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  department?: string | null;
};

const ROLE_BADGES: Record<string, string> = {
  super_admin: "bg-red-100 text-red-700",
  admin: "bg-violet-100 text-violet-700",
  hr: "bg-amber-100 text-amber-700",
  employee: "bg-blue-100 text-blue-700",
  transport: "bg-emerald-100 text-emerald-700",
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => { fetchEmployees(); }, []);

  async function fetchEmployees() {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("id, name, email, phone, role, department").order("name");
    setEmployees(data ?? []);
    setLoading(false);
  }

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-full"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="p-8 space-y-6">
      <div><h1 className="text-2xl font-bold text-foreground">Employees</h1><p className="text-muted-foreground">{employees.length} team members</p></div>
      <div className="relative max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
        <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-muted/50">
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Name</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Email</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Phone</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Role</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
          </tr></thead>
          <tbody>{filtered.map(e => (
            <tr key={e.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
              <td className="py-3 px-4"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{e.name.charAt(0)}</div><span className="font-medium text-foreground">{e.name}</span></div></td>
              <td className="py-3 px-4 text-muted-foreground">{e.email}</td>
              <td className="py-3 px-4 text-muted-foreground">{e.phone || "—"}</td>
              <td className="py-3 px-4"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGES[e.role] ?? "bg-gray-100 text-gray-700"}`}>{e.role.replace("_"," ")}</span></td>
              <td className="py-3 px-4"><span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Active</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
