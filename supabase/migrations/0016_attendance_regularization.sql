-- ============================================================
-- Attendance Regularization + Midnight Auto-Absent
-- ============================================================

-- 1. Drop old auto-checkout cron (replaced by midnight auto-absent)
SELECT cron.unschedule('auto-checkout-630');

-- 2. Create attendance_regularizations table
CREATE TABLE IF NOT EXISTS public.attendance_regularizations (
  id BIGSERIAL PRIMARY KEY,
  attendance_id BIGINT NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  requested_check_in_time TIMESTAMPTZ,
  requested_check_out_time TIMESTAMPTZ,
  reason TEXT,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_employee_id ON public.attendance_regularizations(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_status ON public.attendance_regularizations(status);
CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_date ON public.attendance_regularizations(date);
CREATE INDEX IF NOT EXISTS idx_attendance_regularizations_attendance_id ON public.attendance_regularizations(attendance_id);

-- Enable RLS
ALTER TABLE public.attendance_regularizations ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies

-- Employees: select own
CREATE POLICY attendance_regularizations_select_own
  ON public.attendance_regularizations
  FOR SELECT
  USING (employee_id = auth.uid());

-- Managers/Admins: select direct reports or all
CREATE POLICY attendance_regularizations_select_manager
  ON public.attendance_regularizations
  FOR SELECT
  USING (
    public.current_role() IN ('admin', 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_id AND p.manager_id = auth.uid()
    )
  );

-- Employees: insert own
CREATE POLICY attendance_regularizations_insert_own
  ON public.attendance_regularizations
  FOR INSERT
  WITH CHECK (employee_id = auth.uid());

-- Managers/Admins: update status (approve/reject)
CREATE POLICY attendance_regularizations_update_manager
  ON public.attendance_regularizations
  FOR UPDATE
  USING (
    public.current_role() IN ('admin', 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_id AND p.manager_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_role() IN ('admin', 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_id AND p.manager_id = auth.uid()
    )
  );

-- 4. Auto-mark absent at midnight IST (6:30 PM UTC)
CREATE OR REPLACE FUNCTION public.auto_mark_absent_at_midnight()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.attendance
  SET
    status = 'absent',
    notes = CASE
      WHEN notes IS NULL THEN 'Auto-marked absent: no check-out by midnight'
      ELSE notes || ' | Auto-marked absent: no check-out by midnight'
    END,
    updated_at = NOW()
  WHERE
    date = CURRENT_DATE
    AND check_in_time IS NOT NULL
    AND check_out_time IS NULL
    AND status IS DISTINCT FROM 'absent';
END;
$$;

-- Schedule: daily at 6:30 PM UTC = midnight IST
SELECT cron.schedule(
  'auto-absent-midnight',
  '30 18 * * *',
  'SELECT public.auto_mark_absent_at_midnight();'
);

-- 5. Approval function (atomic update of regularization + attendance)
CREATE OR REPLACE FUNCTION public.approve_attendance_regularization(
  p_regularization_id BIGINT,
  p_new_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reg RECORD;
  v_worked_hours DOUBLE PRECISION;
  v_derived_status TEXT;
BEGIN
  -- Fetch regularization
  SELECT * INTO v_reg
  FROM public.attendance_regularizations
  WHERE id = p_regularization_id;

  IF v_reg IS NULL THEN
    RAISE EXCEPTION 'Regularization not found';
  END IF;

  IF v_reg.status != 'pending' THEN
    RAISE EXCEPTION 'Regularization is not pending';
  END IF;

  -- Update regularization record
  UPDATE public.attendance_regularizations
  SET
    status = p_new_status,
    resolved_by = auth.uid(),
    resolved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_regularization_id;

  -- If approved, update attendance with requested times and recompute status
  IF p_new_status = 'approved' THEN
    IF v_reg.requested_check_in_time IS NOT NULL AND v_reg.requested_check_out_time IS NOT NULL THEN
      v_worked_hours := EXTRACT(EPOCH FROM (v_reg.requested_check_out_time - v_reg.requested_check_in_time)) / 3600;

      IF v_worked_hours >= 8 THEN
        v_derived_status := 'present';
      ELSIF v_worked_hours >= 4 THEN
        v_derived_status := 'half_day';
      ELSE
        v_derived_status := 'absent';
      END IF;
    ELSE
      v_derived_status := 'absent';
    END IF;

    UPDATE public.attendance
    SET
      check_in_time = v_reg.requested_check_in_time,
      check_out_time = v_reg.requested_check_out_time,
      check_in_latitude = NULL,
      check_in_longitude = NULL,
      check_out_latitude = NULL,
      check_out_longitude = NULL,
      status = v_derived_status,
      notes = CASE
        WHEN notes IS NULL THEN 'Regularized'
        ELSE notes || ' | Regularized'
      END,
      updated_at = NOW()
    WHERE id = v_reg.attendance_id;
  END IF;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.auto_mark_absent_at_midnight() TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_attendance_regularization(BIGINT, TEXT) TO service_role;
