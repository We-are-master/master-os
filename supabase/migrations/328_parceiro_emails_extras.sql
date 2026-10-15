-- E-mails extras do parceiro (dono, 15/10/2026): empresa parceira pede que o e-mail do
-- job vá também para outras pessoas (escritório, sócio). Entram em cópia nos e-mails de
-- job (conversa do Zendesk ou Resend) e no "seus jobs de amanhã".
alter table public.partners
  add column if not exists job_cc_emails text[] not null default '{}';

comment on column public.partners.job_cc_emails is
  'E-mails que recebem cópia dos e-mails de job do parceiro. O e-mail principal continua em partners.email.';

notify pgrst, 'reload schema';
