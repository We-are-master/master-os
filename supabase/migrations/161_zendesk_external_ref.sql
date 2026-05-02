-- Migration 161: Zendesk integration — ensure external_source/ref exist on
-- jobs, quotes, service_requests + accept 'zendesk' in the source enum.
--
-- Idempotent: safe to re-run. Consolidates the older 143-146 migrations that
-- targeted Zoho Desk. The Zendesk ticket id lives in `external_ref` (with
-- `external_source = 'zendesk'`) — no separate column needed.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_external_ref
  ON public.jobs (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_external_ref
  ON public.quotes (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_requests_external_ref
  ON public.service_requests (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.service_requests DROP CONSTRAINT IF EXISTS service_requests_source_check;
ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_source_check CHECK (
  source IN ('whatsapp', 'checkatrade', 'meta', 'website', 'b2b', 'manual', 'portal', 'zoho_desk', 'zendesk')
);
