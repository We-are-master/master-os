-- Migration 166: Real-time OS → Zendesk status sync via pg_net
--
-- When a job or quote linked to a Zendesk ticket changes status, fire an
-- async HTTP POST to the internal sync endpoint. The endpoint loads the row,
-- maps the internal status to a Zendesk custom_status_id, and updates the
-- ticket. This means partner-app status changes (in_progress, final_check,
-- completed) automatically reflect on the Zendesk ticket without any
-- application-level glue at the call site.
--
-- Configuration (one-time per environment, NOT in this migration):
-- Supabase managed Postgres doesn't allow ALTER DATABASE for custom GUCs by
-- non-superusers, so we read the URL + secret from Supabase Vault instead.
-- After this migration is applied, run via the SQL editor:
--   SELECT vault.create_secret('https://<host>/api/internal/zendesk/sync-status', 'zendesk_sync_url');
--   SELECT vault.create_secret('<matches ZENDESK_SYNC_INTERNAL_SECRET>',          'zendesk_sync_secret');
-- Until both secrets exist, the trigger is a no-op (logs a NOTICE).

-- ─── Enable pg_net (idempotent) ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─── Helper: dispatch the HTTP call ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.zendesk_sync_dispatch(
  p_entity text,
  p_id     uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  -- Read from Supabase Vault (created with vault.create_secret(value, name)).
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'zendesk_sync_url'    LIMIT 1;
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'zendesk_sync_secret' LIMIT 1;

  -- No-op if not configured for this environment yet.
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'zendesk_sync_dispatch skipped: vault secrets zendesk_sync_url / zendesk_sync_secret not set';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := jsonb_build_object('entity', p_entity, 'id', p_id),
    timeout_milliseconds := 5000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zendesk_sync_dispatch(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zendesk_sync_dispatch(text, uuid) TO postgres, service_role;

-- ─── Trigger function: jobs ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_jobs_zendesk_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only sync zendesk-linked rows.
  IF NEW.external_source IS DISTINCT FROM 'zendesk' THEN
    RETURN NEW;
  END IF;
  IF NEW.external_ref IS NULL OR NEW.external_ref = '' THEN
    RETURN NEW;
  END IF;
  -- Only fire on actual status transitions.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Soft-deleted jobs should not touch the ticket.
  IF NEW.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  PERFORM public.zendesk_sync_dispatch('job', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_zendesk_sync ON public.jobs;
CREATE TRIGGER trg_jobs_zendesk_sync
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_zendesk_sync();

-- ─── Trigger function: quotes ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_quotes_zendesk_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.external_source IS DISTINCT FROM 'zendesk' THEN
    RETURN NEW;
  END IF;
  IF NEW.external_ref IS NULL OR NEW.external_ref = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- converted_to_job hands the ticket lifecycle to the job; skip from quote side.
  IF NEW.status = 'converted_to_job' THEN
    RETURN NEW;
  END IF;

  PERFORM public.zendesk_sync_dispatch('quote', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotes_zendesk_sync ON public.quotes;
CREATE TRIGGER trg_quotes_zendesk_sync
  AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quotes_zendesk_sync();

COMMENT ON FUNCTION public.zendesk_sync_dispatch(text, uuid) IS
  'Posts {entity, id} to the internal /api/internal/zendesk/sync-status endpoint via pg_net. Reads URL + secret from vault (zendesk_sync_url, zendesk_sync_secret). No-op if either secret is missing.';

COMMENT ON FUNCTION public.tg_jobs_zendesk_sync() IS
  'AFTER UPDATE OF status ON jobs — fires the Zendesk status sync for zendesk-linked jobs whose status actually changed (excludes deleted).';

COMMENT ON FUNCTION public.tg_quotes_zendesk_sync() IS
  'AFTER UPDATE OF status ON quotes — fires the Zendesk status sync for zendesk-linked quotes whose status actually changed (excludes converted_to_job, which is handled by the job).';
