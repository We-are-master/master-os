-- Migration 287: a quote que NASCE em bidding também move o ticket.
--
-- O que estava acontecendo, medido em 15/09/2026:
--
--   QT-2026-1144 (#50486), QT-2026-1145 (#50519), QT-2026-1146 (#50522)
--   nasceram em `bidding` e os três tickets continuavam em 🆕 New, com o
--   reply status vazio, parados no Action Required.
--
--   O #50448 MOVEU para 🟢 Quote Ready em 13/09 às 16:19 (auditoria do
--   Zendesk, via=api). Então pg_net, os segredos do vault, o endpoint e o
--   mapeamento funcionam. O que não dispara é o nascimento.
--
-- A causa é a definição do gatilho: a migração 166 o criou como
-- `AFTER UPDATE OF status`, e uma quote que já nasce no status certo nunca
-- muda de status, então nunca dispara. A migração 167 corrigiu isso no
-- repositório, mas o banco de produção continua com a forma da 166 — o sinal
-- é justamente esses três tickets.
--
-- Esta migração reafirma a forma correta. É idempotente de propósito: rodar
-- de novo num banco que já está certo não muda nada, e num que ficou para
-- trás conserta. As FUNÇÕES não são tocadas aqui; elas já tratam TG_OP =
-- 'INSERT' desde a 167.
--
-- Nota sobre sintaxe: a lista `OF status` restringe só o UPDATE. O INSERT
-- dispara em qualquer inserção, e é o corpo da função que decide (linha
-- Zendesk, com external_ref, fora dos status ignorados).

DROP TRIGGER IF EXISTS trg_jobs_zendesk_sync   ON public.jobs;
DROP TRIGGER IF EXISTS trg_quotes_zendesk_sync ON public.quotes;

CREATE TRIGGER trg_jobs_zendesk_sync
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_jobs_zendesk_sync();

CREATE TRIGGER trg_quotes_zendesk_sync
  AFTER INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_quotes_zendesk_sync();

-- Como conferir depois de aplicar:
--   SELECT tgname, pg_get_triggerdef(oid)
--     FROM pg_trigger
--    WHERE tgname IN ('trg_quotes_zendesk_sync', 'trg_jobs_zendesk_sync');
-- Os dois têm de dizer "AFTER INSERT OR UPDATE OF status".
