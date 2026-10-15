-- 335: livro de notas do parceiro (partner_feedback), que nunca chegou à produção.
--
-- A 233 criava esta tabela, mas ela não existe no banco (16/10/2026: PGRST205).
-- Sem ela, reclamação e elogio não ficam registrados no parceiro e o "Add rating"
-- da ficha falha. Esta versão é a 233 com duas mudanças:
--   1. Acesso só da equipe (regra da 331). A 233 abria leitura e escrita para
--      qualquer login, inclusive parceiro.
--   2. A nota usa a mesma conta do app (src/lib/partner-rating.ts): começa em 5,
--      +0,25 por elogio, -0,25 por reclamação, entre 0 e 5. A 233 usava outra.
--
-- Backfill: 12 reclamações de jobs já em on hold por complaint; 0 elogios
-- (nenhum job concluído com review 4+ hoje). Só os parceiros dessas 12 têm a
-- nota recalculada.

BEGIN;

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
  'Rating ledger for partners: complaints lower the score, praise (review 4+ or staff kudos) raises it.';

-- Só a equipe (mesmo par da 331). O portal lê com a chave de serviço.
ALTER TABLE public.partner_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read partner_feedback" ON public.partner_feedback;
DROP POLICY IF EXISTS "Authenticated can insert partner_feedback" ON public.partner_feedback;
DROP POLICY IF EXISTS staff_all ON public.partner_feedback;
CREATE POLICY staff_all ON public.partner_feedback FOR ALL TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());
DROP POLICY IF EXISTS staff_only ON public.partner_feedback;
CREATE POLICY staff_only ON public.partner_feedback AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_internal_staff()) WITH CHECK (public.is_internal_staff());

-- Reclamações que já existem: jobs em on hold por complaint.
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

-- Elogios que já existem: job concluído com review 4+ (hoje nenhum).
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
  AND j.customer_review_rating >= 4
ON CONFLICT DO NOTHING;

-- Nota com a conta do app, só para quem tem registro.
UPDATE public.partners p
SET rating = sub.nota
FROM (
  SELECT
    partner_id,
    GREATEST(0, LEAST(5, ROUND((5
      + 0.25 * COUNT(*) FILTER (WHERE kind = 'praise')
      - 0.25 * COUNT(*) FILTER (WHERE kind = 'complaint'))::numeric, 1))) AS nota
  FROM public.partner_feedback
  GROUP BY partner_id
) sub
WHERE p.id = sub.partner_id;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência depois de rodar:
-- SELECT kind, count(*) FROM public.partner_feedback GROUP BY kind;
-- SELECT p.company_name, p.rating FROM public.partners p
--   WHERE p.id IN (SELECT partner_id FROM public.partner_feedback) ORDER BY p.rating;
