-- 313 · Modelo de agente (Schedule A): numeração da fatura de comissão com VAT
-- e a trava do e-mail "confirmed with {professional}".
--
-- 1) commission_vat_invoices: a Fixfy emite UMA fatura de VAT da comissão
--    (e das Late-Withdrawal Fees) por payout statement, com número único e
--    sequencial (Invoicing and Payment Collection Agreement 2026-10-06, seção
--    6.2). O número nasce da sequence no primeiro envio e fica: reenviar o
--    mesmo payout reaproveita a mesma fatura (documento fiscal não muda de
--    número). As linhas emitidas ficam em `lines` como foto do que saiu.
--
-- 2) jobs.client_professional_email_sent_at / _partner_id: a confirmação ao
--    cliente com o nome do profissional (04-booking-copy, e-mail C2) sai uma
--    vez por job. O código reivindica a coluna com update atômico em
--    `.is(null)` antes de mandar; sem a coluna o e-mail simplesmente não sai.
--
-- Nada aqui liga o modelo: quem liga é FIXFY_AGENT_MODEL=on no ambiente.
-- Aplicar manualmente. Idempotente.

create sequence if not exists public.commission_vat_invoice_number_seq start 1;

create table if not exists public.commission_vat_invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  bigint not null unique default nextval('public.commission_vat_invoice_number_seq'),
  reference       text generated always as ('FXC-' || lpad(invoice_number::text, 6, '0')) stored,
  self_bill_id    uuid not null unique references public.self_bills(id) on delete restrict,
  partner_id      uuid references public.partners(id) on delete set null,
  issue_date      date not null default ((now() at time zone 'Europe/London')::date),
  total_inc_vat   numeric(12,2) not null,
  vat_amount      numeric(12,2) not null,
  net_amount      numeric(12,2) not null,
  vat_rate        numeric(5,2) not null default 20,
  lines           jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

alter sequence public.commission_vat_invoice_number_seq owned by public.commission_vat_invoices.invoice_number;

create index if not exists commission_vat_invoices_partner_idx
  on public.commission_vat_invoices (partner_id, issue_date desc);

alter table public.commission_vat_invoices enable row level security;

drop policy if exists "commission_vat_invoices_staff_all" on public.commission_vat_invoices;
create policy "commission_vat_invoices_staff_all" on public.commission_vat_invoices
  for all to authenticated
  using (public.is_internal_staff())
  with check (public.is_internal_staff());

grant select on public.commission_vat_invoices to authenticated;

comment on table public.commission_vat_invoices is
  'Fatura de VAT da comissão (Schedule A) e das Late-Withdrawal Fees, uma por payout statement (self_bill). Número sequencial FXC-000001; reenvio reaproveita.';

alter table public.jobs
  add column if not exists client_professional_email_sent_at timestamptz,
  add column if not exists client_professional_email_partner_id uuid;

comment on column public.jobs.client_professional_email_sent_at is
  'Quando saiu ao cliente o e-mail "Booking confirmed with {professional}" (Schedule A). Trava de envio único.';
comment on column public.jobs.client_professional_email_partner_id is
  'Parceiro nomeado no e-mail de confirmação. Se o job trocar de parceiro, o aviso de troca (C3) ainda é manual.';
