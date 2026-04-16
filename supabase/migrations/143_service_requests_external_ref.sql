-- Migration 144: External integration source on service_requests
--
-- Adds columns + unique index to support idempotent inbound webhooks
-- (Zoho Desk, future ones). external_source = vendor key, external_ref =
-- vendor's stable id (e.g. Zoho ticket id). Re-delivery of the same
-- (source, ref) pair updates instead of creating a duplicate.
--
-- Also relaxes the source check to include "portal" (used since migration 029
-- was authored) and "zoho_desk" (this migration's reason for existing).

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_ref    text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_requests_external_ref
  ON public.service_requests (external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

ALTER TABLE public.service_requests DROP CONSTRAINT IF EXISTS service_requests_source_check;
ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_source_check CHECK (
  source IN ('whatsapp', 'checkatrade', 'meta', 'website', 'b2b', 'manual', 'portal', 'zoho_desk')
);
