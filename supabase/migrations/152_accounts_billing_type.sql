-- Who customer-facing quotes/invoices name as bill-to when the client is linked to a corporate account.
alter table public.accounts
  add column if not exists billing_type text not null default 'end_client'
  constraint accounts_billing_type_check check (billing_type in ('end_client', 'account'));

comment on column public.accounts.billing_type is
  'end_client: bill the contact client; account: bill the linked corporate account (B2B2C).';
