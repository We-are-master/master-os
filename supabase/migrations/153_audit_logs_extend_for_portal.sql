-- =============================================================================
-- Migration 153: extend audit_logs to cover portal actions
-- =============================================================================
--
-- audit_logs (mig 005) only allows entity_type in:
--   ('request', 'quote', 'job', 'invoice', 'partner', 'account',
--    'self_bill', 'system')
--
-- Portal users now create tickets and post messages, neither of which
-- have a slot in that enum. Without this migration, attempts to log a
-- "portal user opened ticket TKT-..." event fail the CHECK and abort
-- the parent transaction.
--
-- Add 'ticket' to the allowed entity types. ticket_messages reuse
-- entity_type = 'ticket' with entity_id = the ticket uuid; the action
-- + metadata distinguish "created" vs "note" (new message).
--
-- Idempotent: drops the old constraint and recreates with the wider list.
-- Rerunning is a no-op because the new constraint name is identical and
-- the IF EXISTS / NOT EXISTS guards make both halves safe.
-- =============================================================================

-- Drop the existing CHECK constraint by name. Postgres auto-names CHECKs
-- as "<table>_<column>_check" — but mig 005 used inline CHECK so the
-- generated name is `audit_logs_entity_type_check`. Defensive lookup
-- below handles either spelling.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.audit_logs'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%entity_type%IN%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_logs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_entity_type_check
  CHECK (entity_type IN (
    'request',
    'quote',
    'job',
    'invoice',
    'partner',
    'account',
    'self_bill',
    'system',
    'ticket'      -- NEW: portal user support tickets + messages
  ));

COMMENT ON CONSTRAINT audit_logs_entity_type_check ON public.audit_logs IS
  'Allowed entity types — extended in mig 153 to include ticket so portal user actions can be audited.';
