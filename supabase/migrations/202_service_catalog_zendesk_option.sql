-- Migration 202: Link service_catalog rows to a Zendesk tagger field option.
--
-- Same idea as migrations 200 / 201 for partners and accounts: every Type of
-- Work in the OS (service_catalog) is mirrored as an option on the Zendesk
-- "Type of Work" ticket field (a tagger / dropdown). Macros and tickets can
-- then pick the OS type of work directly. The option's `value` (tag) is the
-- OS service_catalog.id (UUID) so the inbound /api/jobs webhook can resolve
-- it back via the existing catalog_service_id handling.

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS zendesk_option_id text;

CREATE INDEX IF NOT EXISTS idx_service_catalog_zendesk_option_id
  ON public.service_catalog (zendesk_option_id)
  WHERE zendesk_option_id IS NOT NULL;

COMMENT ON COLUMN public.service_catalog.zendesk_option_id IS
  'Zendesk custom_field_option id on the Type of Work tagger field (env ZENDESK_TYPE_OF_WORK_FIELD_ID). NULL when not yet synced (e.g. legacy rows before mig 202 or Zendesk unreachable at creation time). The option''s tag value mirrors service_catalog.id so the inbound webhook can resolve it.';
