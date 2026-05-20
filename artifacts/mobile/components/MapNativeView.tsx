import React from "react";
import { TripNavigationView } from "@/components/TripNavigationView";
import type { EmployeeLocation, LocationPoint } from "@/lib/types";

export function MapNativeView({
  employees,
  selectedEmployee,
  trail,
  matchedRoute,
  isLoading,
  onSelect,
  topPad,
  bottomPad,
  selectedDate,
  onDateChange,
}: {
  employees: EmployeeLocation[];
  selectedEmployee: string | null;
  trail: LocationPoint[];
  matchedRoute: number[][] | null;
  isLoading?: boolean;
  onSelect: (id: string | null) => void;
  topPad: number;
  bottomPad: number;
  selectedDate: string;
  onDateChange: (date: string) => void;
}) {
  const selectedRow = employees.find((employee) => employee.employeeId === selectedEmployee) ?? null;

  return (
    <TripNavigationView
      trail={trail}
      matchedRoute={matchedRoute}
      isLoading={!!isLoading}
      selectedDate={selectedDate}
      onDateChange={onDateChange}
      topPad={topPad}
      bottomPad={bottomPad}
      employeeName={selectedRow?.employeeName ?? "Employee"}
      onBack={() => onSelect(null)}
    />
  );
}
