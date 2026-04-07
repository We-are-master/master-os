-- Track partner "Add extra payout" amounts for Cash Out UI (base labour vs extra line).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS partner_extras_amount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.jobs.partner_extras_amount IS
  'Cumulative GBP added via Add extra payout (partner labour). Display = partner cap − this as base; extras shown like client Extra charges.';
