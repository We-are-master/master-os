-- Day rate e Half day como rótulo do preço fixo (dono, 24/08/2026).
-- O dinheiro continua sendo o fixed de sempre (client_price/partner_cost,
-- margem, invoice, self-bill intactos); rate_basis diz o que foi COMBINADO,
-- e é o que o parceiro lê no email e no portal: "£180.00 · Day rate".
-- Null = comportamento de sempre (hourly ou fixed puro).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS rate_basis text NULL;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_rate_basis_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_rate_basis_check
    CHECK (rate_basis IS NULL OR rate_basis IN ('fixed', 'daily', 'half_day'));

COMMENT ON COLUMN public.jobs.rate_basis IS
  'What was AGREED, not how it bills: daily/half_day are fixed-price jobs underneath; the label shows in partner emails and the trade portal. Null = plain hourly/fixed.';
