-- Migration 011: Full flow overhaul
-- New statuses for Requests/Quotes/Jobs, report phases, partner/customer payments

-- =============================================
-- 1. QUOTES: New fields for customer send flow
-- =============================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS deposit_required numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date_option_1 date,
  ADD COLUMN IF NOT EXISTS start_date_option_2 date,
  ADD COLUMN IF NOT EXISTS customer_accepted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_deposit_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS property_address text,
  ADD COLUMN IF NOT EXISTS partner_id uuid,
  ADD COLUMN IF NOT EXISTS partner_name text,
  ADD COLUMN IF NOT EXISTS partner_cost numeric DEFAULT 0;

-- =============================================
-- 2. JOBS: Report phases (3 stages) + partner payments + customer payments
-- =============================================
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS report_1_uploaded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_1_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_1_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_1_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_2_uploaded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_2_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_2_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_2_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_3_uploaded boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_3_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_3_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_3_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS partner_payment_1 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_payment_1_date date,
  ADD COLUMN IF NOT EXISTS partner_payment_1_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_payment_2 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_payment_2_date date,
  ADD COLUMN IF NOT EXISTS partner_payment_2_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_payment_3 numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_payment_3_date date,
  ADD COLUMN IF NOT EXISTS partner_payment_3_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_deposit numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_deposit_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_final_payment numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_final_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS self_bill_id uuid,
  ADD COLUMN IF NOT EXISTS invoice_id uuid;
