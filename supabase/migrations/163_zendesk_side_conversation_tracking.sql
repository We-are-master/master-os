-- Migration 163: Track Zendesk side conversation per job + per-event log
--
-- Adds:
--   jobs.zendesk_side_conversation_id  — set after the FIRST side
--                                        conversation is opened for the job;
--                                        subsequent status changes reply to
--                                        the same thread instead of opening
--                                        a new one.
--
--   job_zendesk_events                  — append-only log of every
--                                        side-conv message we sent (assigned,
--                                        status_changed, cancelled, on_hold)
--                                        with success/error so the dashboard
--                                        can render history and retry.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS zendesk_side_conversation_id text;

CREATE INDEX IF NOT EXISTS idx_jobs_zendesk_side_conversation_id
  ON public.jobs (zendesk_side_conversation_id)
  WHERE zendesk_side_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.job_zendesk_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind                text        NOT NULL CHECK (kind IN ('assigned', 'status_changed', 'cancelled', 'on_hold', 'resumed', 'completed', 'rescheduled')),
  status_at_event     text,
  push_ok             boolean     NOT NULL DEFAULT false,
  push_tokens_sent    integer     NOT NULL DEFAULT 0,
  push_error          text,
  zendesk_ok          boolean     NOT NULL DEFAULT false,
  zendesk_message_id  text,
  zendesk_error       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_job_zendesk_events_job_id
  ON public.job_zendesk_events (job_id, created_at DESC);

ALTER TABLE public.job_zendesk_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_zendesk_events_staff_all" ON public.job_zendesk_events;
CREATE POLICY "job_zendesk_events_staff_all"
  ON public.job_zendesk_events FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());
