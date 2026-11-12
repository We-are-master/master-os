-- VAT number do cliente na fatura da conta (Kvadrat, 10/11/2026).
-- O contábil da Kvadrat pediu a fatura em nome da Kvadrat Ltd com o VAT number
-- deles. Sai no "Bill to" junto da razão social, só nas contas com o formato
-- de fatura por conta (invoice_fee_vat). Vazio = nada muda.

alter table public.accounts
  add column if not exists billing_vat_number text;

comment on column public.accounts.billing_vat_number is
  'VAT number do cliente impresso no "Bill to" da fatura (ex.: GB447101770). Vazio = não aparece.';
