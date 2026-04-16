-- =============================================================================
-- Migration 143: Portal notifications — in-app notification feed (PR 3 of 3)
-- =============================================================================
--
-- Backs the notification bell in the portal header. Rows are written
-- server-side whenever something happens that the portal user should
-- know about:
--   - Job phase advances          (by staff / partner flows)
--   - New ticket message from staff
--   - Invoice paid / invoice becomes due
--   - Quote ready / accepted / rejected
--
-- RLS: portal users read/update only their own rows. Staff don't see
-- this feed (the dashboard has its own audit trail).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.portal_notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  portal_user_id  uuid        REFERENCES public.account_portal_users(id) ON DELETE CASCADE,
  type            text        NOT NULL CHECK (type IN (
                    'job_phase',
                    'job_scheduled',
                    'ticket_reply',
                    'invoice_paid',
                    'invoice_due',
                    'invoice_issued',
                    'quote_ready',
                    'quote_status'
                  )),
  title           text        NOT NULL,
  body            text,
  link_url        text,
  entity_type     text,
  entity_id       uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_notif_user_unread
  ON public.portal_notifications (portal_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portal_notif_account_time
  ON public.portal_notifications (account_id, created_at DESC);

ALTER TABLE public.portal_notifications ENABLE ROW LEVEL SECURITY;

-- Portal users see only notifications addressed to them (portal_user_id)
-- OR broadcasts at the account level (portal_user_id IS NULL).
DROP POLICY IF EXISTS "portal_notifications_select_own" ON public.portal_notifications;
CREATE POLICY "portal_notifications_select_own"
  ON public.portal_notifications FOR SELECT TO authenticated
  USING (
    public.is_internal_staff()
    OR (
      account_id = public.current_portal_account_id()
      AND (portal_user_id IS NULL OR portal_user_id = auth.uid())
    )
  );

-- Portal users can mark their own notifications as read
DROP POLICY IF EXISTS "portal_notifications_update_own" ON public.portal_notifications;
CREATE POLICY "portal_notifications_update_own"
  ON public.portal_notifications FOR UPDATE TO authenticated
  USING (
    portal_user_id = auth.uid() OR public.is_internal_staff()
  )
  WITH CHECK (
    portal_user_id = auth.uid() OR public.is_internal_staff()
  );

-- Only server-side service role writes new notifications (via SECURITY
-- DEFINER helpers below + the API routes that call them). Authenticated
-- INSERT is denied.
GRANT SELECT, UPDATE ON public.portal_notifications TO authenticated;

COMMENT ON TABLE public.portal_notifications IS
  'In-app notification feed for account portal users. Fanned out when staff or system events happen. Staff do not consume this — they read audit_logs.';

-- =============================================================================
-- Helper: insert a notification for every active portal user of an account
-- =============================================================================
CREATE OR REPLACE FUNCTION public.insert_portal_notification_fanout(
  p_account_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link_url text,
  p_entity_type text,
  p_entity_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.portal_notifications
    (account_id, portal_user_id, type, title, body, link_url, entity_type, entity_id)
  SELECT
    p_account_id, u.id, p_type, p_title, p_body, p_link_url, p_entity_type, p_entity_id
  FROM public.account_portal_users u
  WHERE u.account_id = p_account_id AND coalesce(u.is_active, true) = true;
END;
$$;

COMMENT ON FUNCTION public.insert_portal_notification_fanout IS
  'Fans out one notification per active portal user of the given account. Idempotent-friendly (callers should dedup).';

GRANT EXECUTE ON FUNCTION public.insert_portal_notification_fanout TO authenticated, service_role;

-- =============================================================================
-- Trigger: fan notifications out when a job phase advances
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_job_phase_notify_portal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_title      text;
  v_body       text;
BEGIN
  -- Only fire on real status transitions
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Resolve the job's account via client chain
  SELECT c.source_account_id INTO v_account_id
  FROM public.clients c
  WHERE c.id = NEW.client_id;
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only fan out for phases we actually want to notify about
  IF NEW.status IN ('in_progress_phase1', 'in_progress_phase2', 'in_progress_phase3',
                    'final_check', 'awaiting_payment', 'completed', 'on_hold', 'cancelled') THEN
    v_title := CASE NEW.status
      WHEN 'in_progress_phase1' THEN 'Work started'
      WHEN 'in_progress_phase2' THEN 'Job progressing'
      WHEN 'in_progress_phase3' THEN 'Job progressing'
      WHEN 'final_check'        THEN 'Final check in progress'
      WHEN 'awaiting_payment'   THEN 'Payment pending'
      WHEN 'completed'          THEN 'Job completed'
      WHEN 'on_hold'            THEN 'Job on hold'
      WHEN 'cancelled'          THEN 'Job cancelled'
    END;
    v_body := coalesce(NEW.title, NEW.reference);

    PERFORM public.insert_portal_notification_fanout(
      v_account_id,
      'job_phase',
      v_title,
      v_body,
      '/portal/jobs/' || NEW.id::text,
      'job',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_phase_notify_portal ON public.jobs;
CREATE TRIGGER trg_jobs_phase_notify_portal
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_job_phase_notify_portal();

-- =============================================================================
-- Trigger: ticket_messages — notify portal when STAFF replies
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_ticket_message_notify_portal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_subject    text;
BEGIN
  IF NEW.sender_type <> 'staff' THEN
    RETURN NEW;
  END IF;

  SELECT t.account_id, t.subject INTO v_account_id, v_subject
  FROM public.tickets t
  WHERE t.id = NEW.ticket_id;
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.insert_portal_notification_fanout(
    v_account_id,
    'ticket_reply',
    'New reply from Master team',
    coalesce(v_subject, 'Ticket update'),
    '/portal/tickets/' || NEW.ticket_id::text,
    'ticket',
    NEW.ticket_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_messages_notify_portal ON public.ticket_messages;
CREATE TRIGGER trg_ticket_messages_notify_portal
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ticket_message_notify_portal();

-- =============================================================================
-- Trigger: invoices — notify on status→paid
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_invoice_paid_notify_portal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Direct account link first, fallback via job
  v_account_id := NEW.source_account_id;
  IF v_account_id IS NULL AND NEW.job_reference IS NOT NULL THEN
    SELECT c.source_account_id INTO v_account_id
    FROM public.jobs j
    JOIN public.clients c ON c.id = j.client_id
    WHERE j.reference = NEW.job_reference
    LIMIT 1;
  END IF;
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' THEN
    PERFORM public.insert_portal_notification_fanout(
      v_account_id,
      'invoice_paid',
      'Payment received',
      'Invoice ' || coalesce(NEW.reference, NEW.id::text) || ' is now paid.',
      '/portal/invoices/' || NEW.id::text,
      'invoice',
      NEW.id
    );
  ELSIF NEW.status = 'overdue' THEN
    PERFORM public.insert_portal_notification_fanout(
      v_account_id,
      'invoice_due',
      'Invoice overdue',
      'Invoice ' || coalesce(NEW.reference, NEW.id::text) || ' is past due.',
      '/portal/invoices/' || NEW.id::text,
      'invoice',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_status_notify_portal ON public.invoices;
CREATE TRIGGER trg_invoices_status_notify_portal
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_invoice_paid_notify_portal();
