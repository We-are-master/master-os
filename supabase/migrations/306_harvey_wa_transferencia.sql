-- 306 · Harvey no WhatsApp: sinal de 50% por transferência bancária
--
-- Desde 29/09/2026 toda reserva do Harvey é 50% adiantado, no link do cartão
-- ou por transferência. Na transferência os jobs nascem no OS aguardando o
-- depósito (sem oferta a parceiro). A varredura do Harvey (scripts/harvey/poll.ts)
-- lê estas colunas: lembra uma vez, libera a vaga sem depósito e, quando a
-- equipe registra o depósito em job_payments, confirma no WhatsApp.

alter table public.harvey_wa_conversas
  add column if not exists checkout_method text check (checkout_method in ('card', 'bank')),
  add column if not exists checkout_at timestamptz,
  add column if not exists checkout_sinal numeric(10, 2),
  add column if not exists job_ids uuid[] not null default '{}',
  add column if not exists lembrado_em timestamptz,
  add column if not exists liberado_em timestamptz,
  add column if not exists sinal_recebido_em timestamptz;

create index if not exists harvey_wa_conversas_transferencia_idx
  on public.harvey_wa_conversas (checkout_at)
  where checkout_method = 'bank' and sinal_recebido_em is null and liberado_em is null;

comment on column public.harvey_wa_conversas.checkout_method is 'card = link do Stripe; bank = transferência aguardando o depósito';
comment on column public.harvey_wa_conversas.job_ids is 'Jobs criados no OS pela reserva por transferência';
