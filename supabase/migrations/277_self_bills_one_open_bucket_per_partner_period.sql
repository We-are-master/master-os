-- =============================================================================
-- Migration 277: um único documento ABERTO por (parceiro, período de pagamento)
-- =============================================================================
--
-- Self-bill é um documento por parceiro por período. Quem garante isso hoje é
-- código: `ensureWeeklySelfBillForJob` procura o balde aberto e, se não acha,
-- cria. Entre a procura e a criação existe uma fresta — duas escritas ao mesmo
-- tempo passam as duas pela procura e criam as duas.
--
-- Aconteceu de verdade em 23/08/2026, ao adicionar visitas em sequência: o
-- LandLord Certificate terminou com quatro documentos na mesma quinzena. O
-- parceiro receberia PDFs separados, cada um com um pedaço do trabalho.
--
-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ POR QUE O ÍNDICE É PARCIAL                                                 │
-- │ Ele cobre só os estados que ACEITAM TRABALHO NOVO — os mesmos de           │
-- │ `SELF_BILL_REUSABLE_STATUSES` em src/services/self-bills.ts. A regra que   │
-- │ se quer é "no máximo um balde aberto por parceiro e período", não "um      │
-- │ documento na história".                                                    │
-- │                                                                            │
-- │ Cobrir os demais estados quebraria o negócio: fechado o pagamento de uma   │
-- │ quinzena, trabalho novo do mesmo parceiro no mesmo período precisa de um   │
-- │ documento novo ao lado do que já foi pago. E o esquema ANTIGO era um       │
-- │ self-bill POR JOB (SB-2026-W23-JOB-9244 e mais nove do mesmo parceiro na   │
-- │ mesma semana): isso é histórico pago, não pode ser proibido à força.       │
-- │                                                                            │
-- │ `draft` entra no predicado por paridade com o código, embora a constraint  │
-- │ `self_bills_status_check` (mig 265) não aceite esse valor hoje.            │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- Documento interno (workforce) fica de fora por dois caminhos independentes:
-- `partner_id` é nulo (e NULL nunca colide com NULL num índice único) e
-- `bill_origin` é 'internal'. A chave dele é `internal_cost_id`, não parceiro,
-- e vários internos dividem a mesma `week_start` mensal.
--
-- NUNCA acrescentar NULLS NOT DISTINCT aqui: com isso todo documento interno
-- do mesmo mês passaria a colidir e o sync da folha morreria no primeiro dia.
--
-- Sem CONCURRENTLY de propósito: nenhuma migration deste repo usa, o editor SQL
-- do Supabase roda em transação (onde CONCURRENTLY é proibido), e a tabela tem
-- ~124 linhas.
--
-- Depende das migrations 274/275/276 (as colunas de visita): os passos 1 e 2
-- consultam `job_visits.self_bill_id`.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. Baldes abertos que nunca foram usados ────────────────────────────────
-- Documento aberto, £0, sem nenhum job e sem nenhuma visita: é balde que foi
-- criado e ficou para trás. Fica de ruído no Money Out e, quando duplicado,
-- impede o índice. O corte de uma hora evita cancelar um balde recém-criado
-- que ainda está a caminho de receber o vínculo.
UPDATE public.self_bills sb
   SET status = 'payout_cancelled',
       jobs_count = 0,
       job_value = 0,
       materials = 0,
       commission = 0,
       net_payout = 0
 WHERE sb.status IN ('accumulating', 'draft')
   AND sb.partner_id IS NOT NULL
   AND COALESCE(sb.net_payout, 0) <= 0.02
   AND sb.created_at < now() - interval '1 hour'
   AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.self_bill_id = sb.id)
   AND NOT EXISTS (
         SELECT 1
           FROM public.job_visits v
           JOIN public.jobs jv ON jv.id = v.job_id
          WHERE v.self_bill_id = sb.id
            AND v.deleted_at IS NULL
            AND v.status <> 'cancelled'
            AND jv.deleted_at IS NULL
            AND jv.status NOT IN ('cancelled', 'deleted')
       );

-- ─── 2. Duplicatas que sobraram ──────────────────────────────────────────────
-- Se ainda houver mais de um balde aberto para o mesmo parceiro e período,
-- vence quem TEM dinheiro; entre iguais, o mais antigo. É a mesma regra da
-- reconciliação em `ensureWeeklySelfBillForJob`, para os dois lados não
-- discordarem sobre quem é o balde.
--
-- Perdedor só é cancelado se estiver vazio. Perdedor COM dinheiro fica de pé de
-- propósito: aí o índice abaixo falha, e é o que tem que acontecer — dinheiro
-- duplicado em documento que o parceiro assina é decisão de gente, não de
-- migration.
WITH ranked AS (
  SELECT sb.id,
         row_number() OVER (
           PARTITION BY sb.partner_id, sb.week_start
           ORDER BY (COALESCE(sb.net_payout, 0) > 0.02) DESC, sb.created_at ASC, sb.id ASC
         ) AS pos
    FROM public.self_bills sb
   WHERE sb.status IN ('accumulating', 'draft')
     AND sb.partner_id IS NOT NULL
)
UPDATE public.self_bills sb
   SET status = 'payout_cancelled',
       jobs_count = 0,
       job_value = 0,
       materials = 0,
       commission = 0,
       net_payout = 0
  FROM ranked r
 WHERE r.id = sb.id
   AND r.pos > 1
   AND COALESCE(sb.net_payout, 0) <= 0.02
   AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.self_bill_id = sb.id)
   AND NOT EXISTS (
         SELECT 1
           FROM public.job_visits v
           JOIN public.jobs jv ON jv.id = v.job_id
          WHERE v.self_bill_id = sb.id
            AND v.deleted_at IS NULL
            AND v.status <> 'cancelled'
            AND jv.deleted_at IS NULL
            AND jv.status NOT IN ('cancelled', 'deleted')
       );

-- ─── 3. A garantia ───────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_self_bills_partner_period_open
  ON public.self_bills (partner_id, week_start)
  WHERE partner_id IS NOT NULL
    AND bill_origin = 'partner'
    AND status IN ('accumulating', 'draft');

COMMENT ON INDEX public.uq_self_bills_partner_period_open IS
  'No máximo um self-bill ABERTO por (parceiro, período). Estados fechados e o esquema antigo por job ficam de fora; documento interno tem partner_id nulo. Colisão vira 23505, tratada em ensureWeeklySelfBillForJob.';
