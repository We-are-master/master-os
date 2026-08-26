-- =============================================================================
-- Migration 274: colunas de rollup das visitas em `jobs`
-- =============================================================================
--
-- Contexto: mig 161 criou `job_visits`, onde a **visita 1 é o próprio job** e as
-- visitas 2+ são linhas na tabela. O dinheiro das visitas 2+ nunca foi lido por
-- nada. Estas colunas dão ao job o total das visitas SEM mudar o significado das
-- colunas que já existem.
--
-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ `jobs.client_price`, `jobs.partner_cost` e `jobs.materials_cost` continuam  │
-- │ significando **a visita 1**. Nunca vire "total do job".                     │
-- │                                                                             │
-- │ Motivo: `recomputeSelfBillTotals` e `refreshSelfBillPayoutState`            │
-- │ (src/services/self-bills.ts) fazem                                          │
-- │   SELECT partner_cost, materials_cost FROM jobs WHERE self_bill_id = ?      │
-- │ e somam. Self-bill é POR PARCEIRO. Se `partner_cost` virar o total, o       │
-- │ documento fiscal do parceiro da visita 1 absorve o dinheiro do parceiro da  │
-- │ visita 2, em silêncio, num papel que o parceiro assina.                     │
-- │                                                                             │
-- │ Os `total_*` daqui são para EXIBIÇÃO e MARGEM. Nada que paga parceiro pode  │
-- │ lê-los. Payout lê linha por linha.                                          │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- Segurança da adoção: o backfill deixa `total_* = coluna da visita 1` em todo
-- job existente. Trocar um leitor de `client_price` para `total_client_price` é
-- portanto no-op de comportamento até aquele job ganhar uma visita 2 — dá pra
-- migrar leitor por leitor, em qualquer ordem, sem cutover.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS visits_count        integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_client_price  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_partner_cost  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_materials_cost numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.jobs.client_price IS
  'Preço do cliente da VISITA 1 (mig 161: visita 1 = o próprio job). O total do job está em total_client_price.';
COMMENT ON COLUMN public.jobs.partner_cost IS
  'Custo do parceiro da VISITA 1. NUNCA transformar em total do job: self-bill soma esta coluna por parceiro (self-bills.ts). O total está em total_partner_cost.';
COMMENT ON COLUMN public.jobs.visits_count IS
  'Visitas vivas do job, contando a visita 1 (o próprio job). Mantido por tg_recompute_job_visit_rollup.';
COMMENT ON COLUMN public.jobs.total_partner_cost IS
  'Somatório do custo de parceiro de todas as visitas. Exibição e margem apenas — NADA que paga parceiro pode ler daqui.';

-- -----------------------------------------------------------------------------
-- Recompute. A regra de "esta visita conta como dinheiro" está escrita duas
-- vezes: aqui e em `visitCountsForMoney` (src/lib/job-visit-rollup.ts).
-- Mudou uma, muda a outra.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_job_visit_rollup(p_job_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.jobs j
  SET
    visits_count = 1 + coalesce(v.cnt, 0),
    total_client_price   = coalesce(j.client_price, 0)    + coalesce(v.client_price, 0),
    total_partner_cost   = coalesce(j.partner_cost, 0)    + coalesce(v.partner_cost, 0),
    total_materials_cost = coalesce(j.materials_cost, 0)  + coalesce(v.materials_cost, 0)
  FROM (
    SELECT
      count(*)                            AS cnt,
      coalesce(sum(client_price), 0)      AS client_price,
      coalesce(sum(partner_cost), 0)      AS partner_cost,
      coalesce(sum(materials_cost), 0)    AS materials_cost
    FROM public.job_visits
    WHERE job_id = p_job_id
      AND deleted_at IS NULL
      AND status <> 'cancelled'
  ) v
  WHERE j.id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.tg_recompute_job_visit_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Visita movida de job (não acontece hoje, mas o gatilho não pode confiar nisso).
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.job_id IS NOT NULL THEN
    PERFORM public.recompute_job_visit_rollup(OLD.job_id);
  END IF;
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.job_id IS NOT NULL THEN
    PERFORM public.recompute_job_visit_rollup(NEW.job_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_visits_rollup ON public.job_visits;
CREATE TRIGGER trg_job_visits_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_job_visit_rollup();

-- O dinheiro da visita 1 mora em `jobs`: quando ele muda, o total tem que
-- acompanhar. BEFORE UPDATE para escrever na própria linha sem recursão.
CREATE OR REPLACE FUNCTION public.tg_job_primary_visit_money_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnt   integer := 0;
  v_cli   numeric := 0;
  v_par   numeric := 0;
  v_mat   numeric := 0;
BEGIN
  SELECT count(*), coalesce(sum(client_price), 0), coalesce(sum(partner_cost), 0), coalesce(sum(materials_cost), 0)
    INTO v_cnt, v_cli, v_par, v_mat
  FROM public.job_visits
  WHERE job_id = NEW.id
    AND deleted_at IS NULL
    AND status <> 'cancelled';

  NEW.visits_count         := 1 + v_cnt;
  NEW.total_client_price   := coalesce(NEW.client_price, 0)   + v_cli;
  NEW.total_partner_cost   := coalesce(NEW.partner_cost, 0)   + v_par;
  NEW.total_materials_cost := coalesce(NEW.materials_cost, 0) + v_mat;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_primary_visit_money_rollup ON public.jobs;
CREATE TRIGGER trg_jobs_primary_visit_money_rollup
  BEFORE INSERT OR UPDATE OF client_price, partner_cost, materials_cost ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_primary_visit_money_rollup();

-- -----------------------------------------------------------------------------
-- Backfill: job sem visita fica com total = visita 1, que é o comportamento de
-- hoje. Job com visita recebe a soma.
-- -----------------------------------------------------------------------------
UPDATE public.jobs j
SET
  visits_count = 1 + coalesce(v.cnt, 0),
  total_client_price   = coalesce(j.client_price, 0)   + coalesce(v.client_price, 0),
  total_partner_cost   = coalesce(j.partner_cost, 0)   + coalesce(v.partner_cost, 0),
  total_materials_cost = coalesce(j.materials_cost, 0) + coalesce(v.materials_cost, 0)
FROM (
  SELECT j2.id AS job_id,
         count(vv.id)                          AS cnt,
         coalesce(sum(vv.client_price), 0)     AS client_price,
         coalesce(sum(vv.partner_cost), 0)     AS partner_cost,
         coalesce(sum(vv.materials_cost), 0)   AS materials_cost
  FROM public.jobs j2
  LEFT JOIN public.job_visits vv
    ON vv.job_id = j2.id AND vv.deleted_at IS NULL AND vv.status <> 'cancelled'
  GROUP BY j2.id
) v
WHERE j.id = v.job_id;
