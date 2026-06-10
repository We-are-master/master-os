-- Partner rating events: complaints (job on hold) and praise (customer review / manual kudos).

CREATE TABLE IF NOT EXISTS public.partner_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('complaint', 'praise')),
  source text NOT NULL CHECK (source IN ('job_on_hold', 'customer_review', 'manual')),
  notes text,
  job_reference text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_feedback_partner_created
  ON public.partner_feedback (partner_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_feedback_job_kind_source
  ON public.partner_feedback (partner_id, job_id, kind, source)
  WHERE job_id IS NOT NULL;

COMMENT ON TABLE public.partner_feedback IS
  'Rating ledger for partners — complaints reduce score; praise (review / kudos) increases it.';

ALTER TABLE public.partner_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read partner_feedback" ON public.partner_feedback;
CREATE POLICY "Authenticated can read partner_feedback"
  ON public.partner_feedback FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert partner_feedback" ON public.partner_feedback;
CREATE POLICY "Authenticated can insert partner_feedback"
  ON public.partner_feedback FOR INSERT TO authenticated WITH CHECK (true);

-- Backfill complaint events from existing complaint on-hold jobs.
INSERT INTO public.partner_feedback (partner_id, job_id, kind, source, notes, job_reference, created_at)
SELECT
  j.partner_id,
  j.id,
  'complaint',
  'job_on_hold',
  NULLIF(TRIM(COALESCE(j.on_hold_complaint_description, j.on_hold_reason, '')), ''),
  j.reference,
  COALESCE(j.on_hold_at, j.updated_at, j.created_at)
FROM public.jobs j
WHERE j.partner_id IS NOT NULL
  AND j.deleted_at IS NULL
  AND j.on_hold_reason_preset_id = 'complaint'
ON CONFLICT DO NOTHING;

-- Backfill praise from completed jobs with strong customer reviews (4+ stars).
INSERT INTO public.partner_feedback (partner_id, job_id, kind, source, notes, job_reference, created_at)
SELECT
  j.partner_id,
  j.id,
  'praise',
  'customer_review',
  'Customer review ' || j.customer_review_rating::text || '/5',
  j.reference,
  COALESCE(j.completed_date::timestamptz, j.updated_at, j.created_at)
FROM public.jobs j
WHERE j.partner_id IS NOT NULL
  AND j.deleted_at IS NULL
  AND j.status = 'completed'
  AND j.customer_review_rating IS NOT NULL
  AND j.customer_review_rating >= 4
ON CONFLICT DO NOTHING;

-- Recompute stored partner ratings from the new ledger.
UPDATE public.partners p
SET rating = sub.computed
FROM (
  SELECT
    pf.partner_id,
    GREATEST(
      0,
      LEAST(
        5,
        ROUND(
          (
            5
            + COALESCE(SUM(CASE WHEN pf.kind = 'praise' THEN 0.25 ELSE 0 END), 0)
            - COALESCE(
                SUM(
                  CASE
                    WHEN pf.kind = 'complaint' THEN
                      0.5 * CASE
                        WHEN j.status = 'cancelled' THEN 1
                        WHEN j.status = 'completed' THEN 0.5
                        ELSE 1
                      END
                    ELSE 0
                  END
                ),
                0
              )
          )::numeric,
          1
        )
      )
    ) AS computed
  FROM public.partner_feedback pf
  LEFT JOIN public.jobs j ON j.id = pf.job_id
  GROUP BY pf.partner_id
) sub
WHERE p.id = sub.partner_id;
