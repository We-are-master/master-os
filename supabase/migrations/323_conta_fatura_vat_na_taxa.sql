-- Fatura B2B com VAT só sobre a taxa da Fixfy e cobrança em nome da razão social.
--
-- Algumas contas (LF Europe Ltd, 13/10/2026) pedem a fatura como já saía no Xero:
-- o serviço do parceiro repassado sem VAT e a taxa da Fixfy com VAT de 20%, em
-- nome da empresa e não do contato. Desligado por padrão: nenhuma outra conta muda.

alter table public.accounts
  add column if not exists billing_legal_name text,
  add column if not exists invoice_fee_vat boolean not null default false;

comment on column public.accounts.billing_legal_name is
  'Razão social que vai no "Bill to" da fatura (ex.: LF Europe Ltd). Vazio = nome da conta ou do cliente, como sempre.';
comment on column public.accounts.invoice_fee_vat is
  'true = a fatura mostra o serviço do parceiro sem VAT e a taxa da Fixfy com VAT de 20% (o total não muda).';

-- Lembrete de cobrança só para fatura que já foi enviada ao cliente (dono, 13/10/2026).
-- Até aqui o envio não deixava marca (o registro no histórico nunca era gravado em
-- produção), e fatura nunca enviada recebia "overdue": aconteceu com a RCP-2026-904.
alter table public.invoices
  add column if not exists sent_at timestamptz;

comment on column public.invoices.sent_at is
  'Última vez que a fatura foi enviada ao cliente pelo OS. Vazio = nunca enviada: não recebe lembrete de cobrança.';
