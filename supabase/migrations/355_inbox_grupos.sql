-- 355: grupos do WhatsApp na /inbox (dono, 03/11/2026).
--
-- wa_mensagens.autor        em grupo, o número de quem mandou (só dígitos);
--                           null quando o WhatsApp esconde o número (LID).
-- wa_mensagens.autor_nome   o nome que a pessoa usa no WhatsApp.
-- inbox_conversas.nome      o assunto do grupo, atualizado a cada mensagem.
--
-- O contato de um grupo é o id dele só com dígitos (120363..., 18 dígitos).

begin;

alter table public.wa_mensagens add column if not exists autor text;
alter table public.wa_mensagens add column if not exists autor_nome text;
alter table public.inbox_conversas add column if not exists nome text;

commit;
