  import { supabase } from "@/lib/supabase";
  import { filterPointsForPolyline } from "@/lib/gpsFilter";
  import type {
    Lead,
    CreateLeadInput,
    UpdateLeadInput,
    ProfileJoin,
    LeadMeeting,
    LeadDocument,
    LeadActivity,
    LeaderboardEntry,
    TrackingRow,
    EmployeeLocation,
    LocationPoint,
    CompanyDocument,
    AttendanceRecord,
    AttendanceSummaryRow,
    AttendanceRegularization,
    DashboardStats,
  } from "@/lib/types";

  function extractProfileProp(profiles: any, prop: string): any {
    if (Array.isArray(profiles)) return profiles[0]?.[prop];
    return profiles?.[prop];
  }

  export type AppRole = "admin" | "super_admin" | "hr" | "manager" | "employee" | "transport";
  export type AttendanceStatus = "present" | "half_day" | "absent";

  export type AppUser = {
    id: string;
    email: string;
    name: string;
    role: AppRole;
    phone?: string | null;
    department?: string | null;
    designation?: string | null;
    joiningDate?: string | null;
    profileNotes?: string | null;
    managerId?: string | null;
    managerName?: string | null;
    createdAt?: string;
    profilePhotoUrl?: string | null;
    status?: "active" | "inactive";
  };

  function assertNoError(error: { message: string } | null): void {
    if (error) throw new Error(error.message);
  }

  function isMissingSessionError(error: { message?: string } | null): boolean {
    if (!error?.message) return false;
    const msg = error.message.toLowerCase();
    return msg.includes("auth session missing") || msg.includes("session_not_found");
  }

  function getUtcBoundsForLocalDate(date: string): { startUtcIso: string; endUtcIso: string } {
    // The app is deployed in India (IST = UTC+5:30).
    // All location_points are stored with recorded_at as UTC timestamps.
    //
    // Problem with a plain UTC window (T00:00:00Z to T23:59:59Z):
    //   An employee in IST starting their day at "midnight IST" on 2026-05-22
    //   records points from 2026-05-21T18:30:00Z onward. A UTC-midnight window
    //   misses those first 5.5 hours, making the trail look like it starts at 5:30 AM.
    //
    // Fix: compute IST midnight -> IST end-of-day in UTC.
    //   IST midnight for date D  = (D 00:00:00 IST) = (D-1 18:30:00 UTC)
    //   IST end-of-day for date D = (D 23:59:59.999 IST) = (D 18:29:59.999 UTC)
    //
    // IST_OFFSET_MS = +5h30m = 19800 seconds = 19800000 ms
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const [year, month, day] = date.split("-").map(Number);
    // Date.UTC gives us that calendar date at UTC midnight.
    // Subtracting IST offset shifts it back to IST midnight expressed in UTC.
    const istMidnightUtcMs = Date.UTC(year, month - 1, day) - IST_OFFSET_MS;
    const istEndOfDayUtcMs = istMidnightUtcMs + 24 * 60 * 60 * 1000 - 1;
    return {
      startUtcIso: new Date(istMidnightUtcMs).toISOString(),  // e.g. 2026-05-21T18:30:00.000Z
      endUtcIso: new Date(istEndOfDayUtcMs).toISOString(),  // e.g. 2026-05-22T18:29:59.999Z
    };
  }

  export function deriveAttendanceStatus(
    checkInTime: string | null | undefined,
    checkOutTime: string | null | undefined,
  ): AttendanceStatus {
    if (!checkInTime || !checkOutTime) return "absent";
    const workedMs = Math.max(0, new Date(checkOutTime).getTime() - new Date(checkInTime).getTime());
    const workedHours = workedMs / 3600000;
    if (workedHours >= 8) return "present";
    if (workedHours >= 4) return "half_day";
    return "absent";
  }

  export function computeEffectiveStatus(
    date: string,
    checkOutTime: string | null | undefined,
    dbStatus: string | null | undefined
  ): AttendanceStatus | null {
    const today = new Date().toISOString().slice(0, 10);
    if (!dbStatus && !checkOutTime && date < today) {
      return "absent";
    }
    return (dbStatus as AttendanceStatus) ?? null;
  }

  async function requireUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    assertNoError(error);
    const userId = data.user?.id;
    if (!userId) throw new Error("Unauthorized");
    return userId;
  }

  export async function signIn(email: string, password: string): Promise<AppUser> {
    // Single-session per device: if anyone was already signed in here, revoke
    // that session first so the new login starts from a clean slate.
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await supabase.auth.signOut();
      }
    } catch {
      // best effort — proceed with sign-in regardless
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    assertNoError(error);
    const me = await getMe();
    if (!me) throw new Error("Profile not found");
    if (me.status === "inactive") {
      await supabase.auth.signOut();
      throw new Error("Account inactive. Please contact HR to regain access.");
    }
    return me;
  }

  export async function signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    assertNoError(error);
  }

  export async function updateMyPassword(newPassword: string): Promise<void> {
    const password = newPassword.trim();
    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    const { error } = await supabase.auth.updateUser({ password });
    assertNoError(error);
  }

  export async function updateMyProfilePhoto(profilePhotoUrl: string | null): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from("profiles")
      .update({ profile_photo_url: profilePhotoUrl })
      .eq("id", userId);
    assertNoError(error);
  }

  export async function getMe(): Promise<AppUser | null> {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (isMissingSessionError(authError)) return null;
    assertNoError(authError);
    const authUser = authData.user;
    if (!authUser) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();
    if (error) return null;
    return {
      id: data.id,
      email: data.email ?? authUser.email ?? "",
      name: data.name,
      role: data.role,
      phone: data.phone,
      department: data.department,
      designation: data.designation,
      joiningDate: data.joining_date,
      profileNotes: data.profile_notes,
      managerId: data.manager_id,
      createdAt: data.created_at,
      profilePhotoUrl: data.profile_photo_url ?? null,
      status: data.status ?? "active",
    };
  }

  export async function listUsers(): Promise<AppUser[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      name: p.name,
      role: p.role,
      phone: p.phone,
      department: p.department,
      designation: p.designation,
      joiningDate: p.joining_date,
      profileNotes: p.profile_notes,
      managerId: p.manager_id,
      managerName: null,
      createdAt: p.created_at,
      profilePhotoUrl: p.profile_photo_url ?? null,
      status: p.status ?? "active",
    }));
  }

  export async function listManagers(): Promise<AppUser[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, role")
      .eq("role", "manager")
      .order("name", { ascending: true });
    assertNoError(error);
    return (data ?? []).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      name: p.name,
      role: p.role,
    }));
  }

  export async function listMyTeam(): Promise<AppUser[]> {
    const me = await getMe();
    if (!me) return [];

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("manager_id", me.id)
      .order("name", { ascending: true });
    assertNoError(error);

    return (data ?? []).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      name: p.name,
      role: p.role,
      phone: p.phone,
      department: p.department,
      designation: p.designation,
      joiningDate: p.joining_date,
      profileNotes: p.profile_notes,
      managerId: p.manager_id,
      createdAt: p.created_at,
      status: p.status ?? "active",
    }));
  }

  export async function createUser(input: {
    name: string;
    email: string;
    password: string;
    role: AppRole;
    phone?: string | null;
    department?: string | null;
    designation?: string | null;
    joiningDate?: string | null;
    profileNotes?: string | null;
    managerId?: string | null;
    profilePhotoUrl?: string | null;
  }): Promise<void> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedPassword = input.password.trim();
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "create", ...input, email: normalizedEmail, password: normalizedPassword },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  export async function resetUserPassword(id: string, password: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "reset_password", id, password: password.trim() },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  export async function updateUser(
    id: string,
    input: Partial<{
      name: string;
      email: string;
      role: AppRole;
      phone: string | null;
      department: string | null;
      designation: string | null;
      joiningDate: string | null;
      profileNotes: string | null;
      managerId: string | null;
      profilePhotoUrl: string | null;
      status: "active" | "inactive";
    }>,
  ): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.email !== undefined) payload.email = input.email;
    if (input.role !== undefined) payload.role = input.role;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.department !== undefined) payload.department = input.department;
    if (input.designation !== undefined) payload.designation = input.designation;
    if (input.joiningDate !== undefined) payload.joining_date = input.joiningDate;
    if (input.profileNotes !== undefined) payload.profile_notes = input.profileNotes;
    if (input.managerId !== undefined) payload.manager_id = input.managerId;
    if (input.profilePhotoUrl !== undefined) payload.profile_photo_url = input.profilePhotoUrl;
    if (input.status !== undefined) payload.status = input.status;
    const { error } = await supabase.from("profiles").update(payload).eq("id", id);
    assertNoError(error);
  }

  export async function updateUserStatus(id: string, status: "active" | "inactive"): Promise<void> {
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    assertNoError(error);
  }

  export async function deleteUser(id: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "delete", id },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  }

  export async function createLead(input: CreateLeadInput): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("leads").insert({
      employee_id: userId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      property_interest: input.propertyInterest ?? null,
      status: input.status ?? "new",
      notes: input.notes ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      source: input.source ?? null,
      budget: input.budget ?? null,
      priority: input.priority ?? null,
      current_housing: input.currentHousing ?? null,
      follow_up_date: input.followUpDate ?? null,
      address: input.address ?? null,
    });
    assertNoError(error);
  }

  export async function listLeads(): Promise<Lead[]> {
    const allData: any[] = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("leads")
        .select(`
          id, employee_id, name, phone, email, property_interest, status, source, budget, priority, follow_up_date, address, created_at, updated_at,
          profiles!left(name, role, manager_id)
        `)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      assertNoError(error);
      if (!data || data.length === 0) break;

      allData.push(...data);
      if (data.length < pageSize) break;

      from += pageSize;
      // Safety cap
      if (allData.length >= 50000) break;
    }

    return allData.map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      employeeName: extractProfileProp(l.profiles, "name") ?? undefined,
      managerId: extractProfileProp(l.profiles, "manager_id") ?? null,
      managerName: null,
      name: l.name,
      phone: l.phone,
      email: l.email,
      propertyInterest: l.property_interest,
      status: l.status,
      source: l.source,
      budget: l.budget,
      priority: l.priority,
      followUpDate: l.follow_up_date,
      address: l.address,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    }));
  }

  export async function getDashboardStats(): Promise<DashboardStats> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [totalRes, newRes, closedWonRes, meetingsRes, hotRes] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "closed_won"),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "meeting_scheduled"),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("priority", "hot").gte("created_at", todayIso),
    ]);

    assertNoError(totalRes.error);
    assertNoError(newRes.error);
    assertNoError(closedWonRes.error);
    assertNoError(meetingsRes.error);
    assertNoError(hotRes.error);

    return {
      totalLeads: totalRes.count ?? 0,
      newLeads: newRes.count ?? 0,
      closedWon: closedWonRes.count ?? 0,
      meetings: meetingsRes.count ?? 0,
      hotLeads: hotRes.count ?? 0,
    };
  }

  export async function getRecentLeads(limit = 5): Promise<Lead[]> {
    const { data, error } = await supabase
      .from("leads")
      .select(`
        id, employee_id, name, phone, email, property_interest, status, source, budget, priority, follow_up_date, address, created_at, updated_at,
        profiles!left(name, role)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);
    assertNoError(error);
    return (data ?? []).map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      employeeName: extractProfileProp(l.profiles, "name") ?? undefined,
      name: l.name,
      phone: l.phone,
      email: l.email,
      propertyInterest: l.property_interest,
      status: l.status,
      source: l.source,
      budget: l.budget,
      priority: l.priority,
      followUpDate: l.follow_up_date,
      address: l.address,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    }));
  }

  export async function getHotLeadsToday(limit = 10): Promise<Lead[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const { data, error } = await supabase
      .from("leads")
      .select(`
        id, employee_id, name, phone, email, property_interest, status, source, budget, priority, follow_up_date, address, created_at, updated_at,
        profiles!left(name, role)
      `)
      .eq("priority", "hot")
      .gte("created_at", todayIso)
      .order("created_at", { ascending: false })
      .limit(limit);
    assertNoError(error);
    return (data ?? []).map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      employeeName: extractProfileProp(l.profiles, "name") ?? undefined,
      name: l.name,
      phone: l.phone,
      email: l.email,
      propertyInterest: l.property_interest,
      status: l.status,
      source: l.source,
      budget: l.budget,
      priority: l.priority,
      followUpDate: l.follow_up_date,
      address: l.address,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    }));
  }

  export async function getLeadById(leadId: number): Promise<Lead | null> {
    const { data, error } = await supabase.from("leads_with_employee").select("*").eq("id", leadId).maybeSingle();
    assertNoError(error);
    if (!data) return null;
    return {
      id: data.id,
      employeeId: data.employee_id,
      employeeName: data.employee_name,
      name: data.name,
      phone: data.phone,
      email: data.email,
      propertyInterest: data.property_interest,
      status: data.status,
      notes: data.notes,
      latitude: data.latitude,
      longitude: data.longitude,
      source: data.source,
      budget: data.budget,
      priority: data.priority,
      currentHousing: data.current_housing ?? undefined,
      followUpDate: data.follow_up_date,
      address: data.address,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  export async function updateLead(leadId: number, input: UpdateLeadInput): Promise<void> {
    const { error } = await supabase.from("leads").update({
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      property_interest: input.propertyInterest ?? null,
      status: input.status,
      notes: input.notes ?? null,
      source: input.source ?? null,
      budget: input.budget ?? null,
      priority: input.priority ?? null,
      current_housing: input.currentHousing ?? null,
      follow_up_date: input.followUpDate ?? null,
      address: input.address ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);
    assertNoError(error);
  }

  export async function transferLeads(leadIds: number[], targetEmployeeId: string): Promise<void> {
    if (leadIds.length === 0) return;
    const { error } = await supabase
      .from("leads")
      .update({ employee_id: targetEmployeeId, updated_at: new Date().toISOString() })
      .in("id", leadIds);
    assertNoError(error);
  }

  export async function deleteLead(leadId: number): Promise<void> {
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    assertNoError(error);
  }

  /** Update only the status field — avoids overwriting concurrent edits to other lead fields. */
  export async function updateLeadStatus(leadId: number, status: string): Promise<void> {
    const { error } = await supabase
      .from("leads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    assertNoError(error);
  }

  export async function listLeadMeetings(leadId: number): Promise<LeadMeeting[]> {
    const { data, error } = await supabase.from("lead_meetings").select("*").eq("lead_id", leadId).order("scheduled_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((m) => ({ id: m.id, leadId: m.lead_id, scheduledAt: m.scheduled_at, notes: m.notes ?? undefined, createdAt: m.created_at }));
  }

  export async function addLeadMeeting(leadId: number, scheduledAt: string, notes: string | null): Promise<void> {
    const { error } = await supabase.from("lead_meetings").insert({ lead_id: leadId, scheduled_at: scheduledAt, notes });
    assertNoError(error);
  }

  export async function updateLeadMeeting(meetingId: number, notes: string): Promise<void> {
    const { error } = await supabase.from("lead_meetings").update({ notes }).eq("id", meetingId);
    assertNoError(error);
  }

  export async function deleteLeadMeeting(meetingId: number): Promise<void> {
    const { error } = await supabase.from("lead_meetings").delete().eq("id", meetingId);
    assertNoError(error);
  }

  export async function listLeadDocuments(leadId: number): Promise<LeadDocument[]> {
    const { data, error } = await supabase.from("lead_documents").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((d) => ({ id: d.id, leadId: d.lead_id, name: d.name, url: d.url, mimeType: d.mime_type ?? undefined, uploadedBy: d.uploaded_by, createdAt: d.created_at }));
  }

  export async function addLeadDocument(leadId: number, input: { name: string; url: string; mimeType?: string | null }): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("lead_documents").insert({
      lead_id: leadId,
      name: input.name,
      url: input.url,
      mime_type: input.mimeType ?? null,
      uploaded_by: userId,
    });
    assertNoError(error);
  }

  export async function listLeadActivities(leadId: number): Promise<LeadActivity[]> {
    const { data, error } = await supabase
      .from("lead_activities")
      .select("*, profiles:created_by(name)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((a) => ({
      id: a.id,
      leadId: a.lead_id,
      type: a.type,
      description: a.description,
      createdBy: a.created_by,
      createdByName: (a.profiles as ProfileJoin)?.name ?? null,
      createdAt: a.created_at,
    }));
  }

  export async function addLeadActivity(leadId: number, input: { type: string; description: string }): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("lead_activities").insert({
      lead_id: leadId,
      type: input.type,
      description: input.description,
      created_by: userId,
    });
    assertNoError(error);
  }

  export async function deleteLeadActivity(activityId: number): Promise<void> {
    const { error } = await supabase.from("lead_activities").delete().eq("id", activityId);
    assertNoError(error);
  }

  export async function listLeaderboard(): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase.rpc("get_leaderboard");
    assertNoError(error);
    return data ?? [];
  }

  import { getApiBaseUrl, getPersistedAuthToken } from "@/utils/tokenStorage";

  async function apiHeaders(): Promise<Record<string, string>> {
    const token = await getPersistedAuthToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  async function apiUrl(path: string): Promise<string> {
    const base = await getApiBaseUrl();
    return `${base}/api${path}`;
  }

  export async function trackLocation(input: { latitude: number; longitude: number; accuracy?: number; recordedAt?: string }): Promise<void> {
    const url = await apiUrl("/location/track");
    const headers = await apiHeaders();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "Request failed");
      throw new Error(text);
    }
  }

  export async function reportTrackingStatus(input: {
    permissionState: "granted" | "denied" | "unknown";
    trackerState: "running" | "stopped";
    platform: string;
    lastPingAt?: string | null;
  }): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("tracking_status").upsert({
      employee_id: userId,
      permission_state: input.permissionState,
      tracker_state: input.trackerState,
      platform: input.platform,
      last_ping_at: input.lastPingAt ?? null,
      updated_at: new Date().toISOString(),
    });
    assertNoError(error);
  }

  export type TrailResponse = {
    points: LocationPoint[];
    matchedRoute: number[][] | null;
    matchConfidence: number | null;
    matchPending: boolean;
  };

  export async function getLocationTrailRest(employeeId: string, date: string, matchRoads = false): Promise<TrailResponse> {
    const url = await apiUrl(`/location/trail?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}${matchRoads ? "&matchRoads=true" : ""}`);
    const headers = await apiHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => "Request failed");
      throw new Error(text);
    }
    return (await response.json()) as TrailResponse;
  }

  export async function listTrackingStatus(): Promise<TrackingRow[]> {
    const me = await getMe();
    if (!me) return [];

    let query = supabase
      .from("tracking_status")
      .select("employee_id, permission_state, tracker_state, platform, last_ping_at, updated_at, profiles!inner(name, role, manager_id)")
      .order("updated_at", { ascending: false });

    if (me.role === "manager") {
      query = query.eq("profiles.manager_id", me.id);
    }

    const { data, error } = await query;
    assertNoError(error);
    return (data ?? []).map((row) => ({
      employeeId: row.employee_id,
      employeeName: (row.profiles as { name?: string } | null)?.name ?? "Employee",
      role: (row.profiles as { role?: string } | null)?.role ?? "employee",
      permissionState: row.permission_state,
      trackerState: row.tracker_state,
      platform: row.platform,
      lastPingAt: row.last_ping_at,
      updatedAt: row.updated_at,
    }));
  }

  export async function listEmployeeLocationsByDate(date: string): Promise<EmployeeLocation[]> {
    const me = await getMe();
    if (!me) return [];

    const { startUtcIso, endUtcIso } = getUtcBoundsForLocalDate(date);

    // Fetch all employee profiles first so admin sees EVERYONE — even those
    // who haven't started tracking today. Without this, employees who are
    // absent or haven't opened the app are completely invisible to the admin.
    let profileQuery = supabase
      .from("profiles")
      .select("id, name, manager_id, profile_photo_url")
      .eq("role", "employee");

    if (me.role === "manager") {
      profileQuery = profileQuery.eq("manager_id", me.id);
    }

    const { data: profileRows } = await profileQuery;
    const allProfiles = new Map<string, { name: string; photoUrl: string | null }>();
    for (const p of profileRows ?? []) {
      allProfiles.set(p.id, { name: p.name, photoUrl: p.profile_photo_url ?? null });
    }

    // Now fetch latest location point per employee for the requested day.
    // NO LIMIT — paginate through ALL rows using .range() so every employee's
    // latest position is found even on days with tens of thousands of points.
    const fleetPageSize = 1000;
    let fleetFrom = 0;
    const data: any[] = [];
    while (true) {
      let locationQuery = supabase
        .from("location_points")
        .select("employee_id, latitude, longitude, recorded_at, profiles!inner(name, manager_id)")
        .gte("recorded_at", startUtcIso)
        .lte("recorded_at", endUtcIso)
        .order("recorded_at", { ascending: false })
        .range(fleetFrom, fleetFrom + fleetPageSize - 1);

      if (me.role === "manager") {
        locationQuery = locationQuery.eq("profiles.manager_id", me.id);
      }

      const { data: page, error } = await locationQuery;
      assertNoError(error);
      if (!page || page.length === 0) break;
      data.push(...page);
      if (page.length < fleetPageSize) break;
      fleetFrom += fleetPageSize;
    }

    // Deduplicate to get the latest point per employee
    const latestByEmployee = new Map<string, any>();
    for (const row of data ?? []) {
      if (!latestByEmployee.has(row.employee_id)) latestByEmployee.set(row.employee_id, row);
    }

    // FIX: Fetch tracking_status for ALL employee profiles — not just those who
    // have a location point today. Previously this query only ran for employees
    // in latestByEmployee, so anyone who hadn't moved today (or ever) got
    // epoch (1970) as their recordedAt, causing "Last seen 20592d ago".
    // tracking_status.last_ping_at is all-time (not date-filtered), so it
    // correctly reflects when the employee last had the app open, regardless
    // of whether they have a GPS point today.
    const trackerStateById = new Map<string, "running" | "stopped">();
    const lastPingAtById = new Map<string, string>();
    const allEmployeeIds = Array.from(allProfiles.keys());
    if (allEmployeeIds.length > 0) {
      const { data: statusRows } = await supabase
        .from("tracking_status")
        .select("employee_id, tracker_state, last_ping_at")
        .in("employee_id", allEmployeeIds);
      for (const row of statusRows ?? []) {
        trackerStateById.set(row.employee_id, row.tracker_state as "running" | "stopped");
        if (row.last_ping_at) lastPingAtById.set(row.employee_id, row.last_ping_at);
      }
    }

    // Build the result: employees WITH a location point (have position data).
    // Build result rows: keep BOTH recordedAt (GPS) and lastPingAt (heartbeat)
    // separately so the admin map can compute 3-tier presence from whichever
    // signal is more recent, without conflating the two into a single field.
    const result: EmployeeLocation[] = Array.from(latestByEmployee.values()).map((row: any) => {
      const trackerState = trackerStateById.get(row.employee_id);
      const lastPing = lastPingAtById.get(row.employee_id) ?? null;
      return {
        employeeId: row.employee_id,
        employeeName: (row.profiles as { name?: string } | null)?.name ?? "Employee",
        latitude: row.latitude,
        longitude: row.longitude,
        recordedAt: row.recorded_at,
        lastPingAt: lastPing,
        trackerState,
        profilePhotoUrl: allProfiles.get(row.employee_id)?.photoUrl ?? null,
      };
    });

    // Add employees with NO location point today as offline placeholders.
    for (const [id, profile] of allProfiles) {
      if (!latestByEmployee.has(id)) {
        const lastPing = lastPingAtById.get(id) ?? null;
        result.push({
          employeeId: id,
          employeeName: profile.name,
          latitude: 0,
          longitude: 0,
          recordedAt: new Date(0).toISOString(),
          lastPingAt: lastPing,
          trackerState: trackerStateById.get(id) ?? "stopped",
          profilePhotoUrl: profile.photoUrl,
        });
      }
    }

    return result;
  }

  export async function getLocationTrail(employeeId: string, date: string): Promise<LocationPoint[]> {
    const { startUtcIso, endUtcIso } = getUtcBoundsForLocalDate(date);

    // NO LIMIT — Supabase's REST API caps unspecified queries at 1000 rows.
    // Paginate with .range() until all rows for the day are fetched, however
    // many that is (an 8-hour shift at 1 point/3s is ~9,600 points).
    const trailPageSize = 1000;
    let trailFrom = 0;
    const allRows: any[] = [];
    while (true) {
      const { data: page, error } = await supabase
        .from("location_points")
        .select("*")
        .eq("employee_id", employeeId)
        .gte("recorded_at", startUtcIso)
        .lte("recorded_at", endUtcIso)
        .order("recorded_at", { ascending: true })
        .range(trailFrom, trailFrom + trailPageSize - 1);
      assertNoError(error);
      if (!page || page.length === 0) break;
      allRows.push(...page);
      if (page.length < trailPageSize) break;
      trailFrom += trailPageSize;
    }

    const raw = allRows.map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address ?? null,
      speedKmh: row.speed_kmh ?? null,
      heading: row.heading ?? null,
      altitude: row.altitude ?? null,
      batteryLevel: row.battery_level ?? null,
      activityType: row.activity_type ?? null,
      source: row.source ?? null,
      accuracy: row.accuracy ?? null,
      recordedAt: row.recorded_at,
    }));

    // FIX: filter GPS noise before the polyline renderer sees the data.
    // Without this, GPS drift while stopped (oscillates +-10-50 m) produces
    // back-and-forth scribble segments on the map.
    return filterPointsForPolyline(raw, {
      maxAccuracyMetres: 65,  // drop fixes weaker than 65 m
      maxSpeedKmh: 250,       // drop impossible speed jumps
      minDistanceMetres: 8,   // collapse stop-drift into one point
    });
  }

  export async function getAttendanceToday(): Promise<AttendanceRecord | null> {
    const userId = await requireUserId();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("attendance")
      .select("id, employee_id, date, check_in_time, check_out_time, check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude, status, notes")
      .eq("employee_id", userId)
      .eq("date", today)
      .maybeSingle();
    assertNoError(error);
    if (!data) return null;
    return {
      id: data.id,
      employeeId: data.employee_id,
      date: data.date,
      checkInTime: data.check_in_time,
      checkOutTime: data.check_out_time,
      checkInLatitude: data.check_in_latitude,
      checkInLongitude: data.check_in_longitude,
      checkOutLatitude: data.check_out_latitude,
      checkOutLongitude: data.check_out_longitude,
      status: computeEffectiveStatus(data.date, data.check_out_time, data.status),
      notes: data.notes,
    };
  }

  export async function getAttendanceByMonth(month: string): Promise<AttendanceRecord[]> {
    const userId = await requireUserId();
    const [year, mon] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("employee_id", userId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      date: row.date,
      checkInTime: row.check_in_time,
      checkOutTime: row.check_out_time,
      checkInLatitude: row.check_in_latitude,
      checkInLongitude: row.check_in_longitude,
      checkOutLatitude: row.check_out_latitude,
      checkOutLongitude: row.check_out_longitude,
      status: computeEffectiveStatus(row.date, row.check_out_time, row.status),
      notes: row.notes,
    }));
  }

  export async function getAttendanceSummaryByMonth(month: string): Promise<AttendanceSummaryRow[]> {
    const [year, mon] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("attendance")
      .select("employee_id, date, status, check_in_time, check_out_time, profiles:employee_id(name)")
      .gte("date", start)
      .lte("date", end);
    assertNoError(error);

    const grouped = new Map<
      string,
      {
        employeeId: string;
        employeeName: string | null;
        totalPresent: number;
        totalHalfDay: number;
        totalAbsent: number;
        checkInHours: number[];
        checkInMinutes: number[];
      }
    >();

    for (const row of data ?? []) {
      const employeeId = row.employee_id as string;
      const employeeName = ((row.profiles as { name?: string } | null)?.name ?? null) as string | null;
      if (!grouped.has(employeeId)) {
        grouped.set(employeeId, {
          employeeId,
          employeeName,
          totalPresent: 0,
          totalHalfDay: 0,
          totalAbsent: 0,
          checkInHours: [],
          checkInMinutes: [],
        });
      }
      const bucket = grouped.get(employeeId)!;
      const status = computeEffectiveStatus(row.date, row.check_out_time, row.status) || "";
      if (status === "present") bucket.totalPresent += 1;
      else if (status === "half_day") bucket.totalHalfDay += 1;
      else if (status === "absent") bucket.totalAbsent += 1;

      if (row.check_in_time) {
        const d = new Date(row.check_in_time as string);
        bucket.checkInHours.push(d.getHours());
        bucket.checkInMinutes.push(d.getMinutes());
      }
    }

    return Array.from(grouped.values())
      .map((row) => {
        let avgCheckIn: string | null = null;
        if (row.checkInHours.length > 0) {
          const totalMins = row.checkInHours.reduce((acc, h, i) => acc + h * 60 + (row.checkInMinutes[i] ?? 0), 0);
          const avgMins = Math.round(totalMins / row.checkInHours.length);
          const hh = String(Math.floor(avgMins / 60)).padStart(2, "0");
          const mm = String(avgMins % 60).padStart(2, "0");
          avgCheckIn = `${hh}:${mm}`;
        }
        return {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          totalPresent: row.totalPresent,
          totalHalfDay: row.totalHalfDay,
          totalAbsent: row.totalAbsent,
          avgCheckIn,
        };
      })
      .sort((a, b) => {
        const totalA = a.totalPresent + a.totalHalfDay + a.totalAbsent;
        const totalB = b.totalPresent + b.totalHalfDay + b.totalAbsent;
        return totalB - totalA;
      });
  }

  export async function checkInAttendance(input: { latitude?: number | null; longitude?: number | null }): Promise<void> {
    const userId = await requireUserId();
    const today = new Date().toISOString().slice(0, 10);
    const checkInTime = new Date().toISOString();
    const { error } = await supabase.from("attendance").upsert({
      employee_id: userId,
      date: today,
      check_in_time: checkInTime,
      check_in_latitude: input.latitude ?? null,
      check_in_longitude: input.longitude ?? null,
      // Keep status pending during the shift; final status is computed at checkout.
      status: null,
      updated_at: new Date().toISOString(),
    });
    assertNoError(error);
  }

  export async function checkOutAttendance(input: { latitude?: number | null; longitude?: number | null }): Promise<void> {
    const userId = await requireUserId();
    const today = new Date().toISOString().slice(0, 10);
    const checkOutTime = new Date().toISOString();

    // Fetch check-in time and update in one logical step to avoid race conditions
    // from double-taps (both taps see the same SELECT before either UPDATE lands).
    const { data: attendanceRow, error: selectError } = await supabase
      .from("attendance")
      .select("check_in_time")
      .eq("employee_id", userId)
      .eq("date", today)
      .maybeSingle();
    assertNoError(selectError);

    if (!attendanceRow?.check_in_time) {
      throw new Error("Cannot check out without checking in first");
    }

    const computedStatus = deriveAttendanceStatus(attendanceRow.check_in_time, checkOutTime);
    const { error } = await supabase
      .from("attendance")
      .update({
        check_out_time: checkOutTime,
        check_out_latitude: input.latitude ?? null,
        check_out_longitude: input.longitude ?? null,
        status: computedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("employee_id", userId)
      .eq("date", today)
      // Prevent double-checkout: only update if check_out_time is still null
      .is("check_out_time", null);
    assertNoError(error);
  }

  export async function listCompanyDocuments(): Promise<CompanyDocument[]> {
    const { data, error } = await supabase.from("company_documents").select("*").order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      url: d.url,
      mimeType: d.mime_type,
      category: d.category,
      uploadedBy: d.uploaded_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  }

  export async function createCompanyDocument(input: {
    name: string;
    url: string;
    mimeType?: string;
    category?: string;
  }): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("company_documents").insert({
      name: input.name,
      url: input.url,
      mime_type: input.mimeType ?? null,
      category: input.category ?? null,
      uploaded_by: userId,
    });
    assertNoError(error);
  }

  export async function updateCompanyDocument(
    id: number,
    input: { name: string; url: string; mimeType?: string; category?: string },
  ): Promise<void> {
    const { error } = await supabase
      .from("company_documents")
      .update({
        name: input.name,
        url: input.url,
        mime_type: input.mimeType ?? null,
        category: input.category ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    assertNoError(error);
  }

  export async function deleteCompanyDocument(id: number): Promise<void> {
    const { error } = await supabase.from("company_documents").delete().eq("id", id);
    assertNoError(error);
  }

  export async function getAttendanceByMonthForEmployee(employeeId: string, month: string): Promise<AttendanceRecord[]> {
    const [year, mon] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      date: row.date,
      checkInTime: row.check_in_time,
      checkOutTime: row.check_out_time,
      checkInLatitude: row.check_in_latitude,
      checkInLongitude: row.check_in_longitude,
      checkOutLatitude: row.check_out_latitude,
      checkOutLongitude: row.check_out_longitude,
      status: computeEffectiveStatus(row.date, row.check_out_time, row.status),
      notes: row.notes,
    }));
  }

  export async function getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    const { data, error } = await supabase
      .from("attendance")
      .select("*, profiles:employee_id(name)")
      .eq("date", date)
      .order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      employeeId: row.employee_id,
      employeeName: (row.profiles as { name?: string } | null)?.name,
      date: row.date,
      checkInTime: row.check_in_time,
      checkOutTime: row.check_out_time,
      checkInLatitude: row.check_in_latitude,
      checkInLongitude: row.check_in_longitude,
      checkOutLatitude: row.check_out_latitude,
      checkOutLongitude: row.check_out_longitude,
      status: computeEffectiveStatus(row.date, row.check_out_time, row.status),
      notes: row.notes,
    }));
  }

  export async function adminCreateAttendance(input: {
    employeeId: string;
    date: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    status: string;
    notes: string | null;
  }): Promise<void> {
    const { error } = await supabase.from("attendance").insert({
      employee_id: input.employeeId,
      date: input.date,
      check_in_time: input.checkInTime ?? null,
      check_out_time: input.checkOutTime ?? null,
      status: input.status ?? "present",
      notes: input.notes ?? null,
    });
    assertNoError(error);
  }

  export async function submitAttendanceRegularization(input: {
    attendanceId: number;
    date: string;
    requestedCheckInTime: string | null;
    requestedCheckOutTime: string | null;
    reason: string | null;
  }): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from("attendance_regularizations").insert({
      attendance_id: input.attendanceId,
      employee_id: userId,
      date: input.date,
      requested_check_in_time: input.requestedCheckInTime,
      requested_check_out_time: input.requestedCheckOutTime,
      reason: input.reason,
    });
    assertNoError(error);
  }

  export async function listMyAttendanceRegularizations(): Promise<AttendanceRegularization[]> {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("attendance_regularizations")
      .select("*")
      .eq("employee_id", userId)
      .order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      attendanceId: row.attendance_id,
      employeeId: row.employee_id,
      date: row.date,
      requestedCheckInTime: row.requested_check_in_time,
      requestedCheckOutTime: row.requested_check_out_time,
      reason: row.reason,
      status: row.status,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  export async function listPendingAttendanceRegularizations(): Promise<AttendanceRegularization[]> {
    const { data, error } = await supabase
      .from("attendance_regularizations")
      .select("*, profiles:employee_id(name)")
      .eq("status", "pending")   // 
      .order("created_at", { ascending: false });
    assertNoError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      attendanceId: row.attendance_id,
      employeeId: row.employee_id,
      employeeName: (row.profiles as { name?: string } | null)?.name ?? null,
      date: row.date,
      requestedCheckInTime: row.requested_check_in_time,
      requestedCheckOutTime: row.requested_check_out_time,
      reason: row.reason,
      status: row.status,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }


  export async function approveAttendanceRegularization(regularizationId: number, status: "approved" | "rejected"): Promise<void> {
    const { error } = await supabase.rpc("approve_attendance_regularization", {
      p_regularization_id: regularizationId,
      p_new_status: status,
    });
    assertNoError(error);
  }

  export async function uploadProfilePhoto(
    userId: string,
    base64Data: string,
    mimeType: string,
    fileUri?: string,
  ): Promise<string> {
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const path = `profile-photos/${userId}-${Date.now()}.${ext}`;
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
    const uploadUrl = `${supabaseUrl}/storage/v1/object/documents/${path}`;
    const isNative = typeof navigator !== "undefined" && navigator.product === "ReactNative";

    if (isNative && fileUri) {
      const localResponse = await fetch(fileUri);
      const blob = await localResponse.blob();
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl, true);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", mimeType);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(blob);
      });
    } else {
      const byteChars = atob(base64Data);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType, "x-upsert": "true" },
        body: blob,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Upload failed (${response.status}): ${text}`);
      }
    }

    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    return data.publicUrl;
  }

  export async function uploadFileToStorage(path: string, file: Blob, mimeType: string): Promise<void> {
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: mimeType, upsert: false });
    assertNoError(error);
  }

  export function getPublicStorageUrl(path: string): string {
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    return data.publicUrl;
  }
  // ─── Office Locations ─────────────────────────────────────────────────────────

  // ─── Office Locations ─────────────────────────────────────────────────────────

  export type OfficeLocation = {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };

  export async function getMyOfficeLocation(): Promise<OfficeLocation | null> {
    const { data } = await supabase
      .from("office_locations")
      .select("id, name, latitude, longitude, radius_meters")
      .order("name")
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return { id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude, radiusMeters: data.radius_meters };
  }

  export async function listOfficeLocations(): Promise<OfficeLocation[]> {
    const { data, error } = await supabase
      .from("office_locations")
      .select("id, name, latitude, longitude, radius_meters")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map(r => ({ id: r.id, name: r.name, latitude: r.latitude, longitude: r.longitude, radiusMeters: r.radius_meters }));
  }

  export async function createOfficeLocation(input: {
    name: string; latitude: number; longitude: number; radiusMeters: number;
  }): Promise<OfficeLocation> {
    const { data, error } = await supabase
      .from("office_locations")
      .insert({ name: input.name, latitude: input.latitude, longitude: input.longitude, radius_meters: input.radiusMeters })
      .select("id, name, latitude, longitude, radius_meters")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude, radiusMeters: data.radius_meters };
  }

  export async function updateOfficeLocation(id: string, input: Partial<{
    name: string; latitude: number; longitude: number; radiusMeters: number;
  }>): Promise<OfficeLocation> {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.name != null) updates.name = input.name;
    if (input.latitude != null) updates.latitude = input.latitude;
    if (input.longitude != null) updates.longitude = input.longitude;
    if (input.radiusMeters != null) updates.radius_meters = input.radiusMeters;
    const { data, error } = await supabase
      .from("office_locations")
      .update(updates)
      .eq("id", id)
      .select("id, name, latitude, longitude, radius_meters")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, name: data.name, latitude: data.latitude, longitude: data.longitude, radiusMeters: data.radius_meters };
  }

  export async function deleteOfficeLocation(id: string): Promise<void> {
    const { error } = await supabase.from("office_locations").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }