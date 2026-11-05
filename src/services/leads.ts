import { getSupabase, queryList, type ListParams, type ListResult } from "./base";
import type {
  Lead,
  LeadEvent,
  LeadEventActor,
  LeadEventChannel,
  LeadEventKind,
  LeadLostReason,
  LeadSegment,
  LeadStage,
  LeadStatus,
  LeadUrgency,
} from "@/types/database";
import { legacyStatusFromStage, stageForLegacyStatusChange, validateStageChange } from "@/lib/crm/etapas";
import { allocateClientForLead, type LeadClientAllocationInput } from "@/lib/lead-client-allocation";
import {
  formatLeadPhoneDisplay,
  normalizeLeadEmail,
  normalizeLeadPostcode,
  validateLeadForm,
} from "@/lib/lead-validation";

function postgrestErrorMessage(err: { message?: string; details?: string; hint?: string }): string {
  const parts = [err.message, err.details, err.hint]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : "Database request failed";
}

function isMissingLeadsColumnError(err: { message?: string; code?: string }): boolean {
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "PGRST204" ||
    m.includes("schema cache") ||
    (m.includes("column") && (m.includes("email") || m.includes("client_id") || m.includes("address")))
  );
}

export async function listLeads(params: ListParams): Promise<ListResult<Lead>> {
  return queryList<Lead>("leads", params, {
    searchColumns: ["reference", "name", "email", "phone", "address", "scope"],
    defaultSort: "created_at",
  });
}

/** Cheap head count of non-cancelled jobs linked to a client (used by the Leads drawer). */
export async function countJobsForClient(clientId: string): Promise<number> {
  if (!clientId.trim()) return 0;
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) return 0;
  return count ?? 0;
}

export async function getLead(id: string): Promise<Lead | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(postgrestErrorMessage(error));
  return (data as Lead | null) ?? null;
}

export type CreateLeadInput = LeadClientAllocationInput & {
  urgency?: LeadUrgency;
  scope?: string;
  status?: LeadStatus;
  owner_id?: string | null;
  /** Required — picked from the service_catalog dropdown in the New Lead modal.
   *  Drives Trade Portal targeting; without it the portal would broadcast the
   *  lead to every partner regardless of trade. */
  catalog_service_id: string;
  /** CRM (mig 356). */
  segment?: LeadSegment;
  /** lead_channels.key */
  source?: string | null;
  /** Id do ticket do Zendesk que já existe. Ticket novo só quando o dono mandar. */
  zendesk_ticket_id?: string | number | null;
  next_action?: string | null;
  next_action_at?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const formInput = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    scope: input.scope ?? "",
  };
  const errors = validateLeadForm(formInput);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);

  const catalogServiceId = (input.catalog_service_id ?? "").trim();
  if (!catalogServiceId) throw new Error("Select a Type of Work for the lead.");
  if (!UUID_RE.test(catalogServiceId)) {
    throw new Error("Type of Work selection is invalid.");
  }

  const supabase = getSupabase();
  const { accountId, clientId, clientAddressId } = await allocateClientForLead(supabase, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    city: input.city,
    postcode: input.postcode,
  });

  const { data: refData, error: refErr } = await supabase.rpc("next_lead_ref");
  if (refErr) throw new Error(postgrestErrorMessage(refErr));
  const reference = String(refData ?? "").trim();
  if (!reference) throw new Error("Could not generate lead reference");

  const addressLine = [input.address.trim(), input.city?.trim(), input.postcode?.trim()]
    .filter(Boolean)
    .join(", ");
  const postcode = normalizeLeadPostcode(input.postcode, addressLine);

  const payload: Record<string, unknown> = {
    reference,
    name: input.name.trim(),
    email: normalizeLeadEmail(input.email),
    phone: formatLeadPhoneDisplay(input.phone),
    address: input.address.trim(),
    city: input.city?.trim() || null,
    postcode,
    urgency: input.urgency ?? "medium",
    scope: (input.scope ?? "").trim(),
    status: input.status ?? "new",
    stage: input.status === "interested" ? "talking" : "new",
    segment: input.segment ?? "b2c",
    source: input.source?.trim() || null,
    external_source: input.zendesk_ticket_id ? "zendesk" : null,
    external_ref: input.zendesk_ticket_id ? String(input.zendesk_ticket_id).trim() : null,
    next_action: input.next_action?.trim() || null,
    next_action_at: input.next_action_at || null,
    owner_id: input.owner_id ?? null,
    client_id: clientId,
    client_address_id: clientAddressId,
    account_id: accountId,
    catalog_service_id: catalogServiceId,
    // Publish to partners on creation so the lead reaches the Trade Portal
    // without staff needing to click "Publish" first. Office can still
    // unpublish from the lead detail panel when they want it hidden.
    published_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("leads").insert(payload).select("*").single();
  if (error) {
    if (isMissingLeadsColumnError(error)) {
      throw new Error("Leads contact fields are not in the database yet. Run migration 197_leads_contact_client.sql.");
    }
    throw new Error(postgrestErrorMessage(error));
  }
  const lead = data as Lead;
  await recordLeadEvent({
    leadId: lead.id,
    kind: "created",
    channel: "os",
    toStage: lead.stage ?? "new",
    summary: input.source ? `Lead created · ${input.source}` : "Lead created",
  });
  return lead;
}

export type UpdateLeadInput = Partial<
  Pick<
    Lead,
    | "name"
    | "email"
    | "phone"
    | "address"
    | "city"
    | "postcode"
    | "urgency"
    | "scope"
    | "status"
    | "owner_id"
    | "published_at"
    | "images"
  >
>;

export async function updateLead(id: string, patch: UpdateLeadInput): Promise<Lead> {
  const supabase = getSupabase();
  const existing = await getLead(id);
  if (!existing) throw new Error("Lead not found");

  const merged = {
    name: patch.name ?? existing.name,
    email: patch.email ?? existing.email ?? "",
    phone: patch.phone ?? existing.phone ?? "",
    address: patch.address ?? existing.address ?? "",
    city: patch.city ?? existing.city ?? "",
    postcode: patch.postcode ?? existing.postcode ?? "",
    scope: patch.scope ?? existing.scope,
  };

  const errors = validateLeadForm({
    name: merged.name,
    email: merged.email,
    phone: merged.phone,
    address: merged.address,
    scope: merged.scope,
  });
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);

  const { accountId, clientId, clientAddressId } = await allocateClientForLead(supabase, merged);

  const addressLine = [merged.address.trim(), merged.city?.trim(), merged.postcode?.trim()]
    .filter(Boolean)
    .join(", ");

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    name: merged.name.trim(),
    email: normalizeLeadEmail(merged.email),
    phone: formatLeadPhoneDisplay(merged.phone),
    address: merged.address.trim(),
    city: merged.city?.trim() || null,
    postcode: normalizeLeadPostcode(merged.postcode, addressLine),
    scope: merged.scope.trim(),
    client_id: clientId,
    client_address_id: clientAddressId,
    account_id: accountId,
  };

  if (patch.urgency !== undefined) payload.urgency = patch.urgency;
  let stageMove: { from: LeadStage; to: LeadStage } | null = null;
  if (patch.status !== undefined) {
    payload.status = patch.status;
    const from = existing.stage ?? "new";
    const to = stageForLegacyStatusChange(from, patch.status);
    if (to !== from) {
      payload.stage = to;
      payload.stage_changed_at = new Date().toISOString();
      stageMove = { from, to };
    }
  }
  if (patch.owner_id !== undefined) payload.owner_id = patch.owner_id;
  if (patch.published_at !== undefined) payload.published_at = patch.published_at;
  if (patch.images !== undefined) {
    payload.images = Array.isArray(patch.images) ? patch.images.filter(Boolean) : [];
  }

  const { data, error } = await supabase
    .from("leads")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) {
    if (isMissingLeadsColumnError(error)) {
      throw new Error("Leads contact fields are not in the database yet. Run migration 197_leads_contact_client.sql.");
    }
    throw new Error(postgrestErrorMessage(error));
  }
  if (stageMove) {
    await recordLeadEvent({ leadId: id, kind: "stage_changed", channel: "os", fromStage: stageMove.from, toStage: stageMove.to });
  }
  return data as Lead;
}

/** Soft-delete lead — hidden from OS lists, Pulse, and partner offers (unpublished). */
export async function deleteLead(id: string, deletedBy?: string): Promise<void> {
  const existing = await getLead(id);
  if (!existing) throw new Error("Lead not found");

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("leads")
    .update({
      deleted_at: now,
      deleted_by: deletedBy ?? null,
      published_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) throw new Error(postgrestErrorMessage(error));
}


// ─── CRM (mig 356) ───────────────────────────────────────────────────────────

export type LeadEventInput = {
  leadId: string;
  kind: LeadEventKind;
  channel?: LeadEventChannel | null;
  actorType?: LeadEventActor;
  actorId?: string | null;
  fromStage?: LeadStage | null;
  toStage?: LeadStage | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  /** Mesma chave = mesmo evento; a segunda gravação é ignorada. */
  idempotencyKey?: string | null;
};

/**
 * Grava uma linha na timeline do lead. Nunca derruba quem chamou: a timeline
 * é registro, não pré-condição.
 */
export async function recordLeadEvent(e: LeadEventInput): Promise<void> {
  try {
    const supabase = getSupabase();
    let actorId = e.actorId ?? null;
    if (!actorId && (e.actorType ?? "staff") === "staff") {
      const { data } = await supabase.auth.getUser();
      actorId = data.user?.id ?? null;
    }
    const row = {
      lead_id: e.leadId,
      kind: e.kind,
      channel: e.channel ?? null,
      actor_type: e.actorType ?? "staff",
      actor_id: actorId,
      from_stage: e.fromStage ?? null,
      to_stage: e.toStage ?? null,
      summary: e.summary ?? null,
      payload: e.payload ?? {},
      idempotency_key: e.idempotencyKey ?? null,
    };
    const q = e.idempotencyKey
      ? supabase.from("lead_events").upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
      : supabase.from("lead_events").insert(row);
    const { error } = await q;
    if (error) console.warn("[lead_events]", error.message);
  } catch (err) {
    console.warn("[lead_events]", err instanceof Error ? err.message : err);
  }
}

export async function listLeadEvents(leadId: string, limit = 100): Promise<LeadEvent[]> {
  const { data, error } = await getSupabase()
    .from("lead_events")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(postgrestErrorMessage(error));
  return (data ?? []) as LeadEvent[];
}

export type ChangeLeadStageInput = {
  lostReason?: LeadLostReason | null;
  lostNote?: string | null;
  /** YYYY-MM-DD */
  nurtureUntil?: string | null;
  jobId?: string | null;
  summary?: string | null;
};

/** Muda a etapa com as regras do CRM e registra na timeline. */
export async function changeLeadStage(id: string, to: LeadStage, extra: ChangeLeadStageInput = {}): Promise<Lead> {
  const existing = await getLead(id);
  if (!existing) throw new Error("Lead not found");
  const from = existing.stage ?? "new";
  const problem = validateStageChange({
    from,
    to,
    lostReason: extra.lostReason,
    nurtureUntil: extra.nurtureUntil,
    jobId: extra.jobId ?? existing.job_id,
  });
  if (problem) throw new Error(problem);
  if (from === to) return existing;

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    stage: to,
    stage_changed_at: now,
    status: legacyStatusFromStage(to),
    updated_at: now,
  };
  if (to === "lost") {
    payload.lost_reason = extra.lostReason;
    payload.lost_note = extra.lostNote?.trim() || null;
    payload.lost_at = now;
  }
  if (to === "nurture") payload.nurture_until = extra.nurtureUntil;
  if (to === "won") {
    payload.won_at = now;
    payload.job_id = extra.jobId ?? existing.job_id;
  }

  const { data, error } = await getSupabase()
    .from("leads")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw new Error(postgrestErrorMessage(error));
  await recordLeadEvent({
    leadId: id,
    kind: "stage_changed",
    channel: "os",
    fromStage: from,
    toStage: to,
    summary: extra.summary ?? (to === "lost" ? `Lost · ${extra.lostReason}` : null),
  });
  return data as Lead;
}

/** Define o próximo passo do lead e registra na timeline. */
export async function setLeadNextAction(id: string, nextAction: string, nextActionAt: string): Promise<Lead> {
  const texto = nextAction.trim();
  if (!texto) throw new Error("Write the next action");
  if (!nextActionAt || Number.isNaN(Date.parse(nextActionAt))) throw new Error("Pick a date for the next action");
  const { data, error } = await getSupabase()
    .from("leads")
    .update({ next_action: texto, next_action_at: nextActionAt, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw new Error(postgrestErrorMessage(error));
  await recordLeadEvent({ leadId: id, kind: "next_action_set", channel: "os", summary: texto, payload: { next_action_at: nextActionAt } });
  return data as Lead;
}
