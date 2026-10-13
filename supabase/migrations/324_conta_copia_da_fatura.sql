-- Cópia da fatura por conta (dono, 13/10/2026): a LF Europe pede que o financeiro
-- (Marko) receba toda fatura junto com quem pediu o serviço. Até aqui a fatura ia
-- para um e-mail só.

alter table public.accounts
  add column if not exists invoice_cc_emails text[] not null default '{}';

comment on column public.accounts.invoice_cc_emails is
  'E-mails que recebem cópia de toda fatura, lembrete de cobrança e e-mail de conclusão com fatura desta conta (ex.: o financeiro do cliente).';
