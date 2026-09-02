-- A trava do pedido de feedback, numa coluna — porque em `audit_logs` ela
-- nunca funcionou uma única vez.
--
-- O `feedback-pos-job` marcava quem já tinha recebido inserindo uma linha em
-- `audit_logs` com `action = 'feedback_requested'`. Só que a tabela tem um
-- CHECK que aceita oito valores, e esse não é um deles:
--
--   updated · status_changed · created · bulk_update · note · payment ·
--   deleted · phase_advanced
--
-- O insert era rejeitado toda vez. O script não conferia o retorno, então
-- engolia o erro e seguia como se tivesse gravado. Medido em 02/09/2026:
-- ZERO linhas `feedback_requested` no banco inteiro, desde sempre.
--
-- Sem trava, a varredura repescava todo job pago nas últimas 72h e mandava de
-- novo, todo dia. A cliente do JOB-9541 recebeu o mesmo pedido em 01/09 e
-- 02/09, respondeu "Yes" na primeira e teve que ser avisada de que era
-- automação. A Denise do JOB-9528 recebeu os mesmos dois dias. Sem esta
-- migração, os dois receberiam uma terceira vez em 03/09.
--
-- A coluna repete o desenho de `client_approval_requested_at` (mig 283), que
-- existe pelo mesmo motivo e já documenta por que `audit_logs` não serve de
-- trava aqui: nem todo caminho escreve auditoria, e a regra falha calada.
--
-- Colar no SQL editor do Supabase, como a 283.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS feedback_requested_at timestamptz;

COMMENT ON COLUMN public.jobs.feedback_requested_at IS
  'When the post-job feedback WhatsApp went out. Send-once lock for the paid-jobs sweep (mig 284).';

-- Todo job JÁ PAGO nasce carimbado, de propósito.
--
-- Sem isso, a primeira varredura depois da correção trataria o histórico
-- inteiro como "nunca pediu" e dispararia de uma vez — que é exatamente o
-- risco que a regra das 72h existia para conter, e que a 283 evitou do mesmo
-- jeito ao carimbar os jobs que já estavam em final check.
--
-- Cobre também os três que já receberam (JOB-9541, JOB-9528, JOB-9557): eles
-- entram carimbados e não recebem mais.
UPDATE public.jobs
   SET feedback_requested_at = COALESCE(feedback_requested_at, now())
 WHERE payment_status = 'paid'
   AND deleted_at IS NULL;
