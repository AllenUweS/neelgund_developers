-- ============================================================================
-- Neelgund-Tracker-Pro: Performance Indexes for Supabase
-- ============================================================================
-- Run this in your Supabase Dashboard > SQL Editor.
-- These indexes target the slowest queries identified in the mobile app.
-- They are all CREATE IF NOT EXISTS, so safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ATTENDANCE TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- getAttendanceToday: .eq("employee_id", userId).eq("date", today)
-- This is the most frequently called query (every screen load, every 60s poll)
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
  ON attendance (employee_id, date);

-- getAttendanceByMonth: .eq("employee_id", userId).gte("date", start).lte("date", end)
-- Already covered by idx_attendance_employee_date (composite, date ordering)

-- getAttendanceSummaryByMonth (admin): .gte("date", start).lte("date", end)
-- This needs a date-first index for range scans across ALL employees
CREATE INDEX IF NOT EXISTS idx_attendance_date
  ON attendance (date);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. LOCATION_POINTS TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- getLocationTrail: .eq("employee_id", id).gte("recorded_at", start).lte("recorded_at", end)
-- listEmployeeLocationsByDate: .gte("recorded_at", start).lte("recorded_at", end)
-- These are the heaviest queries — location_points can have 1000s of rows/day
CREATE INDEX IF NOT EXISTS idx_location_points_employee_recorded
  ON location_points (employee_id, recorded_at DESC);

-- For admin map view: range scan across all employees by time
CREATE INDEX IF NOT EXISTS idx_location_points_recorded_at
  ON location_points (recorded_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. LEADS TABLE / VIEW
-- ────────────────────────────────────────────────────────────────────────────

-- listLeads orders by created_at DESC — index accelerates sorting
CREATE INDEX IF NOT EXISTS idx_leads_created_at
  ON leads (created_at DESC);

-- Lead detail: .eq("id", leadId) — primary key should handle this, but just in case
-- the leads_with_employee VIEW joins on employee_id:
CREATE INDEX IF NOT EXISTS idx_leads_employee_id
  ON leads (employee_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. LEAD SUB-TABLES (meetings, activities, documents)
-- ────────────────────────────────────────────────────────────────────────────

-- All three filter by lead_id and order by a timestamp
CREATE INDEX IF NOT EXISTS idx_lead_meetings_lead_id
  ON lead_meetings (lead_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id
  ON lead_activities (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_documents_lead_id
  ON lead_documents (lead_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. TRACKING_STATUS TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- listTrackingStatus: .order("updated_at", { ascending: false })
CREATE INDEX IF NOT EXISTS idx_tracking_status_updated
  ON tracking_status (updated_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. PROFILES TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- listManagers: .eq("role", "manager")
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles (role);

-- ============================================================================
-- VERIFY: Run this to check all indexes were created
-- ============================================================================
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;
