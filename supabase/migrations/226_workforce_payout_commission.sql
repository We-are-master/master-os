-- Workforce payout method, commission config (% on revenue/gross profit), self-bill breakdown, onboarding + e-sign.

ALTER TABLE public.payroll_internal_costs
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('bank_transfer', 'wise')),
  ADD COLUMN IF NOT EXISTS payout_bank_sort_code text,
  ADD COLUMN IF NOT EXISTS payout_bank_account_number text,
  ADD COLUMN IF NOT EXISTS payout_bank_account_holder text,
  ADD COLUMN IF NOT EXISTS payout_wise_recipient_id text,
  ADD COLUMN IF NOT EXISTS commission_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_rate_percent numeric(5,2)
    CHECK (commission_rate_percent IS NULL OR (commission_rate_percent >= 0 AND commission_rate_percent <= 100)),
  ADD COLUMN IF NOT EXISTS commission_basis text
    CHECK (commission_basis IS NULL OR commission_basis IN ('revenue', 'gross_profit'));

ALTER TABLE public.self_bills
  ADD COLUMN IF NOT EXISTS payout_breakdown jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_self_bills_internal_cost_period
  ON public.self_bills (internal_cost_id, week_start)
  WHERE bill_origin = 'internal' AND internal_cost_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workforce_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_internal_cost_id uuid NOT NULL REFERENCES public.payroll_internal_costs(id) ON DELETE CASCADE,
  slug text UNIQUE,
  custom_message text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name text,
  sent_to_email text,
  expires_at timestamptz NOT NULL,
  first_used_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_onboarding_cost
  ON public.workforce_onboarding_requests (payroll_internal_cost_id, created_at DESC);

ALTER TABLE public.workforce_onboarding_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read workforce_onboarding_requests" ON public.workforce_onboarding_requests;
CREATE POLICY "Authenticated read workforce_onboarding_requests"
  ON public.workforce_onboarding_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert workforce_onboarding_requests" ON public.workforce_onboarding_requests;
CREATE POLICY "Authenticated insert workforce_onboarding_requests"
  ON public.workforce_onboarding_requests FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update workforce_onboarding_requests" ON public.workforce_onboarding_requests;
CREATE POLICY "Authenticated update workforce_onboarding_requests"
  ON public.workforce_onboarding_requests FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER update_workforce_onboarding_requests_updated_at
  BEFORE UPDATE ON public.workforce_onboarding_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.contract_versions DROP CONSTRAINT IF EXISTS contract_versions_contract_type_check;
ALTER TABLE public.contract_versions
  ADD CONSTRAINT contract_versions_contract_type_check
  CHECK (contract_type IN (
    'terms_of_use',
    'self_bill_agreement',
    'workforce_service_agreement',
    'workforce_employment_contract'
  ));

CREATE TABLE IF NOT EXISTS public.workforce_contract_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_internal_cost_id uuid NOT NULL REFERENCES public.payroll_internal_costs(id) ON DELETE CASCADE,
  contract_version_id uuid NOT NULL REFERENCES public.contract_versions(id),
  contract_type text NOT NULL,
  signer_full_name text NOT NULL,
  signer_email text NOT NULL,
  signature_image_url text NOT NULL,
  signature_pdf_url text,
  signer_ip text,
  device_info text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_internal_cost_id, contract_version_id)
);

CREATE INDEX IF NOT EXISTS idx_workforce_signatures_cost
  ON public.workforce_contract_signatures (payroll_internal_cost_id);

ALTER TABLE public.workforce_contract_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read workforce_contract_signatures" ON public.workforce_contract_signatures;
CREATE POLICY "Authenticated read workforce_contract_signatures"
  ON public.workforce_contract_signatures FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert workforce_contract_signatures" ON public.workforce_contract_signatures;
CREATE POLICY "Authenticated insert workforce_contract_signatures"
  ON public.workforce_contract_signatures FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.contract_versions (contract_type, version, title, body_html, is_active)
SELECT
  'workforce_service_agreement',
  '1.0',
  'Contractor Service Agreement',
  '<h1>Contractor Service Agreement</h1><p>By signing you accept the terms of your engagement. Fixed pay and commission (if any) are set in your workforce record.</p>',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_versions
  WHERE contract_type = 'workforce_service_agreement' AND is_active = true
);

INSERT INTO public.contract_versions (contract_type, version, title, body_html, is_active)
SELECT
  'workforce_employment_contract',
  '1.0',
  'Employment Contract',
  '<h1>Employment Contract</h1><p>By signing you accept the terms of your employment. Remuneration is set in your workforce record.</p>',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_versions
  WHERE contract_type = 'workforce_employment_contract' AND is_active = true
);
