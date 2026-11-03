-- 355: grupos do WhatsApp na /inbox (dono, 03/11/2026).
--
-- wa_mensagens.autor        em grupo, o número de quem mandou (só dígitos);
--                           null quando o WhatsApp esconde o número (LID).
-- wa_mensagens.autor_nome   o nome que a pessoa usa no WhatsApp.
-- inbox_conversas.nome      o assunto do grupo, atualizado a cada mensagem.
-- partners.zendesk_ticket_id  o ticket de ligações de cada parceiro: o Call da
--                           /inbox abre sempre esse (nasce no primeiro Call,
--                           com nota interna, sem e-mail ao parceiro).
--
-- inbox_conversas.atribuida_a  quem do Workforce assumiu a conversa (profiles.id);
--                           `atribuida_em` quando. Null = ninguém.
-- inbox_conversas.vinculo_tipo / vinculo_id  número que o cadastro não reconhece,
--                           ligado à mão a um parceiro, cliente, conta ou lead
--                           ('parceiro' | 'cliente' | 'conta' | 'lead' + o id).
--                           Não mexe no telefone do cadastro.
--
-- O contato de um grupo é o id dele só com dígitos (120363..., 18 dígitos).

begin;

alter table public.wa_mensagens add column if not exists autor text;
alter table public.wa_mensagens add column if not exists autor_nome text;
alter table public.inbox_conversas add column if not exists nome text;
alter table public.partners add column if not exists zendesk_ticket_id bigint;
alter table public.inbox_conversas add column if not exists atribuida_a uuid;
alter table public.inbox_conversas add column if not exists atribuida_em timestamptz;
alter table public.inbox_conversas add column if not exists vinculo_tipo text;
alter table public.inbox_conversas add column if not exists vinculo_id text;

commit;
