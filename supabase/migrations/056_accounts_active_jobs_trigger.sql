-- Keep accounts.active_jobs and accounts.total_revenue in sync automatically.
-- active_jobs  = count of non-deleted, non-completed/cancelled jobs for the account's clients
-- total_revenue = sum of client_price for completed jobs

-- ── Helper function ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_refresh_account_stats(p_account_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.accounts
  SET
    active_jobs = (
      SELECT COUNT(*)
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE c.source_account_id = p_account_id
        AND j.deleted_at IS NULL
        AND j.status NOT IN ('completed', 'cancelled', 'archived')
    ),
    total_revenue = COALESCE((
      SELECT SUM(j.client_price)
      FROM public.jobs j
      JOIN public.clients c ON c.id = j.client_id
      WHERE c.source_account_id = p_account_id
        AND j.deleted_at IS NULL
        AND j.status = 'completed'
    ), 0)
  WHERE id = p_account_id;
END;
$$;

-- ── Trigger function on jobs ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_update_account_stats_from_job()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Determine which account to refresh (use whichever client_id is non-null)
  IF TG_OP = 'DELETE' THEN
    SELECT c.source_account_id INTO v_account_id
    FROM public.clients c WHERE c.id = OLD.client_id;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT c.source_account_id INTO v_account_id
    FROM public.clients c WHERE c.id = NEW.client_id;
  ELSE -- UPDATE
    -- Refresh old account if client changed
    IF OLD.client_id IS DISTINCT FROM NEW.client_id AND OLD.client_id IS NOT NULL THEN
      SELECT c.source_account_id INTO v_account_id
      FROM public.clients c WHERE c.id = OLD.client_id;
      IF v_account_id IS NOT NULL THEN
        PERFORM fn_refresh_account_stats(v_account_id);
      END IF;
    END IF;
    SELECT c.source_account_id INTO v_account_id
    FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;

  IF v_account_id IS NOT NULL THEN
    PERFORM fn_refresh_account_stats(v_account_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_account_stats_from_job ON public.jobs;
CREATE TRIGGER trg_account_stats_from_job
  AFTER INSERT OR UPDATE OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION fn_update_account_stats_from_job();

-- ── Backfill all accounts ─────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.accounts WHERE deleted_at IS NULL LOOP
    PERFORM fn_refresh_account_stats(r.id);
  END LOOP;
END;
$$;
