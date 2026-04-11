/**
 * Types for the /outreach bulk email feature (internal tool for sending
 * personalized emails to partners + external addresses).
 *
 * Schema lives in supabase/migrations/135_outreach_emails.sql.
 */

export type OutreachTemplateCategory =
  | "onboarding"
  | "follow_up"
  | "reactivation"
  | "announcement"
  | "custom";

export interface OutreachTemplate {
  id: string;
  name: string;
  category: OutreachTemplateCategory | null;
  subject: string;
  body_html: string;
  variables: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type OutreachCampaignStatus =
  | "draft"
  | "sending"
  | "sent"
  | "partial"
  | "failed";

export interface OutreachCampaign {
  id: string;
  template_id: string | null;
  subject: string;
  body_html: string;
  sent_by: string | null;
  sent_by_name: string | null;
  sent_at: string;
  recipient_count: number;
  delivered_count: number;
  opened_count: number;
  failed_count: number;
  status: OutreachCampaignStatus;
}

export type OutreachRecipientStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "failed";

export interface OutreachCampaignRecipient {
  id: string;
  campaign_id: string;
  partner_id: string | null;
  email: string;
  name: string | null;
  resend_message_id: string | null;
  status: OutreachRecipientStatus;
  error_message: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  created_at: string;
}

/** Variables supported by renderTemplate — keep in sync with lib/outreach/render-template.ts. */
export interface OutreachTemplateVars {
  nome?: string;
  empresa?: string;
  servico?: string;
  email?: string;
}

/** POST /api/admin/outreach/send request body. */
export interface OutreachSendRequest {
  subject: string;
  bodyHtml: string;
  recipients: {
    partnerIds: string[];
    externalEmails: string[];
  };
  templateId?: string;
  testMode?: boolean;
}
