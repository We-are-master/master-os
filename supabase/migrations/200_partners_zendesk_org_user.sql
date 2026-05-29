-- Migration 200: Link partners to Zendesk Organisations + Users.
--
-- Every partner created in the OS should also exist in Zendesk as an
-- Organisation (the company) and a User (the contact), so that:
--   - side conversations on jobs can target the partner's Zendesk user_id
--     instead of just an email (Zendesk threads them into the partner's
--     org view + makes filtering/reporting easy)
--   - the office can see all jobs/quotes/side convs for a given partner
--     filtered by Zendesk organisation
--
-- Sync happens fire-and-forget right after partner creation
-- (src/lib/zendesk-partner-sync.ts → syncPartnerToZendesk).

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS zendesk_organization_id text,
  ADD COLUMN IF NOT EXISTS zendesk_user_id         text;

CREATE INDEX IF NOT EXISTS idx_partners_zendesk_organization_id
  ON public.partners (zendesk_organization_id)
  WHERE zendesk_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_zendesk_user_id
  ON public.partners (zendesk_user_id)
  WHERE zendesk_user_id IS NOT NULL;

COMMENT ON COLUMN public.partners.zendesk_organization_id IS
  'Zendesk organisation id created on partner signup. Used to scope side conversations to the partner''s company in Zendesk.';
COMMENT ON COLUMN public.partners.zendesk_user_id IS
  'Zendesk user id (the partner contact) created on partner signup. Side conversations target this user_id so they appear under the partner organisation in Zendesk.';
