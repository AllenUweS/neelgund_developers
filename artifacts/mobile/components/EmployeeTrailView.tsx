import React from "react";
import { TripNavigationView } from "@/components/TripNavigationView";
import type { LocationPoint } from "@/lib/types";

export function EmployeeTrailView({
  trail,
  matchedRoute,
  isLoading,
  selectedDate,
  onDateChange,
  topPad,
  bottomPad,
  employeeId,
  employeeName,
  profilePhotoUrl,
}: {
  trail: LocationPoint[];
  matchedRoute?: number[][] | null;
  isLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  topPad: number;
  bottomPad: number;
  employeeId?: string | null;
  employeeName?: string | null;
  profilePhotoUrl?: string | null;
}) {
  return (
    <TripNavigationView
      trail={trail}
      matchedRoute={matchedRoute}
      isLoading={isLoading}
      selectedDate={selectedDate}
      onDateChange={onDateChange}
      topPad={topPad}
      bottomPad={bottomPad}
      employeeId={employeeId}
      employeeName={employeeName}
      profilePhotoUrl={profilePhotoUrl}
    />
  );
}