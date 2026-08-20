-- Migration 260: pg_trgm indexes for staff search (ilike) columns
--
-- No pg_trgm extension or GIN trigram index exists anywhere in this repo's
-- migrations (checked all 258 prior files). Every `.ilike("%x%")` search —
-- Accounts, Clients, Partners directory, Jobs, Quotes, Invoices, Leads,
-- Requests — runs a sequential scan across the searched columns on every
-- keystroke. Data volumes are small today (low hundreds of rows per table),
-- so this isn't the dominant slowness right now, but it's cheap, purely
-- additive (IF NOT EXISTS), and prevents these searches from degrading as
-- each table grows. Columns below are exactly the `searchColumns` used by
-- `queryList()` (src/services/base.ts) for each table — see accounts.ts,
-- clients.ts, partners.ts (listPartnersLegacy), jobs.ts (listJobs),
-- quotes.ts, invoices.ts (legacy fallback), leads.ts, requests.ts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- accounts (src/services/accounts.ts:162)
CREATE INDEX IF NOT EXISTS idx_accounts_trgm_company_name ON public.accounts USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_trgm_contact_name ON public.accounts USING gin (contact_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_trgm_email        ON public.accounts USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_trgm_finance_email ON public.accounts USING gin (finance_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_trgm_industry     ON public.accounts USING gin (industry gin_trgm_ops);

-- clients (src/services/clients.ts:7)
CREATE INDEX IF NOT EXISTS idx_clients_trgm_full_name ON public.clients USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_trgm_email     ON public.clients USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_trgm_phone     ON public.clients USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_trgm_city      ON public.clients USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_trgm_address   ON public.clients USING gin (address gin_trgm_ops);

-- partners (src/services/partners.ts listPartnersLegacy + RPC bundle search)
CREATE INDEX IF NOT EXISTS idx_partners_trgm_company_name ON public.partners USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_partners_trgm_contact_name ON public.partners USING gin (contact_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_partners_trgm_email        ON public.partners USING gin (email gin_trgm_ops);

-- jobs (src/services/jobs.ts listJobs, every tab branch)
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_reference        ON public.jobs USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_title             ON public.jobs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_client_name        ON public.jobs USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_partner_name       ON public.jobs USING gin (partner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_trgm_property_address   ON public.jobs USING gin (property_address gin_trgm_ops);

-- quotes (src/services/quotes.ts)
CREATE INDEX IF NOT EXISTS idx_quotes_trgm_reference    ON public.quotes USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_trgm_title        ON public.quotes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_trgm_client_name  ON public.quotes USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_trgm_client_email ON public.quotes USING gin (client_email gin_trgm_ops);

-- invoices (src/services/invoices.ts legacy fallback path)
CREATE INDEX IF NOT EXISTS idx_invoices_trgm_reference     ON public.invoices USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_invoices_trgm_client_name   ON public.invoices USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_invoices_trgm_job_reference ON public.invoices USING gin (job_reference gin_trgm_ops);

-- leads (src/services/leads.ts)
CREATE INDEX IF NOT EXISTS idx_leads_trgm_reference ON public.leads USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_trgm_name      ON public.leads USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_trgm_email     ON public.leads USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_trgm_phone     ON public.leads USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_trgm_address   ON public.leads USING gin (address gin_trgm_ops);

-- service_requests (src/services/requests.ts)
CREATE INDEX IF NOT EXISTS idx_service_requests_trgm_reference        ON public.service_requests USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_service_requests_trgm_client_name      ON public.service_requests USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_service_requests_trgm_client_email     ON public.service_requests USING gin (client_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_service_requests_trgm_property_address ON public.service_requests USING gin (property_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_service_requests_trgm_service_type     ON public.service_requests USING gin (service_type gin_trgm_ops);
