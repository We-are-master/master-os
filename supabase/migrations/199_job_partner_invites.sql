-- Migration 199: Per-partner invites for auto-assigning jobs.
--
-- When a job arrives via Zendesk macro with assignment_mode='auto', the OS
-- broadcasts a side conversation (Accept-link email) to each matched partner.
-- This table is the source of truth for "who was invited", their individual
-- Zendesk side conversation thread, and who eventually claimed the job.
--
-- The first partner to POST /api/jobs/confirm-acceptance wins via an atomic
-- UPDATE on jobs (status='auto_assigning' AND partner_id IS NULL). The winner's
-- side_conversation_id is then promoted to jobs.zendesk_side_conversation_id
-- so all future status notices (booked, in-progress, completed) reply on the
-- same thread. Losers' side conversations are closed via the Zendesk API.

CREATE TABLE IF NOT EXISTS public.job_partner_invites (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                         uuid        NOT NULL REFERENCES public.jobs(id)     ON DELETE CASCADE,
  partner_id                     uuid        NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  /** Per-partner Zendesk side conversation opened on the job's main ticket. */
  zendesk_side_conversation_id   text,
  /** invited → accepted (winner) / lost (someone else won) / expired (TTL hit). */
  status                         text        NOT NULL DEFAULT 'invited',
  invited_at                     timestamptz NOT NULL DEFAULT now(),
  decided_at                     timestamptz,
  CONSTRAINT job_partner_invites_status_check
    CHECK (status IN ('invited', 'accepted', 'lost', 'expired')),
  UNIQUE (job_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_job_partner_invites_job_id
  ON public.job_partner_invites (job_id);

CREATE INDEX IF NOT EXISTS idx_job_partner_invites_partner_id_status
  ON public.job_partner_invites (partner_id, status);

ALTER TABLE public.job_partner_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_partner_invites_staff_all" ON public.job_partner_invites;
CREATE POLICY "job_partner_invites_staff_all"
  ON public.job_partner_invites FOR ALL TO authenticated
  USING (public.is_internal_staff())
  WITH CHECK (public.is_internal_staff());

COMMENT ON TABLE public.job_partner_invites IS
  'Per-partner invite for an auto-assigning job. One row per (job_id, partner_id). Tracks the side conversation thread and the claim outcome (invited/accepted/lost/expired).';
