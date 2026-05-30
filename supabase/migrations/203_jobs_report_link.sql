-- Migration 203: Persist the customer-facing report link supplied at job
-- creation time.
--
-- This is a free-text URL the office types into a Zendesk job-form field
-- (e.g. a Drive folder, Notion page, internal portal) — the place where
-- staff later submits the report to the corporate client. It is NOT the
-- partner-app submission link (which is built on the fly from the job
-- reference); the partner side has its own flow.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS report_link text;

COMMENT ON COLUMN public.jobs.report_link IS
  'Customer-facing report destination link supplied at job creation (typically pasted into the Zendesk job form). Distinct from the auto-built partner-app report URL — this one points wherever the office wants to submit / store the customer-side report (Drive folder, Notion page, internal portal, etc.).';
