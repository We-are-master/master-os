-- Migration 262: lembrete de véspera e aviso de remarcação para o cliente
--
-- Mesma ideia da 261: o estado do que já foi enviado mora no JOB. Uma coluna
-- por tipo de mensagem, porque cada uma tem a sua própria pergunta de "já
-- mandei?" e juntá-las numa só faria o lembrete de véspera calar o aviso de
-- remarcação (ou o contrário) no dia em que os dois caírem no mesmo job.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_reminder_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS client_reschedule_notified_at  timestamptz;

COMMENT ON COLUMN public.jobs.client_reminder_sent_at IS
  'Quando o lembrete de véspera (24h antes) foi entregue ao cliente no WhatsApp. Uma vez por job: remarcar o job limpa esta coluna para o lembrete valer para a data nova.';
COMMENT ON COLUMN public.jobs.client_reschedule_notified_at IS
  'Quando o aviso de remarcação foi mandado por email ao cliente. Serve para não repetir o mesmo aviso quando alguém salva a tela duas vezes.';
