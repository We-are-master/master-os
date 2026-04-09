-- =============================================================================
-- Migration 133: Tickets — B2B support communication channel
-- =============================================================================
--
-- Tickets are the primary way corporate account portal users communicate
-- with the internal Master team. Each ticket has a bidirectional chat
-- thread (portal user + staff), an optional link to a job, and type +
-- priority classifications.
--
-- Purely additive — no existing tables altered.
-- =============================================================================

-- =============================================
-- 1. SEQUENCE + RPC for ticket reference
-- =============================================
CREATE SEQUENCE IF NOT EXISTS public.ticket_seq START 1;

CREATE OR REPLACE FUNCTION public.next_ticket_ref()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'TKT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.ticket_seq')::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_ticket_ref() TO authenticated;

-- =============================================
-- 2. TABLE: tickets
-- =============================================
CREATE TABLE IF NOT EXISTS public.tickets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    text        UNIQUE NOT NULL,
  account_id   uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_id       uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  subject      text        NOT NULL,
  type         text        NOT NULL DEFAULT 'general'
               CHECK (type IN ('general', 'billing', 'job_related', 'complaint')),
  priority     text        NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status       text        NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'awaiting_customer', 'resolved', 'closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_account_status
  ON public.tickets (account_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_status_priority
  ON public.tickets (status, priority);
CREATE INDEX IF NOT EXISTS idx_tickets_job_id
  ON public.tickets (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to
  ON public.tickets (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_created_at
  ON public.tickets (created_at DESC);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read all tickets" ON public.tickets;
CREATE POLICY "Authenticated can read all tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert tickets" ON public.tickets;
CREATE POLICY "Authenticated can insert tickets"
  ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update tickets" ON public.tickets;
CREATE POLICY "Authenticated can update tickets"
  ON public.tickets FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated;

COMMENT ON TABLE public.tickets IS 'B2B support tickets. Portal users create; internal staff respond. Each ticket has a bidirectional chat thread (ticket_messages).';

-- =============================================
-- 3. TABLE: ticket_messages
-- =============================================
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid        NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_type  text        NOT NULL CHECK (sender_type IN ('portal_user', 'staff')),
  sender_name  text,
  body         text        NOT NULL,
  attachments  jsonb       DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_time
  ON public.ticket_messages (ticket_id, created_at);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read all ticket messages" ON public.ticket_messages;
CREATE POLICY "Authenticated can read all ticket messages"
  ON public.ticket_messages FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert ticket messages" ON public.ticket_messages;
CREATE POLICY "Authenticated can insert ticket messages"
  ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.ticket_messages TO authenticated;

COMMENT ON TABLE public.ticket_messages IS 'Chat thread messages within a ticket. sender_type distinguishes portal users from internal staff.';
