import { useState } from "react";
import { Calendar, Route } from "lucide-react";
import { useGetLocationTrail } from "@workspace/api-client-react";
import type { EmployeeLocation, LocationPoint } from "@workspace/api-client-react";

interface DateTrailPickerProps {
  employees: EmployeeLocation[];
  onTrailLoaded: (trail: LocationPoint[], matchedRoute?: number[][]) => void;
  onDateChange?: (date: string) => void;
}

export default function DateTrailPicker({ employees, onTrailLoaded, onDateChange }: DateTrailPickerProps) {
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const trailQuery = useGetLocationTrail(
    { employeeId, date, matchRoads: true },
    { query: { enabled: false } as any }
  );

  async function handleLoad() {
    if (!employeeId || !date) return;
    const result = await trailQuery.refetch();
    if (result.data) {
      const data = result.data as unknown as {
        points: LocationPoint[];
        matchedRoute?: number[][];
      };
      onTrailLoaded(data.points, data.matchedRoute);
      onDateChange?.(date);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
        className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Select employee</option>
        {employees.map((emp) => (
          <option key={String(emp.employeeId)} value={String(emp.employeeId)}>
            {emp.employeeName}
          </option>
        ))}
      </select>

      <div className="relative">
        <Calendar className="absolute left-2.5 top-1.5 w-4 h-4 text-muted-foreground" />
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            onDateChange?.(e.target.value);
          }}
          className="pl-9 pr-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <button
        onClick={handleLoad}
        disabled={!employeeId || trailQuery.isFetching}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
      >
        <Route className="w-4 h-4" />
        {trailQuery.isFetching ? "Loading..." : "Load Trail"}
      </button>
    </div>
  );
}
