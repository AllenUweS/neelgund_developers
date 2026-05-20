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
}: {
  trail: LocationPoint[];
  matchedRoute?: number[][] | null;
  isLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  topPad: number;
  bottomPad: number;
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
    />
  );
}

