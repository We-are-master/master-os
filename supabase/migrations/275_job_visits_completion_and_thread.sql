-- =============================================================================
-- Migration 275: fechamento da visita e thread própria do parceiro da visita
-- =============================================================================
--
-- `completed_at`
--   A visita fecha por botão manual do escritório (decisão do dono: não é o
--   relatório nem a aprovação que fecham). O carimbo importa por dois motivos:
--   é ele que libera a próxima visita, e é a âncora do período de payout quando
--   a visita escorrega da data agendada — pagar pelo `scheduled_date` de uma
--   visita feita três semanas depois joga o valor na quinzena errada.
--
-- `zendesk_side_conversation_id`
--   Email de parceiro sai por Side Conversation do Zendesk, e a thread canônica
--   do job (`jobs.zendesk_side_conversation_id`) é uma coluna só, do parceiro
--   primário. Parceiro da visita 2 precisa da própria thread, senão as respostas
--   dele caem na conversa do parceiro da visita 1.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.job_visits
  ADD COLUMN IF NOT EXISTS completed_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS zendesk_side_conversation_id text;

COMMENT ON COLUMN public.job_visits.completed_at IS
  'Quando o escritório marcou a visita como concluída. Libera a próxima visita e ancora o período do payout.';
COMMENT ON COLUMN public.job_visits.zendesk_side_conversation_id IS
  'Thread do parceiro DESTA visita. A do job (jobs.zendesk_side_conversation_id) é do parceiro primário.';

-- Visitas já marcadas como completed antes desta migração ganham um carimbo
-- plausível, senão o payout futuro não teria âncora nenhuma para elas.
UPDATE public.job_visits
SET completed_at = coalesce(updated_at, created_at)
WHERE status = 'completed'
  AND completed_at IS NULL;
