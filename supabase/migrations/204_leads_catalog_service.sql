-- Migration 204: Link leads to a service_catalog row (type of work).
--
-- Staff picks the Type of Work in the New Lead modal — same canonical list
-- jobs and quotes already use. The Trade Portal then targets the lead to
-- partners whose `catalog_service_ids` array (or `trades` text array) covers
-- this row, instead of broadcasting every published lead to everyone.
--
-- Column is nullable: legacy leads created before this migration have NULL
-- and the portal explicitly keeps broadcasting those to preserve current
-- behaviour for in-flight work.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS catalog_service_id uuid
    REFERENCES public.service_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_catalog_service_id
  ON public.leads (catalog_service_id)
  WHERE catalog_service_id IS NOT NULL;

COMMENT ON COLUMN public.leads.catalog_service_id IS
  'Selected Services catalog row for the type of work. Drives Trade Portal targeting: only partners whose catalog_service_ids contain this UUID (or whose trades label matches by name/synonym) see the lead. NULL for legacy leads, which keep broadcasting to every active partner (subject to postcode and contact-cap filters).';
