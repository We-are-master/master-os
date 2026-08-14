-- Migration 250: jobs.partner_ids nunca sobrevive a jobs.partner_id
--
-- Existem dois campos para a mesma coisa: `partner_id`, o principal, que a
-- tela e os emails usam, e `partner_ids`, o plural, que veio para job de mais
-- de um parceiro. Nada obrigava os dois a concordarem.
--
-- Em 13 ago 2026 a escalada de job não confirmado limpou só o singular. O
-- gatilho da migração 166 disparou na mudança de status, chamou
-- /api/internal/zendesk/sync-status, e de lá `stalePartnerBookedJobPatch` —
-- que aceita `partner_id` OU `partner_ids` como prova de parceiro. Vendo o
-- plural cheio, concluiu "job agendado com parceiro", devolveu `scheduled` e
-- apagou a lista de convidados. Quatro jobs do dia seguinte ficaram órfãos:
-- sem parceiro na tela e sem leilão aberto. JOB-9404, 9406, 9409 e 9428.
--
-- O caminho de código foi corrigido, mas corrigir o caminho não impede o
-- próximo. Aqui a invariante passa a valer para qualquer escrita, inclusive as
-- que ainda não foram escritas: sem `partner_id`, não há `partner_ids`.
--
-- Não há job com mais de um parceiro no plural (0 de 414 em 13 ago 2026), então
-- zerar junto não descarta nada que alguém tenha escolhido.

-- ─── Limpeza de quem já está torto ───────────────────────────────────────────
-- Idempotente. Em produção já estava em zero quando esta migração foi escrita;
-- existe para os ambientes que não passaram pelo reparo à mão.
UPDATE public.jobs
   SET partner_ids = '{}'::uuid[]
 WHERE partner_id IS NULL
   AND partner_ids IS NOT NULL
   AND partner_ids <> '{}'::uuid[];

-- ─── A trava ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_jobs_partner_ids_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- `'{}'` e não NULL: a coluna é NOT NULL DEFAULT '{}' desde a migração 050,
  -- e é `[]` que o app escreve em todo lugar.
  IF NEW.partner_id IS NULL AND NEW.partner_ids IS DISTINCT FROM '{}'::uuid[] THEN
    NEW.partner_ids := '{}'::uuid[];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_partner_ids_invariant ON public.jobs;
CREATE TRIGGER trg_jobs_partner_ids_invariant
  BEFORE INSERT OR UPDATE OF partner_id, partner_ids ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_partner_ids_invariant();

COMMENT ON FUNCTION public.tg_jobs_partner_ids_invariant() IS
  'Zera jobs.partner_ids sempre que partner_id fica nulo. Impede o estado que órfãou JOB-9404/9406/9409/9428 em 13 ago 2026: singular limpo, plural cheio, e o reparo do sync do Zendesk desfazendo a escalada por causa disso.';
