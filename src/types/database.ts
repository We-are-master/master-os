import type { UserPermissionOverride } from "@/types/admin-config";

export type RequestSource = "whatsapp" | "checkatrade" | "meta" | "website" | "b2b" | "manual";
export type CatalogPricingMode = "fixed" | "hourly";

/** Price book row: defaults for requests/quotes (always editable per record). */
export interface CatalogService {
  id: string;
  name: string;
  pricing_mode: CatalogPricingMode;
  fixed_price: number;
  hourly_rate: number;
  default_hours: number;
  /** What we pay the partner (fixed total, or total for default hours bundle in hourly mode). */
  partner_cost?: number | null;
  default_description?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export type RequestStatus = "new" | "approved" | "declined" | "converted_to_quote" | "converted_to_job";
export type QuoteStatus = "draft" | "in_survey" | "bidding" | "awaiting_customer" | "accepted" | "rejected" | "converted_to_job";
export type JobStatus =
  | "unassigned"
  | "scheduled"
  | "late"
  | "in_progress_phase1"
  | "in_progress_phase2"
  | "in_progress_phase3"
  | "final_check"
  | "awaiting_payment"
  | "need_attention"
  | "completed"
  | "cancelled";
export type JobFinanceStatus = "unpaid" | "partial" | "paid";
export type PartnerStatus = "active" | "inactive" | "on_break" | "onboarding";
export type InvoiceStatus = "paid" | "pending" | "overdue" | "cancelled";

/** Customer collection lifecycle for job-linked invoices (synced from job flags unless locked). */
export type InvoiceCollectionStage =
  | "awaiting_deposit"
  | "deposit_collected"
  | "awaiting_final"
  | "completed";

export type InvoiceKind = "deposit" | "final" | "combined" | "other";
export type PipelineStage = "lead" | "qualified" | "meeting" | "proposal" | "negotiation" | "closed";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: "admin" | "manager" | "operator";
  department?: string;
  job_title?: string;
  phone?: string;
  /** `null` / missing in DB is treated as active in the UI. */
  is_active?: boolean | null;
  last_login_at?: string;
  /** Per-user permission overrides. Absent key = inherit from role. */
  custom_permissions?: UserPermissionOverride | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRequest {
  id: string;
  reference: string;
  /** Linked account client — carried through quote/job when set */
  client_id?: string;
  client_address_id?: string;
  client_name: string;
  client_email: string;
  client_phone?: string;
  /** Set when listing via join: client linked corporate account (`accounts.company_name`). */
  source_account_name?: string | null;
  property_address: string;
  postcode?: string;
  /** When set, request was started from this catalog template (service_type/description/value may differ if customised). */
  catalog_service_id?: string | null;
  service_type: string;
  description: string;
  status: RequestStatus;
  source?: RequestSource;
  priority: "low" | "medium" | "high" | "urgent";
  owner_id?: string;
  owner_name?: string;
  assigned_to?: string;
  estimated_value?: number;
  partner_value?: number;
  scope?: string;
  notes?: string;
  internal_info?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientAddress {
  id: string;
  client_id: string;
  label?: string;
  address: string;
  city?: string;
  postcode?: string;
  country?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  reference: string;
  title: string;
  request_id?: string;
  /** Optional link to the catalog service used as template for line items. */
  catalog_service_id?: string | null;
  client_id?: string;
  client_address_id?: string;
  client_name: string;
  client_email: string;
  status: QuoteStatus;
  total_value: number;
  ai_confidence?: number;
  partner_quotes_count: number;
  automation_status?: string;
  owner_id?: string;
  owner_name?: string;
  cost: number;
  sell_price: number;
  margin_percent: number;
  quote_type: "internal" | "partner";
  deposit_required: number;
  start_date_option_1?: string;
  start_date_option_2?: string;
  customer_accepted: boolean;
  customer_deposit_paid: boolean;
  scope?: string;
  /** Optional intro text for the customer email (saved on quote before send). */
  email_custom_message?: string | null;
  /** First successful customer PDF email timestamp (resends update this). */
  customer_pdf_sent_at?: string | null;
  property_address?: string;
  partner_id?: string;
  partner_name?: string;
  partner_cost: number;
  /** Trade / service label for partner app push targeting (optional). */
  service_type?: string | null;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  rejection_reason?: string;
}

export interface QuoteLineItem {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order: number;
  created_at: string;
}

export interface Job {
  id: string;
  reference: string;
  title: string;
  client_id?: string;
  client_address_id?: string;
  client_name: string;
  property_address: string;
  /** Set to null in updates to clear assignment (undefined is omitted by the client and leaves the old value). */
  partner_id?: string | null;
  partner_ids?: string[] | null;
  partner_name?: string | null;
  quote_id?: string;
  owner_id?: string;
  owner_name?: string;
  status: JobStatus;
  progress: number;
  current_phase: number;
  total_phases: number;
  client_price: number;
  /** Add-ons / upsells on top of client_price (included in revenue & margin). */
  extras_amount?: number;
  partner_cost: number;
  materials_cost: number;
  margin_percent: number;
  scheduled_date?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  /** Expected job completion day for calendar (date only; independent of arrival window). */
  scheduled_finish_date?: string | null;
  job_type?: "fixed" | "hourly";
  completed_date?: string;
  cash_in: number;
  cash_out: number;
  expenses: number;
  commission: number;
  vat: number;
  partner_agreed_value: number;
  finance_status: JobFinanceStatus;
  service_value: number;
  report_submitted: boolean;
  report_submitted_at?: string;
  report_notes?: string;
  report_1_uploaded: boolean;
  report_1_uploaded_at?: string;
  report_1_approved: boolean;
  report_1_approved_at?: string;
  report_2_uploaded: boolean;
  report_2_uploaded_at?: string;
  report_2_approved: boolean;
  report_2_approved_at?: string;
  report_3_uploaded: boolean;
  report_3_uploaded_at?: string;
  report_3_approved: boolean;
  report_3_approved_at?: string;
  partner_payment_1: number;
  partner_payment_1_date?: string;
  partner_payment_1_paid: boolean;
  partner_payment_2: number;
  partner_payment_2_date?: string;
  partner_payment_2_paid: boolean;
  partner_payment_3: number;
  partner_payment_3_date?: string;
  partner_payment_3_paid: boolean;
  customer_deposit: number;
  customer_deposit_paid: boolean;
  customer_final_payment: number;
  customer_final_paid: boolean;
  self_bill_id?: string;
  invoice_id?: string;
  scope?: string;
  internal_notes?: string;
  /** Set when partner cancels from the app (RPC `partner_cancel_job`). */
  partner_cancelled_at?: string | null;
  /** Snapshot of cancellation fee (GBP) from company_settings at cancel time. */
  partner_cancellation_fee?: number | null;
  partner_cancellation_reason?: string | null;
  /** Office-initiated cancellation (dashboard); visible internally and to partner notifications. */
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  /** 1–5 when client leaves feedback (partner app shows on completed job). */
  customer_review_rating?: number | null;
  customer_review_comment?: string | null;
  customer_review_submitted_at?: string | null;
  /** Partner app work timer — synced for Master OS live display */
  partner_timer_started_at?: string | null;
  partner_timer_ended_at?: string | null;
  partner_timer_accum_paused_ms?: number | null;
  partner_timer_is_paused?: boolean | null;
  partner_timer_pause_began_at?: string | null;
  /** Office operational flow — start-of-job report (photos, notes, checklist snapshot). */
  start_report?: Record<string, unknown> | null;
  start_report_submitted?: boolean;
  start_report_skipped?: boolean;
  /** Completion report before final checks. */
  final_report?: Record<string, unknown> | null;
  final_report_submitted?: boolean;
  final_report_skipped?: boolean;
  /** Accumulated on-site seconds when timer stopped; never decremented by UI. */
  timer_elapsed_seconds?: number;
  timer_last_started_at?: string | null;
  timer_is_running?: boolean;
  review_sent_at?: string | null;
  review_send_method?: "email" | "manual" | null;
  internal_report_approved?: boolean;
  internal_invoice_approved?: boolean;
  /** Optional checklist items for Start Job modal (when set). */
  operational_checklist?: unknown;
  created_at: string;
  updated_at: string;
}

export type JobPaymentType = "partner" | "customer_deposit" | "customer_final";

export type JobPaymentMethod = "stripe" | "bank_transfer" | "cash" | "other";

export interface JobPayment {
  id: string;
  job_id: string;
  type: JobPaymentType;
  amount: number;
  payment_date: string;
  note?: string;
  payment_method?: JobPaymentMethod | null;
  bank_reference?: string | null;
  /** When set, this row was created from a paid invoice (e.g. Stripe); dedupes webhook. */
  source_invoice_id?: string | null;
  created_at: string;
  created_by?: string;
}

export interface Partner {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  trade: string;
  /** Multi-category support. Kept in sync with `trade` (first element). */
  trades?: string[] | null;
  status: PartnerStatus;
  rating: number;
  jobs_completed: number;
  total_earnings: number;
  compliance_score: number;
  location: string;
  verified: boolean;
  internal_notes?: string;
  role?: string;
  permission?: string;
  joined_at: string;
  /** When set, this partner is the app user (jobs.partner_id, location in user_locations) */
  auth_user_id?: string | null;
  /** Public photo URL (company-assets bucket). */
  avatar_url?: string | null;
}

export interface Account {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  address?: string | null;
  crn?: string | null;
  contact_number?: string | null;
  industry: string;
  status: "active" | "onboarding" | "inactive";
  credit_limit: number;
  payment_terms: string;
  /** Optional logo image URL (HTTPS) for account header / listings */
  logo_url?: string | null;
  /** Optional URL/path for the signed client contract document */
  contract_url?: string | null;
  total_revenue: number;
  active_jobs: number;
  created_at: string;
}

export interface Invoice {
  id: string;
  reference: string;
  client_name: string;
  job_reference?: string;
  amount: number;
  status: InvoiceStatus;
  due_date: string;
  paid_date?: string;
  created_at: string;
  collection_stage: InvoiceCollectionStage;
  collection_stage_locked?: boolean;
  invoice_kind?: InvoiceKind | null;
  stripe_payment_link_id?: string;
  stripe_payment_link_url?: string;
  stripe_payment_status?: "none" | "pending" | "paid" | "expired" | "failed";
  stripe_payment_intent_id?: string;
  stripe_customer_email?: string;
  stripe_paid_at?: string;
}

export interface SelfBill {
  id: string;
  reference: string;
  partner_name: string;
  period: string;
  jobs_count: number;
  job_value: number;
  materials: number;
  commission: number;
  net_payout: number;
  status: "awaiting_payment" | "ready_to_pay" | "paid" | "audit_required";
  created_at: string;
}

/** Custos internos (payroll, despesas operacionais pontuais) */
export type InternalCostStatus = "pending" | "paid";
export interface InternalCost {
  id: string;
  reference?: string;
  description: string;
  amount: number;
  category?: string;
  due_date?: string;
  status: InternalCostStatus;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

/** Bills recorrentes (rent, software, utilities, etc.) */
export type RecurringBillFrequency = "monthly" | "quarterly" | "yearly";
export type RecurringBillStatus = "active" | "paused";
export interface RecurringBill {
  id: string;
  name: string;
  description?: string;
  amount: number;
  frequency: RecurringBillFrequency;
  next_due_date: string;
  category?: string;
  status: RecurringBillStatus;
  created_at: string;
  updated_at: string;
}

/** Internal squad (London, Midlands, North) for routing and payroll */
export interface Squad {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type TeamMemberRole = "am" | "ops_coord" | "biz_dev" | "head_ops" | "ceo" | "it";
export type TeamMemberStatus = "active" | "inactive";

export interface TeamMember {
  id: string;
  /** Linked app user (profiles.id); null when explicitly unlinked in DB */
  profile_id?: string | null;
  full_name: string;
  email?: string;
  phone?: string;
  role: TeamMemberRole;
  squad_id?: string;
  squad_name?: string;
  base_salary?: number;
  start_date?: string;
  status: TeamMemberStatus;
  created_at: string;
  updated_at: string;
}

/** Commission tier (e.g. Tier 1 <£35k 0%, Tier 2 £35k–£40k 10%) */
export interface CommissionTier {
  id: string;
  tier_number: number;
  breakeven_amount: number;
  rate_percent: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Pool share by role: Head Ops 40%, AM 40%, Biz Dev 20% */
export interface CommissionPoolShare {
  id: string;
  role: "head_ops" | "am" | "biz_dev";
  share_percent: number;
  created_at: string;
  updated_at: string;
}

/** Unified company bills: recurring + one-off, workflow Submitted → Approved → Paid/Rejected */
export type BillStatus = "submitted" | "approved" | "paid" | "rejected";
export type BillRecurrence = "monthly" | "quarterly" | "yearly";

export interface Bill {
  id: string;
  description: string;
  category?: string;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  recurrence_interval?: BillRecurrence;
  submitted_by_id?: string;
  submitted_by_name?: string;
  status: BillStatus;
  receipt_url?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
  parent_bill_id?: string;
}

/** Commission run: period, tier calc, manager approves → feeds Pay Run */
export type CommissionRunStatus = "draft" | "approved";

export interface CommissionRun {
  id: string;
  period_start: string;
  period_end: string;
  status: CommissionRunStatus;
  approved_at?: string;
  approved_by_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CommissionRunItem {
  id: string;
  commission_run_id: string;
  team_member_id: string;
  team_member_name?: string;
  base_salary?: number;
  commission_amount: number;
  tier_detail?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Pay run: weekly hub, aggregates payroll + self_bills + bills */
export type PayRunStatus = "open" | "closed";

export interface PayRun {
  id: string;
  week_start: string;
  week_end: string;
  status: PayRunStatus;
  created_at: string;
  updated_at: string;
}

export type PayRunItemType = "payroll" | "self_bill" | "bill";

export interface PayRunItem {
  id: string;
  pay_run_id: string;
  item_type: PayRunItemType;
  source_id: string;
  amount: number;
  due_date?: string;
  status: "pending" | "paid";
  paid_at?: string;
  created_at: string;
  /** Display: description or partner/bill name */
  source_label?: string;
}

export type ClientType = "residential" | "landlord" | "tenant" | "commercial" | "other";
export type ClientSource = "direct" | "referral" | "website" | "partner" | "corporate" | "other";
export type ClientStatus = "active" | "inactive" | "vip" | "blocked";

/** Row from `accounts` used in client linking UI (`clients.source_account_id` → `accounts.id`) */
export interface ClientSourceAccount {
  id: string;
  name: string;
  slug?: string;
  created_at: string;
}

export interface Client {
  id: string;
  /** Corporate account (`accounts.id`). `null` in DB = not linked. */
  source_account_id?: string | null;
  full_name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postcode?: string;
  client_type: ClientType;
  source: ClientSource;
  status: ClientStatus;
  notes?: string;
  total_spent: number;
  jobs_count: number;
  last_job_date?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface PipelineDeal {
  id: string;
  account_name: string;
  category: string;
  stage: PipelineStage;
  value: number;
  monthly_volume?: number;
  properties?: number;
  owner_name: string;
  owner_avatar?: string;
  last_activity: string;
  created_at: string;
}

export interface Activity {
  id: string;
  type: "request" | "quote" | "job" | "partner" | "invoice" | "system";
  title: string;
  description: string;
  user_name?: string;
  reference?: string;
  created_at: string;
}

export type AuditAction = "created" | "updated" | "status_changed" | "phase_advanced" | "assigned" | "deleted" | "note" | "document_added" | "payment" | "bulk_update";
export type AuditEntityType = "request" | "quote" | "job" | "invoice" | "partner" | "account" | "self_bill" | "system";

export interface AuditLog {
  id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_ref?: string;
  action: AuditAction;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  user_id?: string;
  user_name?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}
