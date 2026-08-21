-- Migration 265: um self-bill por parceiro por período de pagamento
--
-- O self-bill nascia por SEMANA ISO (`partner_id + week_start`) enquanto o
-- pagamento é quinzenal. Resultado medido em 20/08/2026: Fernando de Carvalho
-- Correa com QUATRO documentos vencendo todos em 21/08 (£910 + £430 + £300 +
-- £375). Um parceiro, um pagamento, quatro PDFs.
--
-- O código já foi corrigido (`ensureWeeklySelfBillForJob` agora usa
-- `workPeriodForJobStartYmd`). Isto consolida os abertos.
--
-- REGRAS, e cada uma existe por um caso real:
--
--   * Só `bill_origin = 'partner'`. O workforce (`internal`) é mensal e tem
--     trilha própria; juntar os dois faria o Guilherme virar quinzena.
--   * Só status ABERTO. `paid` e `rejected` são história e não se reescreve.
--   * Agrupa por `partner_id + due_date`, que já é a sexta do período.
--   * Grupo sem `due_date` não é tocado: sem a data não há período, e adivinhar
--     é como se junta pagamento de quinzenas diferentes.
--   * Os jobs são REPONTADOS antes de arquivar. `jobs.self_bill_id` é o único
--     vínculo, e arquivar sem repontar deixaria o job apontando para um
--     documento morto.

-- ─── 0. A constraint de status está atrás do código ─────────────────────────
-- A constraint viva é a da migração 081 e não conhece `payout_archived`, que o
-- código usa desde a migração 100 — **que nunca foi aplicada** (as colunas dela,
-- `original_net_payout`, `payout_void_reason` e `partner_status_label`, também
-- não existem no banco). Sem alinhar isto, o passo 5 abaixo falha com
-- `self_bills_status_check` e a transação inteira volta atrás.
--
-- Aqui entra SÓ a constraint, não as três colunas da 100: coluna que ninguém lê
-- é exatamente o entulho que este trabalho está removendo. A lista é a do tipo
-- `SelfBillStatus` em `src/types/database.ts`, para banco e código pararem de
-- discordar. A Fase 3 vai ENCOLHER esta lista; alinhar agora é o passo anterior
-- a poder encolher com segurança.
--
-- `draft` fica DE FORA de propósito: nenhuma linha usa, e o código passou a
-- inserir `accumulating` direto. Até 20/08/2026 ele inseria `draft`, tomava
-- 23514 e reinseria: um insert perdido em toda criação de self-bill.
ALTER TABLE public.self_bills DROP CONSTRAINT IF EXISTS self_bills_status_check;
ALTER TABLE public.self_bills ADD CONSTRAINT self_bills_status_check CHECK (
  status IN (
    'accumulating',
    'pending_review',
    'needs_attention',
    'awaiting_payment',
    'ready_to_pay',
    'paid',
    'audit_required',
    'rejected',
    'payout_archived',
    'payout_cancelled',
    'payout_lost'
  )
);

-- ─── 1. Reparo do órfão ──────────────────────────────────────────────────────
-- SB-2026-W33-JOB-9404 (TM Handyman, £85) está com `partner_id` nulo e por isso
-- não agrupa com o resto do parceiro. Só liga quando o nome casa com EXATAMENTE
-- um parceiro: nome ambíguo fica órfão de propósito.
UPDATE public.self_bills sb
   SET partner_id = p.id
  FROM public.partners p
 WHERE sb.partner_id IS NULL
   AND sb.bill_origin = 'partner'
   AND lower(trim(sb.partner_name)) = lower(trim(p.company_name))
   AND (
     SELECT count(*) FROM public.partners p2
      WHERE lower(trim(p2.company_name)) = lower(trim(sb.partner_name))
   ) = 1;

-- ─── 2. Escolhe o sobrevivente de cada grupo ─────────────────────────────────
-- O mais antigo do período (menor `week_start`), com a referência como
-- desempate para o resultado ser o mesmo em qualquer execução.
CREATE TEMP TABLE _grupos ON COMMIT DROP AS
SELECT
  sb.partner_id,
  sb.due_date,
  (ARRAY_AGG(sb.id ORDER BY sb.week_start, sb.reference))[1] AS keeper_id,
  ARRAY_AGG(sb.id ORDER BY sb.week_start, sb.reference)      AS todos,
  count(*)                                                    AS quantos
FROM public.self_bills sb
WHERE sb.bill_origin = 'partner'
  AND sb.due_date IS NOT NULL
  AND sb.status IN ('accumulating', 'ready_to_pay', 'awaiting_payment', 'pending_review')
GROUP BY sb.partner_id, sb.due_date
HAVING count(*) > 1;

-- ─── 3. Repontar os jobs para o sobrevivente ────────────────────────────────
UPDATE public.jobs j
   SET self_bill_id = g.keeper_id
  FROM _grupos g
 WHERE j.self_bill_id = ANY(g.todos)
   AND j.self_bill_id <> g.keeper_id;

-- ─── 4. Somar o dinheiro no sobrevivente ────────────────────────────────────
UPDATE public.self_bills k
   SET net_payout = s.net_payout,
       jobs_count = s.jobs_count,
       job_value  = s.job_value,
       materials  = s.materials,
       commission = s.commission,
       -- O período: sexta menos 5 dias é o domingo do cut-off, menos 13 é o
       -- início. Bate com `workPeriodBoundsForPayoutFriday` no código.
       week_end   = (k.due_date - INTERVAL '5 days')::date,
       week_start = (k.due_date - INTERVAL '18 days')::date,
       week_label = to_char((k.due_date - INTERVAL '18 days')::date, 'YYYY-MM-DD')
                    || ' a ' || to_char((k.due_date - INTERVAL '5 days')::date, 'YYYY-MM-DD')
  FROM (
    SELECT g.keeper_id,
           sum(COALESCE(sb.net_payout, 0)) AS net_payout,
           sum(COALESCE(sb.jobs_count, 0)) AS jobs_count,
           sum(COALESCE(sb.job_value,  0)) AS job_value,
           sum(COALESCE(sb.materials,  0)) AS materials,
           sum(COALESCE(sb.commission, 0)) AS commission
      FROM _grupos g
      JOIN public.self_bills sb ON sb.id = ANY(g.todos)
     GROUP BY g.keeper_id
  ) s
 WHERE k.id = s.keeper_id;

-- ─── 5. Arquivar os absorvidos ──────────────────────────────────────────────
UPDATE public.self_bills sb
   SET status     = 'payout_archived',
       net_payout = 0,
       jobs_count = 0,
       job_value  = 0,
       materials  = 0,
       commission = 0
  FROM _grupos g
 WHERE sb.id = ANY(g.todos)
   AND sb.id <> g.keeper_id;

-- Confere. Esperado: nenhuma linha, ou seja um self-bill aberto por parceiro
-- por data de pagamento.
--   SELECT partner_name, due_date, count(*)
--     FROM public.self_bills
--    WHERE bill_origin = 'partner' AND due_date IS NOT NULL
--      AND status IN ('accumulating','ready_to_pay','awaiting_payment','pending_review')
--    GROUP BY partner_name, due_date HAVING count(*) > 1;
