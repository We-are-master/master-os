export type RequestStatus = "new" | "qualified" | "in_review" | "converted" | "declined";
export type QuoteStatus = "draft" | "partner_bidding" | "ai_review" | "sent" | "approved" | "expired";
export type JobStatus = "pending_schedule" | "in_progress" | "on_hold" | "completed" | "cancelled";
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
  created_at: string;
  updated_at: string;
}

export interface Quote {
  id: string;
  reference: string;
  title: string;
  request_id?: string;
  client_name: string;
  client_email: string;
  status: QuoteStatus;
  total_value: number;
  ai_confidence?: number;
  partner_quotes_count: number;
  automation_status?: string;
  owner_id?: string;
  owner_name?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface Job {
  id: string;
  reference: string;
  title: string;
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
  completed_date?: string;
  created_at: string;
  updated_at: string;
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
  joined_at: string;
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
  status: "payment_sent" | "generated" | "audit_required";
  created_at: string;
}

export type ClientType = "residential" | "landlord" | "tenant" | "commercial" | "other";
export type ClientSource = "direct" | "referral" | "website" | "partner" | "corporate" | "other";
export type ClientStatus = "active" | "inactive" | "vip" | "blocked";

export interface Client {
  id: string;
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
