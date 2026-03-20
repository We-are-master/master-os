-- Global soft-delete foundation
-- Adds deleted_at/deleted_by to main entities and indexes for fast active-row filters.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at ON accounts (deleted_at);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients (deleted_at);

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_deleted_at ON service_requests (deleted_at);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_deleted_at ON quotes (deleted_at);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at ON jobs (deleted_at);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices (deleted_at);

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_deleted_at ON team_members (deleted_at);

ALTER TABLE squads ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE squads ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_squads_deleted_at ON squads (deleted_at);

ALTER TABLE job_payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE job_payments ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_job_payments_deleted_at ON job_payments (deleted_at);

ALTER TABLE dashboard_views ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE dashboard_views ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_views_deleted_at ON dashboard_views (deleted_at);
