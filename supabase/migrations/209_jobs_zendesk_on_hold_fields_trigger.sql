-- Fire Zendesk sync when on-hold metadata changes (not only status).

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
  IF NEW.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.on_hold_reason_preset_id IS NOT DISTINCT FROM NEW.on_hold_reason_preset_id
     AND OLD.on_hold_complaint_description IS NOT DISTINCT FROM NEW.on_hold_complaint_description
     AND OLD.on_hold_submission IS NOT DISTINCT FROM NEW.on_hold_submission THEN
    RETURN NEW;
  END IF;

  PERFORM public.zendesk_sync_dispatch('job', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_zendesk_sync ON public.jobs;
CREATE TRIGGER trg_jobs_zendesk_sync
  AFTER UPDATE OF status, on_hold_reason_preset_id, on_hold_complaint_description, on_hold_submission
  ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_zendesk_sync();

COMMENT ON FUNCTION public.tg_jobs_zendesk_sync() IS
  'AFTER UPDATE on zendesk-linked jobs — syncs ticket when status or on-hold fields (reason id, complaint description, partner solution) change.';
