-- Contractor Independent Framework Agreement + exclude employees from refresh cutover.

UPDATE public.contract_versions
SET is_active = false
WHERE contract_type = 'workforce_service_agreement' AND is_active = true;

INSERT INTO public.contract_versions (contract_type, version, title, body_html, is_active)
VALUES (
  'workforce_service_agreement',
  '2.0',
  'Independent Contractor Framework Agreement',
  '<p>Template body loaded from src/lib/contract-templates/fixfy-independent-contractor-agreement.html at runtime with contractor placeholders.</p>',
  true
);

-- Employees do not use contractor onboarding refresh.
UPDATE public.profiles p
SET
  workforce_refresh_required = false,
  session_valid_after = NULL,
  updated_at = NOW()
WHERE p.id IN (
  SELECT pic.profile_id
  FROM public.payroll_internal_costs pic
  WHERE pic.profile_id IS NOT NULL
    AND pic.employment_type = 'employee'
);
