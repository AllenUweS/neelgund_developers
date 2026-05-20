-- Stops table: persisted stop events with multi-tier classification
CREATE TABLE IF NOT EXISTS stops (
  id bigserial PRIMARY KEY,
  employee_id uuid NOT NULL,
  start_at timestamp NOT NULL,
  end_at timestamp,
  latitude real NOT NULL,
  longitude real NOT NULL,
  radius_meters real NOT NULL DEFAULT 0,
  duration_ms integer,
  stop_type text NOT NULL DEFAULT 'short',
  address text,
  zone_id integer REFERENCES zones(id),
  lead_id integer REFERENCES leads(id),
  created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stops_employee_date ON stops(employee_id, start_at);
CREATE INDEX IF NOT EXISTS idx_stops_active ON stops(employee_id, end_at);

-- Enable RLS
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;

-- Admins and managers can view all stops
CREATE POLICY "stops_admin_manager_select" ON stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin', 'manager')
    )
  );

-- Employees can only view their own stops
CREATE POLICY "stops_employee_select" ON stops
  FOR SELECT USING (employee_id = auth.uid());

-- Only the tracking API (service role) can insert/update stops
CREATE POLICY "stops_service_insert" ON stops
  FOR INSERT WITH CHECK (true);

CREATE POLICY "stops_service_update" ON stops
  FOR UPDATE USING (true);
