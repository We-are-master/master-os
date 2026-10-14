-- Job avulso parcelado (dono, 15/10/2026): o cliente paga em parcelas numa fatura só,
-- e o parceiro recebe na MESMA proporção e nas MESMAS datas, num self-bill só dele
-- (não no balde da quinzena). Cada parcela do parceiro é liberada na data, mesmo
-- que o cliente ainda não tenha pago a dele.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_paid_in_instalments boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jobs.partner_paid_in_instalments IS
  'Job parcelado: o self-bill do parceiro é próprio do job (self_bills.dedicated_job_id) com parcelas espelhando as do cliente.';

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS dedicated_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.self_bills.dedicated_job_id IS
  'Preenchido só no self-bill próprio de um job parcelado. NULL = balde normal da quinzena.';

-- O balde da quinzena continua único por parceiro e período, mas o documento
-- próprio do job parcelado fica fora dessa conta.
DROP INDEX IF EXISTS public.uq_self_bills_partner_period_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_self_bills_partner_period_open
  ON public.self_bills (partner_id, week_start)
  WHERE partner_id IS NOT NULL
    AND bill_origin = 'partner'
    AND status IN ('accumulating', 'draft')
    AND dedicated_job_id IS NULL;

-- Um documento aberto por job parcelado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_self_bills_dedicated_job_open
  ON public.self_bills (dedicated_job_id)
  WHERE dedicated_job_id IS NOT NULL
    AND status NOT IN ('paid', 'rejected', 'payout_archived', 'payout_cancelled', 'payout_lost');

NOTIFY pgrst, 'reload schema';

-- Cobrança automática por parcela: o cron marca quando pediu, para pedir uma vez só.
ALTER TABLE public.invoice_payment_installments
  ADD COLUMN IF NOT EXISTS requested_at timestamptz;

NOTIFY pgrst, 'reload schema';
