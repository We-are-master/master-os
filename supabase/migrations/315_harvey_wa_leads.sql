-- 315 · Harvey no WhatsApp: primeiro contato com lead do Checkatrade
--
-- O Harvey manda o template de primeiro contato para quem pediu orçamento no
-- Checkatrade (src/lib/harvey-wa/primeiro-contato.ts). Uma linha por PESSOA
-- (chave = 10 últimos dígitos do telefone), gravada só depois do envio aceito:
-- é o que impede mandar "vi seu pedido" duas vezes para o mesmo número.

create table if not exists public.harvey_wa_leads (
  chave        text primary key,
  telefone     text not null,
  cliente_id   uuid references public.clients(id) on delete set null,
  lead_externo text,
  servico      text,
  notificacao  text,
  enviado_em   timestamptz not null default now()
);

alter table public.harvey_wa_leads enable row level security;

drop policy if exists "harvey_wa_leads_staff_read" on public.harvey_wa_leads;
create policy "harvey_wa_leads_staff_read" on public.harvey_wa_leads
  for select to authenticated using (public.is_internal_staff());
