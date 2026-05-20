import React from "react";
import { View } from "react-native";

type EmployeeLocation = {
  employeeId: number;
  employeeName: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

type LocationPoint = {
  id: number;
  employeeId: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

type MapNativeViewProps = {
  employees: EmployeeLocation[];
  selectedEmployee: number | null;
  trail: LocationPoint[];
  onSelect: (id: number | null) => void;
  topPad: number;
  bottomPad: number;
  selectedDate: string;
  onDateChange: (date: string) => void;
};

export function MapNativeView(_props: MapNativeViewProps) {
  return <View />;
}
