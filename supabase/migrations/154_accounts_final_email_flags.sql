-- What the account allows in the client completion email; Final review can narrow within these flags.
alter table public.accounts
  add column if not exists email_include_invoice_on_final boolean not null default true,
  add column if not exists email_include_report_on_final boolean not null default true;

comment on column public.accounts.email_include_invoice_on_final is
  'If true, final-review email may include invoice/payment copy; set false e.g. when the account handles self-bill themselves.';

comment on column public.accounts.email_include_report_on_final is
  'If true, final-review email may attach final report PDFs.';
