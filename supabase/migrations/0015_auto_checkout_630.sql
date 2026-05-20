-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create function to auto-checkout users at 6:30 PM
CREATE OR REPLACE FUNCTION public.auto_checkout_at_630()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update all attendance records for today that have check-in but no check-out
  -- Set check-out time to 18:30:00 (6:30 PM)
  UPDATE public.attendance
  SET 
    check_out_time = to_char(CURRENT_DATE, 'YYYY-MM-DD') || ' 18:30:00'::timestamptz,
    check_out_latitude = NULL,
    check_out_longitude = NULL,
    status = CASE
      -- Calculate duration in hours
      WHEN EXTRACT(EPOCH FROM (to_char(CURRENT_DATE, 'YYYY-MM-DD') || ' 18:30:00'::timestamptz - check_in_time)) / 3600 >= 8 THEN 'present'
      WHEN EXTRACT(EPOCH FROM (to_char(CURRENT_DATE, 'YYYY-MM-DD') || ' 18:30:00'::timestamptz - check_in_time)) / 3600 >= 4 THEN 'half_day'
      ELSE 'absent'
    END,
    notes = CASE
      WHEN notes IS NULL THEN 'Auto-checkout at 6:30 PM'
      ELSE notes || ' | Auto-checkout at 6:30 PM'
    END,
    updated_at = now()
  WHERE 
    date = CURRENT_DATE
    AND check_in_time IS NOT NULL
    AND check_out_time IS NULL;
END;
$$;

-- Schedule the function to run daily at 6:30 PM IST (UTC+5:30 = 13:00 UTC)
SELECT cron.schedule(
  'auto-checkout-630',
  '0 13 * * *', -- 1:00 PM UTC = 6:30 PM IST
  'SELECT public.auto_checkout_at_630();'
);

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.auto_checkout_at_630() TO service_role;
