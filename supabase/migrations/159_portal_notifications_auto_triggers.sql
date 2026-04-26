-- =============================================================================
-- Migration 159: auto-insert portal_notifications on key events
-- =============================================================================
--
-- Postgres triggers that push a row into portal_notifications whenever
-- an event a portal user cares about happens. Events covered:
--
-- 1. Job status → 'completed'                  → "Job completed"
-- 2. Quote status → 'awaiting_customer'        → "Quote awaiting your decision"
-- 3. Invoice INSERT (any active status)        → "Invoice issued"
-- 4. Compliance cert status flips to expiring  → "Cert expiring"
--
-- Each trigger resolves the notification's account_id by walking the
-- entity → clients.source_account_id chain (or the direct account_id
-- on tables that carry it). portal_user_id is left NULL so the notif
-- broadcasts to every portal user in the account.
--
-- All trigger functions are SECURITY DEFINER so they bypass the
-- portal_notifications INSERT policy (mig 148 doesn't grant INSERT to
-- authenticated). Idempotent — re-runs DROP+CREATE the trigger.
-- =============================================================================

-- =============================================
-- helper: resolve account_id from a job row
-- =============================================
CREATE OR REPLACE FUNCTION public._account_id_for_job(p_job_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.source_account_id
  FROM public.jobs j
  JOIN public.clients c ON c.id = j.client_id
  WHERE j.id = p_job_id
  LIMIT 1
$$;

-- =============================================
-- 1. job status → completed
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_portal_on_job_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Only fire on transitions INTO completed, never on every UPDATE.
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  v_account_id := public._account_id_for_job(NEW.id);
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.portal_notifications (
      account_id, portal_user_id, type, title, body,
      link_url, entity_type, entity_id
    )
    VALUES (
      v_account_id,
      NULL,
      'job_completed',
      'Job completed',
      COALESCE(NEW.title, 'Job') || ' has been completed by Fixfy.',
      '/jobs/' || NEW.id,
      'job',
      NEW.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_portal_on_job_completed insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_portal_on_job_completed ON public.jobs;
CREATE TRIGGER trg_notify_portal_on_job_completed
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_portal_on_job_completed();

-- =============================================
-- 2. quote status → awaiting_customer
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_portal_on_quote_awaiting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF NEW.status <> 'awaiting_customer' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'awaiting_customer' THEN
    RETURN NEW;
  END IF;

  -- Walk client_id → clients.source_account_id.
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.source_account_id INTO v_account_id
  FROM public.clients c
  WHERE c.id = NEW.client_id
  LIMIT 1;
  IF v_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.portal_notifications (
      account_id, portal_user_id, type, title, body,
      link_url, entity_type, entity_id
    )
    VALUES (
      v_account_id,
      NULL,
      'quote_awaiting',
      'Quote awaiting your decision',
      COALESCE(NEW.title, 'Quote') || ' is ready for you to approve or decline.',
      '/requests?tab=awaiting_quote&id=' || NEW.id,
      'quote',
      NEW.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_portal_on_quote_awaiting insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_portal_on_quote_awaiting ON public.quotes;
CREATE TRIGGER trg_notify_portal_on_quote_awaiting
  AFTER INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.notify_portal_on_quote_awaiting();

-- =============================================
-- 3. invoice issued
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_portal_on_invoice_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Only on INSERT — invoices don't get reissued.
  v_account_id := NEW.source_account_id;

  -- Fallback: walk through the linked job → client → account_id.
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

  BEGIN
    INSERT INTO public.portal_notifications (
      account_id, portal_user_id, type, title, body,
      link_url, entity_type, entity_id
    )
    VALUES (
      v_account_id,
      NULL,
      'invoice_issued',
      'Invoice issued',
      'Invoice ' || COALESCE(NEW.reference, '') || ' has been issued for £' ||
        COALESCE(NEW.amount::text, '0') || '.',
      '/invoices/' || NEW.id,
      'invoice',
      NEW.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_portal_on_invoice_issued insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_portal_on_invoice_issued ON public.invoices;
CREATE TRIGGER trg_notify_portal_on_invoice_issued
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.notify_portal_on_invoice_issued();

-- =============================================
-- 4. compliance cert flips to expiring/expired
-- =============================================
CREATE OR REPLACE FUNCTION public.notify_portal_on_compliance_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('expiring', 'expired') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.portal_notifications (
      account_id, portal_user_id, type, title, body,
      link_url, entity_type, entity_id
    )
    VALUES (
      NEW.account_id,
      NULL,
      CASE WHEN NEW.status = 'expired' THEN 'compliance_expired' ELSE 'compliance_due' END,
      CASE WHEN NEW.status = 'expired' THEN 'Compliance certificate expired' ELSE 'Compliance certificate expiring' END,
      'Your ' || replace(NEW.certificate_type, '_', ' ') || ' certificate ' ||
        CASE WHEN NEW.status = 'expired' THEN 'has expired' ELSE 'is expiring soon' END ||
        ' (' || to_char(NEW.expiry_date, 'DD Mon YYYY') || ').',
      '/sites',
      'cert',
      NEW.id::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_portal_on_compliance_alert insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_portal_on_compliance_alert ON public.account_compliance_certificates;
CREATE TRIGGER trg_notify_portal_on_compliance_alert
  AFTER INSERT OR UPDATE OF status ON public.account_compliance_certificates
  FOR EACH ROW EXECUTE FUNCTION public.notify_portal_on_compliance_alert();

-- =============================================
-- helper RPC: nightly compliance status sweep
-- =============================================
-- Walks every active cert and bumps status to 'expiring' (≤30 days) or
-- 'expired' (<0 days) where appropriate. Idempotent. Schedule via
-- pg_cron / Supabase cron or call from a Vercel cron route.
CREATE OR REPLACE FUNCTION public.refresh_compliance_cert_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  WITH next_status AS (
    SELECT
      id,
      CASE
        WHEN expiry_date < CURRENT_DATE THEN 'expired'
        WHEN expiry_date - CURRENT_DATE <= 30 THEN 'expiring'
        ELSE 'ok'
      END AS new_status
    FROM public.account_compliance_certificates
    WHERE deleted_at IS NULL
  )
  UPDATE public.account_compliance_certificates c
  SET status = ns.new_status, updated_at = NOW()
  FROM next_status ns
  WHERE c.id = ns.id AND c.status <> ns.new_status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_compliance_cert_statuses() TO authenticated;

COMMENT ON FUNCTION public.refresh_compliance_cert_statuses() IS
  'Recomputes status (ok/expiring/expired) for all active compliance certs based on expiry_date vs today. Schedule daily via Supabase cron. The status change fires the notify_portal_on_compliance_alert trigger automatically.';
