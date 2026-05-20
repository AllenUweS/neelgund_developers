-- Enrich location_points with tracking metadata columns
ALTER TABLE location_points
  ADD COLUMN IF NOT EXISTS speed_kmh real,
  ADD COLUMN IF NOT EXISTS heading real,
  ADD COLUMN IF NOT EXISTS altitude real,
  ADD COLUMN IF NOT EXISTS battery_level integer,
  ADD COLUMN IF NOT EXISTS activity_type text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'background';

-- Composite index for fast employee+date trail queries
CREATE INDEX IF NOT EXISTS idx_location_points_employee_date_full
  ON location_points(employee_id, recorded_at);
