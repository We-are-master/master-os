-- Migration 167: Zendesk lifecycle dispatch tracking
--
-- Adds idempotency timestamps for the one-shot customer-facing notices fired
-- by src/lib/zendesk-lifecycle.ts, and extends the status-sync trigger from
-- migration 166 to also fire on INSERT (so jobs created from quote-accept
-- propagate to the ticket without an explicit application call).
--
-- Lifecycle events:
--   jobs.job_creation_notice_sent_at   — booking confirmation reply + partner
--                                        side conv on first creation.
--   jobs.completion_notice_sent_at     — short "job complete" public reply.
--   jobs.cancellation_notice_sent_at   — short cancellation public reply.
--   quotes.rejection_notice_sent_at    — short "quote closed" public reply.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_creation_notice_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completion_notice_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_notice_sent_at  timestamptz;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS rejection_notice_sent_at timestamptz;

-- Re-create the status-sync trigger functions to also handle INSERT. On
-- INSERT we don't have OLD.status to compare against, so we fire whenever
-- the row is Zendesk-linked and not in a skipped status.

CREATE OR REPLACE FUNCTION public.tg_jobs_zendesk_sync()
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
  IF NEW.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  PERFORM public.zendesk_sync_dispatch('job', NEW.id);
  RETURN NEW;
END;
$$;

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
  IF NEW.status = 'converted_to_job' THEN
    RETURN NEW;
  END IF;

  PERFORM public.zendesk_sync_dispatch('quote', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_zendesk_sync   ON public.jobs;
DROP TRIGGER IF EXISTS trg_quotes_zendesk_sync ON public.quotes;

CREATE TRIGGER trg_jobs_zendesk_sync
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_zendesk_sync();

CREATE TRIGGER trg_quotes_zendesk_sync
  AFTER INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quotes_zendesk_sync();

COMMENT ON COLUMN public.jobs.job_creation_notice_sent_at IS
  'When the customer confirmation reply + partner side conv were posted to the linked Zendesk ticket. Idempotency for src/lib/zendesk-lifecycle.ts dispatchJobCreatedZendesk.';
COMMENT ON COLUMN public.jobs.completion_notice_sent_at IS
  'When the "job completed" public reply was posted to the linked Zendesk ticket.';
COMMENT ON COLUMN public.jobs.cancellation_notice_sent_at IS
  'When the cancellation public reply was posted to the linked Zendesk ticket.';
COMMENT ON COLUMN public.quotes.rejection_notice_sent_at IS
  'When the "quote closed" public reply was posted to the linked Zendesk ticket.';
