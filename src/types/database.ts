import type { UserPermissionOverride } from "@/types/admin-config";

export type RequestStatus = "new" | "approved" | "declined" | "converted_to_quote" | "converted_to_job";
export type QuoteStatus = "draft" | "in_survey" | "bidding" | "awaiting_customer" | "accepted" | "rejected" | "converted_to_job";
export type JobStatus = "scheduled" | "in_progress_phase1" | "in_progress_phase2" | "in_progress_phase3" | "final_check" | "awaiting_payment" | "need_attention" | "completed";
export type JobFinanceStatus = "unpaid" | "partial" | "paid";
export type PartnerStatus = "active" | "inactive" | "on_break" | "onboarding";
export type InvoiceStatus = "paid" | "pending" | "overdue" | "cancelled";
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
  is_active: boolean;
  last_login_at?: string;
  /** Per-user permission overrides. Absent key = inherit from role. */
  custom_permissions?: UserPermissionOverride | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRequest {
  id: string;
  reference: string;
  client_name: string;
  client_email: string;
  client_phone?: string;
  property_address: string;
  service_type: string;
  description: string;
  status: RequestStatus;
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
  property_address?: string;
  partner_id?: string;
  partner_name?: string;
  partner_cost: number;
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
  partner_id?: string;
  partner_name?: string;
  quote_id?: string;
  owner_id?: string;
  owner_name?: string;
  status: JobStatus;
  progress: number;
  current_phase: number;
  total_phases: number;
  client_price: number;
  partner_cost: number;
  materials_cost: number;
  margin_percent: number;
  scheduled_date?: string;
  scheduled_start_at?: string;
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
  created_at: string;
  updated_at: string;
}

export type JobPaymentType = "partner" | "customer_deposit" | "customer_final";

export interface JobPayment {
  id: string;
  job_id: string;
  type: JobPaymentType;
  amount: number;
  payment_date: string;
  note?: string;
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
}

export interface Account {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  industry: string;
  status: "active" | "onboarding" | "inactive";
  credit_limit: number;
  payment_terms: string;
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

export type ClientType = "residential" | "landlord" | "tenant" | "commercial" | "other";
export type ClientSource = "direct" | "referral" | "website" | "partner" | "corporate" | "other";
export type ClientStatus = "active" | "inactive" | "vip" | "blocked";

/** Account de origem do cliente (ex: Facebook, Housekeep, Website) */
export interface ClientSourceAccount {
  id: string;
  name: string;
  slug?: string;
  created_at: string;
}

export interface Client {
  id: string;
  source_account_id?: string;
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
