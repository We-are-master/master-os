-- Additional hot-path indexes identified during the 2026-04 production performance audit.
-- All statements use IF NOT EXISTS so this is safe to re-run.

-- invoices.stripe_payment_link_id — looked up by /api/stripe/check-status and webhook handlers
-- Partial index (mostly null) keeps it tiny and matches the eq query exactly.
CREATE INDEX IF NOT EXISTS idx_invoices_stripe_link_id
  ON public.invoices (stripe_payment_link_id)
  WHERE stripe_payment_link_id IS NOT NULL;

-- self_bills (partner_id, week_start) — hottest weekly bucket lookup (ensureWeeklySelfBillForJob,
-- listSelfBillsByPartnerAndWeek, payroll close-week). Composite is the access pattern.
CREATE INDEX IF NOT EXISTS idx_self_bills_partner_week
  ON public.self_bills (partner_id, week_start)
  WHERE partner_id IS NOT NULL;

-- self_bills.status — finance pages and pay-run filters key off this
CREATE INDEX IF NOT EXISTS idx_self_bills_status
  ON public.self_bills (status);

-- pay_run_items (pay_run_id, status) — listing by run + filtering paid/unpaid
CREATE INDEX IF NOT EXISTS idx_pay_run_items_run_status
  ON public.pay_run_items (pay_run_id, status);

-- audit_logs.created_at — time-window queries on the audit trail without entity filter
CREATE INDEX IF NOT EXISTS idx_audit_created_at
  ON public.audit_logs (created_at DESC);

-- jobs.scheduled_start_at — scheduled-window overlap queries (the OpenCage timestamptz path)
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_start_at_active
  ON public.jobs (scheduled_start_at)
  WHERE deleted_at IS NULL AND scheduled_start_at IS NOT NULL;

-- jobs.self_bill_id — used by listSelfBillsLinkedToJob and reverse lookups during pay runs
CREATE INDEX IF NOT EXISTS idx_jobs_self_bill_id_active
  ON public.jobs (self_bill_id)
  WHERE deleted_at IS NULL AND self_bill_id IS NOT NULL;

-- jobs.invoice_id — listInvoicesLinkedToJob and finance reconciliation
CREATE INDEX IF NOT EXISTS idx_jobs_invoice_id_active
  ON public.jobs (invoice_id)
  WHERE deleted_at IS NULL AND invoice_id IS NOT NULL;

-- bills (status, due_date) composite — Finance bills page filters by status then sorts by due
CREATE INDEX IF NOT EXISTS idx_bills_status_due
  ON public.bills (status, due_date);

-- payroll_internal_costs.status — payroll page filters
CREATE INDEX IF NOT EXISTS idx_payroll_internal_costs_status
  ON public.payroll_internal_costs (status);
