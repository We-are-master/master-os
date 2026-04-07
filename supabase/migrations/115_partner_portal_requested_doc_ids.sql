-- Which requirement IDs this portal link allows (JSON array of strings, e.g. ["photo_id","dbs"]).
-- NULL = legacy links (before this feature): allow full checklist on the portal.
ALTER TABLE public.partner_portal_tokens
  ADD COLUMN IF NOT EXISTS requested_doc_ids jsonb;

COMMENT ON COLUMN public.partner_portal_tokens.requested_doc_ids IS
  'Subset of portal requirement ids this link may upload; null means unrestricted (legacy).';
