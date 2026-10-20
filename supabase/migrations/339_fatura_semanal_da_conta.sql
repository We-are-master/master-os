-- Migration 339: fatura semanal automática por conta (opcional, desligada em todas).
--
-- Conta com weekly_invoice_auto = true e termos consolidados ("Every Friday"):
--   - o final check aprova o job e manda só o relatório, sem fatura própria;
--   - toda segunda às 8h UTC o cron /api/cron/fatura-semanal junta os jobs concluídos da
--     semana anterior numa fatura só (invoice_kind 'weekly_batch'), com o relatório de cada
--     job, e manda com o Pay now; vence na sexta e os lembretes de vencida seguem sozinhos.
-- Sem a marca, conta de termo semanal continua como antes (a equipe fecha o lote à mão).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS weekly_invoice_auto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.weekly_invoice_auto IS
  'Fatura semanal automática: o OS fecha e envia toda segunda a fatura dos jobs da semana anterior (fatura-semanal.ts).';

-- Nenhuma conta liga agora (dono, 20/10/2026: Li & Fung, Checkatrade, Kvadrat, Stylesmiths e as
-- outras recebem fatura por job; Housekeep, Express e Fantastic pagam no montante pela plataforma).
