-- Migration: Sync Drizzle ORM schema changes
-- Run this via Supabase SQL Editor if Drizzle push is unavailable.
-- All statements use IF NOT EXISTS / IF EXISTS guards for safety.

-- 1. Ensure pg_trgm extension exists (used for text search indexes if needed later)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Users table: ensure id defaults to random UUID
-- (Drizzle schema uses .defaultRandom() which maps to gen_random_uuid())
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END $$;

-- 3. Lead source enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'lead_source'
  ) THEN
    CREATE TYPE public.lead_source AS ENUM (
      'referral', 'walk_in', 'online', 'social', 'broker', 'cold_call', 'field_activity'
    );
  END IF;
END $$;

-- 4. Lead priority enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'lead_priority'
  ) THEN
    CREATE TYPE public.lead_priority AS ENUM ('hot', 'warm', 'cold');
  END IF;
END $$;

-- 5. Convert leads.source from text to lead_source enum (safely)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'source'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE public.leads
      ALTER COLUMN source TYPE public.lead_source
      USING source::public.lead_source;
  END IF;
END $$;

-- 6. Convert leads.priority from text to lead_priority enum (safely)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'priority'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE public.leads
      ALTER COLUMN priority TYPE public.lead_priority
      USING priority::public.lead_priority;
  END IF;
END $$;

-- 7. Indexes on leads table
CREATE INDEX IF NOT EXISTS leads_employee_id_idx ON public.leads(employee_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(status);
CREATE INDEX IF NOT EXISTS leads_source_idx ON public.leads(source);
CREATE INDEX IF NOT EXISTS leads_priority_idx ON public.leads(priority);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads(created_at);

-- 8. Indexes on attendance table
CREATE INDEX IF NOT EXISTS attendance_employee_id_idx ON public.attendance(employee_id);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance(date);

-- 9. Indexes on location_points table
CREATE INDEX IF NOT EXISTS location_points_employee_id_idx ON public.location_points(employee_id);
CREATE INDEX IF NOT EXISTS location_points_recorded_at_idx ON public.location_points(recorded_at);
