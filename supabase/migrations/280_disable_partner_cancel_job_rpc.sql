-- Parceiro NÃO cancela job pelo app/portal (dono, 24/08/2026).
-- Cancelamento é decisão do escritório: o parceiro escreve para o suporte, o
-- OS cancela ou troca, e quem sai recebe o email de "Job cancelled" sem
-- motivo. Esta migração desarma a RPC para o app que chama o banco direto;
-- a rota /api/app/partner-cancel-job já devolve a mesma instrução.
--
-- A versão original da função está na migração 178, para o dia em que isso
-- for reaberto com regras.

CREATE OR REPLACE FUNCTION public.partner_cancel_job(p_job_id uuid, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Cancellations are handled by the Fixfy office. Email support@getfixfy.com and we will sort it out and reassign the job.';
END;
$$;

COMMENT ON FUNCTION public.partner_cancel_job(uuid, text) IS
  'DISABLED 24/08/2026 — partner cancellations go through the office (email support). Original implementation: migration 178.';
