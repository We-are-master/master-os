-- Quando o job ENTROU em final check, e quando pedimos aprovação ao cliente.
--
-- Até aqui a tela mostrava "In final checks 18h ago" lendo `updated_at`, que é
-- a última vez que ALGUÉM MEXEU no job. Toda edição zerava o contador: corrigir
-- o custo do parceiro fazia o job "entrar em final checks" de novo. O rótulo
-- mentia, e uma regra de tempo pendurada nele nunca dispararia num job que o
-- time fica ajustando.
--
-- A alternativa sem coluna era ler `audit_logs`. Medido em 01/09/2026: dos 7
-- jobs em final check, só 2 tinham registro. Cinco entraram por caminhos que
-- não escrevem auditoria, e a regra teria falhado calada neles.
--
-- O carimbo é de TRIGGER e não de código de aplicação, pelo mesmo motivo: o
-- status muda pela tela, por agente e por script, e pendurar em cada caminho é
-- garantir que um deles esqueça.
--
-- Colar no SQL editor do Supabase, como a 282.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS final_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_approval_requested_at timestamptz;

COMMENT ON COLUMN public.jobs.final_check_at IS
  'When the job last entered final_check. Set by trigger on any status change; survives edits (unlike updated_at).';
COMMENT ON COLUMN public.jobs.client_approval_requested_at IS
  'When the "please confirm the work" WhatsApp went out. Send-once lock for the final-check sweep.';

-- Carimba a entrada em final check, venha a mudança de onde vier.
-- Sair de final check LIMPA o carimbo: se o job voltar para execução, ele não
-- carrega uma entrada velha, e o dia em que voltar para final check começa a
-- contagem do zero.
CREATE OR REPLACE FUNCTION public.stamp_job_final_check_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'final_check' THEN
      NEW.final_check_at := now();
    ELSE
      NEW.final_check_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_final_check_at ON public.jobs;
CREATE TRIGGER trg_jobs_final_check_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_job_final_check_at();

-- Os que JÁ estão em final check hoje recebem o carimbo com a data de agora,
-- de propósito: sem isso a primeira varredura os trataria como recém-chegados
-- e dispararia sete pedidos de aprovação de uma vez, para jobs que estão lá há
-- dias. Ficam com `client_approval_requested_at` preenchido, ou seja, fora da
-- primeira rodada. Quem entrar depois da migração segue o fluxo normal.
UPDATE public.jobs
   SET final_check_at = COALESCE(final_check_at, now()),
       client_approval_requested_at = COALESCE(client_approval_requested_at, now())
 WHERE status = 'final_check'
   AND deleted_at IS NULL;
