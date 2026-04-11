/**
 * Client-side fetch wrappers around /api/admin/outreach/* endpoints.
 * All mutations go through the API so admin gating + rate limiting stay
 * server-side; this module never talks to Supabase directly.
 */

import type {
  OutreachTemplate,
  OutreachTemplateCategory,
  OutreachCampaign,
  OutreachCampaignRecipient,
  OutreachSendRequest,
} from "@/types/outreach";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<OutreachTemplate[]> {
  const res = await fetch("/api/admin/outreach/templates", { cache: "no-store" });
  const data = await handle<{ templates: OutreachTemplate[] }>(res);
  return data.templates;
}

export interface CreateTemplateInput {
  name: string;
  category: OutreachTemplateCategory | null;
  subject: string;
  body_html: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<OutreachTemplate> {
  const res = await fetch("/api/admin/outreach/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await handle<{ template: OutreachTemplate }>(res);
  return data.template;
}

export async function updateTemplate(
  id: string,
  input: Partial<CreateTemplateInput>,
): Promise<OutreachTemplate> {
  const res = await fetch(`/api/admin/outreach/templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await handle<{ template: OutreachTemplate }>(res);
  return data.template;
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/admin/outreach/templates/${id}`, { method: "DELETE" });
  await handle<{ success: true }>(res);
}

export async function duplicateTemplate(id: string): Promise<OutreachTemplate> {
  const res = await fetch("/api/admin/outreach/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duplicate_of: id }),
  });
  const data = await handle<{ template: OutreachTemplate }>(res);
  return data.template;
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export interface SendCampaignResult {
  campaignId?: string;
  recipientCount?: number;
  sent?: number;
  failed?: number;
  skipped?: { input: string; reason: string }[];
  testMode?: boolean;
  messageId?: string;
  sentTo?: string;
}

export async function sendCampaign(input: OutreachSendRequest): Promise<SendCampaignResult> {
  const res = await fetch("/api/admin/outreach/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handle<SendCampaignResult>(res);
}

export async function listCampaigns(
  limit = 50,
  offset = 0,
): Promise<{ campaigns: OutreachCampaign[]; total: number }> {
  const res = await fetch(
    `/api/admin/outreach/campaigns?limit=${limit}&offset=${offset}`,
    { cache: "no-store" },
  );
  return handle<{ campaigns: OutreachCampaign[]; total: number }>(res);
}

export async function getCampaign(id: string): Promise<{
  campaign: OutreachCampaign;
  recipients: OutreachCampaignRecipient[];
}> {
  const res = await fetch(`/api/admin/outreach/campaigns/${id}`, { cache: "no-store" });
  return handle<{ campaign: OutreachCampaign; recipients: OutreachCampaignRecipient[] }>(res);
}
