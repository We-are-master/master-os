-- =============================================================================
-- Migration 276: cada visita aponta para o self-bill do parceiro DELA
-- =============================================================================
--
-- Self-bill é por parceiro. Um job com dois parceiros (visita 1 com o handyman,
-- visita 2 com o eletricista) precisa de dois documentos, cada um com o valor
-- do seu. `jobs.self_bill_id` é escalar e cobre só a visita 1, que é o job.
--
-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE ISTO É UMA COLUNA E NÃO UMA TABELA DE LINHAS DE PAGAMENTO           │
-- │ `recomputeSelfBillTotals` soma `jobs.partner_cost` das linhas ligadas ao    │
-- │ documento. Como `jobs.partner_cost` é a VISITA 1 e nada mais (ver mig 274), │
-- │ somar as visitas por cima é exato, sem dupla contagem. Uma tabela de linhas │
-- │ criaria uma segunda fonte de verdade para dinheiro que já existe, e exigiria │
-- │ backfillar todo o histórico.                                                │
-- │                                                                             │
-- │ O acoplamento entre as duas migrações é real: se algum dia `partner_cost`   │
-- │ virar total do job, esta soma passa a contar duas vezes, em silêncio, num   │
-- │ documento que o parceiro assina.                                            │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.job_visits
  ADD COLUMN IF NOT EXISTS self_bill_id uuid REFERENCES public.self_bills(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.job_visits.self_bill_id IS
  'Self-bill do parceiro DESTA visita. O do job (jobs.self_bill_id) é do parceiro da visita 1.';

-- Só as vivas interessam ao pagamento; o índice parcial mantém a varredura
-- barata quando o recompute busca as linhas de um documento.
CREATE INDEX IF NOT EXISTS idx_job_visits_self_bill_live
  ON public.job_visits (self_bill_id)
  WHERE self_bill_id IS NOT NULL AND deleted_at IS NULL;
