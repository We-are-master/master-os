-- Colunas de self_bills que o código usa e produção não tem (levantamento de 11/10/2026).
--
-- `paid_at`: o histórico de pagamentos (/api/finance/payment-runs) seleciona a coluna; sem
-- ela a consulta falha calada e todo payment run aparece sem self-bills dentro.
-- As outras três são da migration 100, que nunca rodou inteira em produção: o motivo do
-- cancelamento e o valor original de um documento zerado nunca eram gravados.
ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_net_payout numeric(14, 2),
  ADD COLUMN IF NOT EXISTS payout_void_reason text,
  ADD COLUMN IF NOT EXISTS partner_status_label text;

-- Documento já pago ganha a data que existe hoje (Wise), para o histórico não nascer vazio.
UPDATE public.self_bills
   SET paid_at = wise_paid_at
 WHERE paid_at IS NULL
   AND wise_paid_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
