-- 302 · Leads do site: o quarto toque (WhatsApp), o ticket do Zendesk e a resposta
--
-- A sequência de retomada ganha um passo 4: WhatsApp às 15h do dia em que o
-- e-mail 3 saiu, com o mesmo código de 10% (template fixfy_booking_recovery_v1).
-- Cada lead passa a ter UM ticket no Zendesk, aberto quando o e-mail 1 sai,
-- onde as respostas caem e cada toque vira nota interna. Qualquer resposta do
-- cliente carimba `replied_at` e para a sequência.
--
-- Roda DEPOIS da 294/295. Sem ela o OS novo não grava lead do site
-- (registrarPasso escreve whatsapp_due_at), então rodar ANTES do deploy.

alter table public.site_leads add column if not exists whatsapp_due_at timestamptz;
alter table public.site_leads add column if not exists whatsapp_sent_at timestamptz;
alter table public.site_leads add column if not exists zendesk_ticket_id bigint;
alter table public.site_leads add column if not exists replied_at timestamptz;

-- Mesmo molde do site_leads_due_idx (294): só o que está agendado.
create index if not exists site_leads_whatsapp_due_idx
  on public.site_leads (sequence_state, whatsapp_due_at)
  where sequence_state = 'scheduled';

-- A varredura de respostas acha o lead pelo ticket.
create index if not exists site_leads_zendesk_ticket_idx
  on public.site_leads (zendesk_ticket_id)
  where zendesk_ticket_id is not null;

comment on column public.site_leads.whatsapp_due_at is
  'Passo 4: 15h (Londres) do dia em que o e-mail 3 saiu. Só existe com telefone e WhatsApp configurado.';
comment on column public.site_leads.whatsapp_sent_at is
  'Reserva e carimbo do WhatsApp de retomada (mesmo padrão dos emailN_sent_at).';
comment on column public.site_leads.zendesk_ticket_id is
  'O ticket do lead no Zendesk (tags site-lead, reserva-abandonada), aberto no e-mail 1.';
comment on column public.site_leads.replied_at is
  'Quando o cliente respondeu (e-mail no ticket, ticket novo ou WhatsApp). Com isto a sequência para.';
