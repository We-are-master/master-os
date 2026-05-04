-- =============================================================================
-- Migration 161: job_visits — visitas adicionais (visit 2+) num mesmo job
-- =============================================================================
--
-- Modelo:
--   - Visit 1 (primary) = campos diretos do job (partner_id, scheduled_date,
--     client_price, partner_cost, scope, etc.). Não há row em job_visits.
--   - Visit 2+ = uma row por visit em job_visits, com visit_index >= 2.
--
-- Use case: handyman descobre no local que precisa eletricista + gas; office
-- adiciona visitas novas ao mesmo job, cada uma com partner / service / data /
-- preço próprios. Também cobre PPM jobs com múltiplos partners pré-bookados.
--
-- Self-bill / invoice rollup multi-visit fica para próximo sprint — neste
-- sprint a tabela serve de ledger interno + render no calendar.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.job_visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  /** 1-based ordering within the job. Operator-added visits start at 2 (visit 1 = job primary). */
  visit_index         integer NOT NULL,

  /** Catalog service for THIS visit (independent of the parent job's service). */
  catalog_service_id  uuid REFERENCES public.service_catalog(id) ON DELETE SET NULL,

  /** Partner allocated to this specific visit. Independent of parent job's partner_id. */
  partner_id          uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  partner_name        text,

  /** Scheduling — each visit has its own slot. */
  scheduled_date      date,
  scheduled_start_at  timestamptz,
  scheduled_end_at    timestamptz,
  expected_finish_at  timestamptz,

  /** Pricing — snapshotted at create time from the resolver (catalog + per-account + per-partner overrides). */
  client_price        numeric NOT NULL DEFAULT 0,
  partner_cost        numeric NOT NULL DEFAULT 0,
  materials_cost      numeric NOT NULL DEFAULT 0,

  /** Per-visit lifecycle. Parent job has its own status independently. */
  status              text NOT NULL DEFAULT 'scheduled',

  scope               text,
  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_visits_status_check'
  ) THEN
    ALTER TABLE public.job_visits
      ADD CONSTRAINT job_visits_status_check
      CHECK (status IN ('scheduled','in_progress','completed','cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_visits_index_min_check'
  ) THEN
    ALTER TABLE public.job_visits
      ADD CONSTRAINT job_visits_index_min_check
      CHECK (visit_index >= 2);
  END IF;
END $$;

-- One live visit per (job, index). Soft-deleted rows excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_visits_index_live
  ON public.job_visits(job_id, visit_index) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_visits_job
  ON public.job_visits(job_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_visits_partner
  ON public.job_visits(partner_id) WHERE deleted_at IS NULL AND partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_visits_schedule
  ON public.job_visits(scheduled_date) WHERE deleted_at IS NULL AND scheduled_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_visits_status
  ON public.job_visits(status) WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_job_visits_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_job_visits_updated_at ON public.job_visits;
CREATE TRIGGER trg_touch_job_visits_updated_at
  BEFORE UPDATE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.touch_job_visits_updated_at();

ALTER TABLE public.job_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_visits_authenticated_all" ON public.job_visits;
CREATE POLICY "job_visits_authenticated_all"
  ON public.job_visits FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.job_visits IS
  'Per-job extra visits (index 2+). Visit 1 = parent job''s primary fields. Each visit can have its own partner/service/schedule/price. Self-bill rollup is deferred to a future sprint.';
COMMENT ON COLUMN public.job_visits.visit_index IS
  '2+ — visit 1 is the parent job itself. Unique per job_id (live rows).';
