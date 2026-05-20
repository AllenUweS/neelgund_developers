import type { AppRole, AttendanceStatus } from "./api";

export type { AppRole, AttendanceStatus };

export type Lead = {
  id: number;
  employeeId: string;
  employeeName?: string;
  managerId?: string | null;
  managerName?: string | null;
  name: string;
  phone: string;
  email?: string;
  propertyInterest?: string;
  status: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  budget?: string;
  priority?: string;
  currentHousing?: string;
  followUpDate?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceRecord = {
  id: number;
  employeeId: string;
  employeeName?: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  status: AttendanceStatus | null;
  notes: string | null;
};

export type AttendanceSummaryRow = {
  employeeId: string;
  employeeName: string | null;
  totalPresent: number;
  totalHalfDay: number;
  totalAbsent: number;
  avgCheckIn: string | null;
};

export type AttendanceRegularization = {
  id: number;
  attendanceId: number;
  employeeId: string;
  employeeName?: string | null;
  date: string;
  requestedCheckInTime: string | null;
  requestedCheckOutTime: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrackingRow = {
  employeeId: string;
  employeeName: string;
  role: string;
  permissionState: "granted" | "denied" | "unknown";
  trackerState: "running" | "stopped";
  platform?: string | null;
  lastPingAt?: string | null;
  updatedAt: string;
};

export type EmployeeLocation = {
  employeeId: string;
  employeeName: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  // trackerState comes from tracking_status joined in listEmployeeLocationsByDate.
  // "running" = actively tracking, "stopped" = logged out / stopped.
  // undefined = employee has no tracking_status row yet (legacy data).
  trackerState?: "running" | "stopped";
};

export type ActivityType = "driving" | "walking" | "stationary" | "unknown";

export type LocationPoint = {
  id: number;
  employeeId: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  speedKmh?: number | null;
  heading?: number | null;
  altitude?: number | null;
  batteryLevel?: number | null;
  activityType?: ActivityType | null;
  source?: string | null;
  recordedAt: string;
};

export type StopType = "micro" | "short" | "long" | "overnight";

export type Stop = {
  id: number;
  employeeId: string;
  startAt: string;
  endAt: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  durationMs: number | null;
  stopType: StopType;
  address?: string | null;
  zoneId?: number | null;
  leadId?: number | null;
  createdAt: string;
};

export type CompanyDocument = {
  id: number;
  name: string;
  url: string;
  mimeType?: string;
  category?: string;
  uploadedBy: number;
  createdAt: string;
  updatedAt: string;
};

export type LeaderboardEntry = {
  employeeId: number;
  employeeName: string;
  totalLeads: number;
  closedWon: number;
  rank: number;
};

export type UserBasic = {
  id: string;
  name: string;
  role: string;
};

export type LeadMeeting = {
  id: number;
  leadId: number;
  scheduledAt: string;
  notes?: string;
  createdAt: string;
};

export type LeadDocument = {
  id: number;
  leadId: number;
  name: string;
  url: string;
  mimeType?: string;
  uploadedBy: number;
  createdAt: string;
};

export type LeadActivity = {
  id: number;
  leadId: number;
  type: string;
  description: string;
  createdBy: number;
  createdByName?: string | null;
  createdAt: string;
};

export type CreateLeadInput = {
  name: string;
  phone: string;
  email?: string | null;
  propertyInterest?: string | null;
  status?: string;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string | null;
  budget?: string | null;
  priority?: string | null;
  currentHousing?: string | null;
  followUpDate?: string | null;
  address?: string | null;
};

export type UpdateLeadInput = {
  name?: string;
  phone?: string;
  email?: string | null;
  propertyInterest?: string | null;
  status?: string;
  notes?: string | null;
  source?: string | null;
  budget?: string | null;
  priority?: string | null;
  currentHousing?: string | null;
  followUpDate?: string | null;
  address?: string | null;
};

export type ProfileJoin = { name?: string; role?: string; manager_id?: string } | null;

export type DashboardStats = {
  totalLeads: number;
  newLeads: number;
  closedWon: number;
  meetings: number;
  hotLeads: number;
};