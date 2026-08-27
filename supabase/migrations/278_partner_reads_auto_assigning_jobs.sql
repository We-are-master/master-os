-- Vitrine do trade portal (Fase 2 do auto-flow): parceiro ATIVO autenticado
-- pode ler jobs em auto_assigning sem parceiro. O available-jobs.ts do portal
-- citava uma "migração 081" que nunca existiu neste repo (081 é
-- self_bills_status_check) — esta é a policy canônica.
--
-- ESTADO REAL (verificado em 24/08/2026): a tabela jobs está SEM RLS
-- habilitada em produção — nenhuma migração habilita e não existe policy
-- nenhuma. Esta policy é INERTE até alguém rodar
--   ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
-- o que é um projeto de hardening separado (exige policies para staff,
-- portal do cliente e portal do parceiro de uma vez). Fica escrita para esse
-- dia, e documenta a intenção.
--
-- O filtro por type of work fica na QUERY do portal (e no aceite, validado no
-- servidor em processAutoAssignJobAccept); a policy só garante que parceiro
-- não-ativo, ou não-parceiro, não enxerga oferta nenhuma.

DROP POLICY IF EXISTS "jobs_partner_reads_auto_assigning" ON public.jobs;
CREATE POLICY "jobs_partner_reads_auto_assigning"
  ON public.jobs FOR SELECT TO authenticated
  USING (
    status = 'auto_assigning'
    AND partner_id IS NULL
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.partners p
      WHERE p.auth_user_id = auth.uid()
        AND p.status = 'active'
    )
  );
