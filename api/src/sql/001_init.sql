-- Off Tracker backend schema (PostgreSQL 14+)
-- Canonical storage for grants/usages/allocations/audit with soft-delete support.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grant_status_enum') THEN
    CREATE TYPE grant_status_enum AS ENUM ('UNUSED', 'PARTIAL', 'USED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reason_type_enum') THEN
    CREATE TYPE reason_type_enum AS ENUM ('OPS', 'OTHERS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'usage_session_enum') THEN
    CREATE TYPE usage_session_enum AS ENUM ('FULL', 'AM', 'PM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'VIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personnel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS personnel_name_active_uniq
ON personnel (lower(name))
WHERE deleted_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS grant_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS usage_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS log_code_seq START 1;

CREATE OR REPLACE FUNCTION next_grant_code() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'G-' || lpad(nextval('grant_code_seq')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION next_usage_code() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'U-' || lpad(nextval('usage_code_seq')::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION next_log_code() RETURNS TEXT
LANGUAGE sql AS $$
  SELECT 'L-' || lpad(nextval('log_code_seq')::text, 5, '0');
$$;

CREATE TABLE IF NOT EXISTS off_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_code TEXT NOT NULL UNIQUE DEFAULT next_grant_code(),
  personnel_id UUID NOT NULL REFERENCES personnel(id),
  granted_date DATE NOT NULL,
  duration_value NUMERIC(3,1) NOT NULL CHECK (duration_value IN (0.5, 1.0)),
  reason_type reason_type_enum NOT NULL,
  weekend_ops_duty_date DATE NULL,
  reason_details TEXT NOT NULL DEFAULT '',
  provided_by TEXT NOT NULL DEFAULT '',
  used_value NUMERIC(4,1) NOT NULL DEFAULT 0.0 CHECK (used_value >= 0),
  remaining_value NUMERIC(4,1) NOT NULL CHECK (remaining_value >= 0),
  status grant_status_enum NOT NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id),
  CHECK (used_value + remaining_value = duration_value),
  CHECK (
    (reason_type = 'OPS' AND weekend_ops_duty_date IS NOT NULL)
    OR
    (reason_type = 'OTHERS')
  )
);

CREATE INDEX IF NOT EXISTS off_grants_personnel_idx
ON off_grants (personnel_id, granted_date, grant_code)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS off_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_code TEXT NOT NULL UNIQUE DEFAULT next_usage_code(),
  personnel_id UUID NOT NULL REFERENCES personnel(id),
  intended_date DATE NOT NULL,
  session usage_session_enum NOT NULL,
  duration_used NUMERIC(3,1) NOT NULL CHECK (duration_used IN (0.5, 1.0)),
  comments TEXT NOT NULL DEFAULT '',
  undone_at TIMESTAMPTZ NULL,
  undone_by UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES users(id),
  updated_by UUID NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS off_usages_personnel_idx
ON off_usages (personnel_id, intended_date, usage_code)
WHERE undone_at IS NULL;

CREATE TABLE IF NOT EXISTS off_usage_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_id UUID NOT NULL REFERENCES off_usages(id),
  grant_id UUID NOT NULL REFERENCES off_grants(id),
  amount NUMERIC(3,1) NOT NULL CHECK (amount > 0),
  allocation_order INT NOT NULL CHECK (allocation_order > 0),
  reversed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_alloc_order_uniq
ON off_usage_allocations (usage_id, allocation_order)
WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS usage_alloc_usage_idx
ON off_usage_allocations (usage_id)
WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS usage_alloc_grant_idx
ON off_usage_allocations (grant_id)
WHERE reversed_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_code TEXT NOT NULL UNIQUE DEFAULT next_log_code(),
  event_type TEXT NOT NULL,
  personnel_id UUID NULL REFERENCES personnel(id),
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_json JSONB NULL,
  after_json JSONB NULL,
  request_id TEXT NULL,
  actor_id UUID NULL REFERENCES users(id),
  actor_email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_personnel_idx
ON audit_events (personnel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_type_idx
ON audit_events (event_type, created_at DESC);

-- Optional trigger helper to keep updated_at in sync.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personnel_set_updated_at ON personnel;
CREATE TRIGGER personnel_set_updated_at
BEFORE UPDATE ON personnel
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS grants_set_updated_at ON off_grants;
CREATE TRIGGER grants_set_updated_at
BEFORE UPDATE ON off_grants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS usages_set_updated_at ON off_usages;
CREATE TRIGGER usages_set_updated_at
BEFORE UPDATE ON off_usages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
