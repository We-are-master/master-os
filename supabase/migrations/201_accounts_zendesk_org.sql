-- Migration 201: Link accounts to Zendesk Organisations + Users.
--
-- Same idea as migration 200 for partners: every account in the OS is
-- mirrored into Zendesk as an Organisation (🏢 prefix) plus a Zendesk user
-- for the primary contact. Side conversations, tickets, and reporting in
-- Zendesk can then be filtered by the OS account.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS zendesk_organization_id text,
  ADD COLUMN IF NOT EXISTS zendesk_user_id         text;

CREATE INDEX IF NOT EXISTS idx_accounts_zendesk_organization_id
  ON public.accounts (zendesk_organization_id)
  WHERE zendesk_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_zendesk_user_id
  ON public.accounts (zendesk_user_id)
  WHERE zendesk_user_id IS NOT NULL;

COMMENT ON COLUMN public.accounts.zendesk_organization_id IS
  'Zendesk organisation id created on account creation (🏢 emoji prefix). Used to scope side conversations to the account in Zendesk.';
COMMENT ON COLUMN public.accounts.zendesk_user_id IS
  'Zendesk user id (the primary account contact) created on account creation. Side conversations targeting this user_id appear under the account organisation.';
