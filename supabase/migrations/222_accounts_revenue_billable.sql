-- Account total_revenue: count billable work (awaiting payment + collected), not only completed jobs.
-- Includes open/paid invoices linked to the account; avoids double-counting job + invoice.

CREATE OR REPLACE FUNCTION public.fn_account_revenue_amount(p_account_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(x.amt), 0)
  FROM (
    -- Jobs awaiting customer payment or already completed, when no live invoice row owns the amount.
    SELECT
      (COALESCE(j.client_price, 0) + COALESCE(j.extras_amount, 0))::numeric AS amt
    FROM public.jobs j
    INNER JOIN public.clients c ON c.id = j.client_id
    WHERE c.source_account_id = p_account_id
      AND j.deleted_at IS NULL
      AND j.status IN ('awaiting_payment', 'completed')
      AND NOT EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.deleted_at IS NULL
          AND i.id = j.invoice_id
          AND i.status NOT IN ('cancelled', 'draft', 'audit_required')
      )

    UNION ALL

    -- Invoices billed to this B2B account (paid, open, partial, overdue, awaiting_payment).
    SELECT COALESCE(i.amount, 0)::numeric AS amt
    FROM public.invoices i
    WHERE i.deleted_at IS NULL
      AND i.source_account_id = p_account_id
      AND i.status NOT IN ('cancelled', 'draft', 'audit_required')

  ) x;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_account_stats(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.accounts
  SET
    active_jobs = (
      SELECT COUNT(*)
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE c.source_account_id = p_account_id
        AND j.deleted_at IS NULL
        AND j.status NOT IN ('completed', 'cancelled', 'deleted')
    ),
    total_revenue = public.fn_account_revenue_amount(p_account_id)
  WHERE id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_account_stats_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id uuid;
  v_job_ref text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_account_id := OLD.source_account_id;
    v_job_ref := OLD.job_reference;
  ELSE
    v_account_id := NEW.source_account_id;
    v_job_ref := NEW.job_reference;
  END IF;

  IF v_account_id IS NOT NULL THEN
    PERFORM public.fn_refresh_account_stats(v_account_id);
  END IF;

  IF v_job_ref IS NOT NULL AND trim(v_job_ref) <> '' THEN
    FOR v_account_id IN
      SELECT DISTINCT c.source_account_id
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.reference = trim(v_job_ref)
        AND j.deleted_at IS NULL
        AND c.source_account_id IS NOT NULL
    LOOP
      PERFORM public.fn_refresh_account_stats(v_account_id);
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.source_account_id IS DISTINCT FROM NEW.source_account_id AND OLD.source_account_id IS NOT NULL THEN
    PERFORM public.fn_refresh_account_stats(OLD.source_account_id);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.job_reference IS DISTINCT FROM NEW.job_reference AND OLD.job_reference IS NOT NULL THEN
    FOR v_account_id IN
      SELECT DISTINCT c.source_account_id
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE j.reference = trim(OLD.job_reference)
        AND j.deleted_at IS NULL
        AND c.source_account_id IS NOT NULL
    LOOP
      PERFORM public.fn_refresh_account_stats(v_account_id);
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_account_stats_from_invoice ON public.invoices;
CREATE TRIGGER trg_account_stats_from_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_account_stats_from_invoice();

COMMENT ON FUNCTION public.fn_account_revenue_amount IS
  'Billable customer revenue for an account: awaiting_payment/completed jobs plus open/paid invoices.';

-- Backfill all accounts after definition change.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.accounts WHERE deleted_at IS NULL LOOP
    PERFORM public.fn_refresh_account_stats(r.id);
  END LOOP;
END;
$$;
