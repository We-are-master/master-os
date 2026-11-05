/**
 * Dados do CRM de Leads para a tela (fase 2). Só leitura e escrita do cliente
 * (sessão do staff); regra pura fica em src/lib/crm/*.
 */
import { getSupabase, type ListParams, type ListResult } from "./base";
import { createQuote } from "./quotes";
import { changeLeadStage, recordLeadEvent } from "./leads";
import type { Lead, LeadSegment, LeadStage, Quote } from "@/types/database";
import { OPEN_STAGES } from "@/lib/crm/etapas";
import { sanitizePostgrestValue } from "@/lib/supabase/sanitize";

export type CrmTab = "open" | LeadStage;
export type SegmentFilter = "all" | LeadSegment;

const SEARCH_COLUMNS = ["reference", "name", "email", "phone", "address", "postcode", "scope", "external_ref"];

/** O hook de lista só conhece `status`; levamos aba e segmento juntos: "open:b2b". */
export function encodeCrmFilter(tab: CrmTab, segment: SegmentFilter): string {
  return `${tab}:${segment}`;
}

export function decodeCrmFilter(raw: string | undefined): { tab: CrmTab; segment: SegmentFilter } {
  const [tab, segment] = String(raw ?? "open:all").split(":");
  const seg: SegmentFilter = segment === "b2b" || segment === "b2c" ? segment : "all";
  return { tab: (!tab || tab === "today" ? "open" : tab) as CrmTab, segment: seg };
}

function stagesForTab(tab: CrmTab): readonly LeadStage[] {
  if (tab === "open") return OPEN_STAGES;
  return [tab];
}

/** Lista da aba (List view). Abertas: próximo passo mais antigo primeiro, sem próximo passo no topo. */
export async function listCrmLeads(params: ListParams): Promise<ListResult<Lead>> {
  const { tab, segment } = decodeCrmFilter(params.status);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const from = (page - 1) * pageSize;

  let q = getSupabase()
    .from("leads")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .in("stage", stagesForTab(tab) as LeadStage[]);
  if (segment !== "all") q = q.eq("segment", segment);
  const safe = sanitizePostgrestValue(params.search);
  if (safe) q = q.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.%${safe}%`).join(","));

  if (params.sortBy) {
    q = q.order(params.sortBy, { ascending: params.sortDir === "asc" });
  } else {
    // O que acabou de chegar fica no topo.
    q = q.order("created_at", { ascending: false });
  }

  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw error;
  const total = count ?? 0;
  return { data: (data ?? []) as Lead[], count: total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Contagem por etapa (e Open = soma das abertas). */
export async function getStageCounts(segment: SegmentFilter): Promise<Record<string, number>> {
  const supabase = getSupabase();
  const stages: LeadStage[] = ["new", "talking", "quoting", "quote_sent", "accepted", "won", "lost", "nurture"];
  const results = await Promise.all(
    stages.map(async (st) => {
      let q = supabase.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("stage", st);
      if (segment !== "all") q = q.eq("segment", segment);
      const { count } = await q;
      return [st, count ?? 0] as const;
    }),
  );
  const out: Record<string, number> = Object.fromEntries(results);
  out.open = OPEN_STAGES.reduce((s, st) => s + (out[st] ?? 0), 0);
  return out;
}

// ─── Board ───────────────────────────────────────────────────────────────────

export const BOARD_STAGES: LeadStage[] = ["new", "talking", "quoting", "quote_sent", "accepted", "won", "nurture"];

/** Até `perColumn` cards por etapa, o mais recente primeiro. */
export async function listBoardLeads(segment: SegmentFilter, search: string, perColumn = 30): Promise<Record<string, Lead[]>> {
  const supabase = getSupabase();
  const safe = sanitizePostgrestValue(search);
  const cols = await Promise.all(
    BOARD_STAGES.map(async (st) => {
      let q = supabase.from("leads").select("*").is("deleted_at", null).eq("stage", st);
      if (segment !== "all") q = q.eq("segment", segment);
      if (safe) q = q.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.%${safe}%`).join(","));
      q = q.order("created_at", { ascending: false });
      const { data } = await q.limit(perColumn);
      return [st, (data ?? []) as Lead[]] as const;
    }),
  );
  return Object.fromEntries(cols);
}

// ─── Quotes do lead ──────────────────────────────────────────────────────────

export type LeadQuote = Pick<
  Quote,
  | "id"
  | "reference"
  | "status"
  | "sell_price"
  | "total_value"
  | "partner_cost"
  | "cost"
  | "customer_deposit_paid"
  | "deposit_required"
  | "lead_id"
  | "created_at"
>;

const QUOTE_COLS = "id, reference, status, sell_price, total_value, partner_cost, cost, customer_deposit_paid, deposit_required, lead_id, created_at";

/** A quote mais recente de cada lead (não apagada). */
export async function listLatestQuotesForLeads(leadIds: string[]): Promise<Record<string, LeadQuote>> {
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await getSupabase()
    .from("quotes")
    .select(QUOTE_COLS)
    .in("lead_id", ids)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) return {};
  const out: Record<string, LeadQuote> = {};
  for (const q of (data ?? []) as LeadQuote[]) {
    if (q.lead_id && !out[q.lead_id]) out[q.lead_id] = q;
  }
  return out;
}

export async function getLatestLeadQuote(leadId: string): Promise<LeadQuote | null> {
  const map = await listLatestQuotesForLeads([leadId]);
  return map[leadId] ?? null;
}

/** Valor do lead para mostrar: quote, senão o preço dado no chat. */
export function leadValue(lead: Pick<Lead, "price_given">, quote?: LeadQuote | null): number | null {
  const v = Number(quote?.sell_price || quote?.total_value || lead.price_given || 0);
  return v > 0 ? v : null;
}

// ─── Conta e canais ──────────────────────────────────────────────────────────

/** Contas de plataforma (Housekeep, Express, Fantastic) não pedem entrada. */
export async function accountSkipsDeposit(accountId: string | null | undefined): Promise<boolean> {
  if (!accountId) return false;
  const { data } = await getSupabase().from("accounts").select("process_type").eq("id", accountId).maybeSingle();
  return (data as { process_type?: string | null } | null)?.process_type === "platform";
}

/** Das contas pedidas, as de plataforma (sem entrada). Para os cards do board. */
export async function listPlatformAccountIds(accountIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data } = await getSupabase().from("accounts").select("id, process_type").in("id", ids);
  return new Set(((data ?? []) as { id: string; process_type?: string | null }[]).filter((a) => a.process_type === "platform").map((a) => a.id));
}

/** Nome da conta de cada lead do board (accounts.company_name). */
export async function listAccountNames(accountIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await getSupabase().from("accounts").select("id, company_name").in("id", ids);
  return Object.fromEntries((data ?? []).map((a: { id: string; company_name: string | null }) => [a.id, a.company_name ?? ""]));
}

export type LeadChannel = { key: string; label: string };

export async function listLeadChannels(): Promise<LeadChannel[]> {
  const { data, error } = await getSupabase()
    .from("lead_channels")
    .select("key, label")
    .eq("active", true)
    .order("sort")
    .order("label");
  if (error) return [];
  return (data ?? []) as LeadChannel[];
}

// ─── Ready for job ───────────────────────────────────────────────────────────

export type LeadJobFields = Partial<
  Pick<Lead, "preferred_date" | "preferred_window" | "in_ccz" | "has_free_parking" | "job_kind" | "price_mode" | "price_given">
>;

export async function updateLeadJobFields(id: string, patch: LeadJobFields): Promise<Lead> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    payload[k] = typeof v === "string" ? v.trim() || null : v;
  }
  const { data, error } = await getSupabase()
    .from("leads")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Lead;
}

// ─── Quote a partir do lead ──────────────────────────────────────────────────

/**
 * Cria a quote em rascunho ligada ao lead, com o roteamento ainda aberto
 * (draft_route_completed = false): a tela de Quotes abre no passo
 * "Partner bid ou Manual", o mesmo do botão Create a quote.
 */
export async function createQuoteFromLead(
  lead: Lead,
  opts: { title: string; semEntrada: boolean; ownerId?: string | null; ownerName?: string | null },
): Promise<Quote> {
  const quote = await createQuote({
    title: opts.title,
    lead_id: lead.id,
    client_id: lead.client_id ?? undefined,
    client_address_id: lead.client_address_id ?? undefined,
    client_name: lead.name,
    client_email: lead.email ?? "",
    source_account_id: lead.account_id ?? null,
    catalog_service_id: lead.catalog_service_id ?? null,
    status: "draft",
    total_value: 0,
    partner_quotes_count: 0,
    cost: 0,
    sell_price: 0,
    margin_percent: 0,
    quote_type: "internal",
    draft_route_completed: false,
    deposit_percent: opts.semEntrada ? 0 : 50,
    deposit_required: 0,
    customer_accepted: false,
    customer_deposit_paid: false,
    partner_cost: 0,
    property_address: [lead.address, lead.city, lead.postcode].filter((s) => s && String(s).trim()).join(", "),
    postcode: lead.postcode ?? null,
    scope: lead.scope,
    images: lead.images?.length ? lead.images : undefined,
    engagement_kind: lead.job_kind === "recurring" ? "recurring" : "one_off",
    external_source: lead.external_ref ? (lead.external_source ?? "zendesk") : null,
    external_ref: lead.external_ref ?? null,
    owner_id: opts.ownerId ?? undefined,
    owner_name: opts.ownerName ?? undefined,
  });
  await recordLeadEvent({
    leadId: lead.id,
    kind: "quote_created",
    channel: "os",
    summary: `Quote ${quote.reference} created`,
    payload: { quote_id: quote.id },
  });
  const stage = lead.stage ?? "new";
  if (stage === "new" || stage === "talking") {
    try {
      await changeLeadStage(lead.id, "quoting", { summary: `Quote ${quote.reference} created` });
    } catch {
      /* a etapa segue a quote na próxima sincronização */
    }
  }
  return quote;
}

// ─── Job do lead ─────────────────────────────────────────────────────────────

/**
 * O job que nasceu deste lead: o já ligado, o de uma quote do lead, ou o
 * criado depois do lead no mesmo ticket do Zendesk.
 */
export async function findJobForLead(lead: Lead): Promise<{ id: string; reference: string } | null> {
  const supabase = getSupabase();
  if (lead.job_id) {
    const { data } = await supabase.from("jobs").select("id, reference").eq("id", lead.job_id).maybeSingle();
    return (data as { id: string; reference: string } | null) ?? { id: lead.job_id, reference: "" };
  }
  const { data: qs } = await supabase.from("quotes").select("id").eq("lead_id", lead.id).is("deleted_at", null);
  const quoteIds = ((qs ?? []) as { id: string }[]).map((q) => q.id);
  if (quoteIds.length) {
    const { data } = await supabase
      .from("jobs")
      .select("id, reference, status")
      .in("quote_id", quoteIds)
      .is("deleted_at", null)
      .not("status", "in", "(cancelled,deleted)")
      .order("created_at", { ascending: false })
      .limit(1);
    const j = (data ?? [])[0] as { id: string; reference: string } | undefined;
    if (j) return j;
  }
  if (lead.external_ref) {
    let q = supabase
      .from("jobs")
      .select("id, reference, status")
      .eq("external_source", lead.external_source ?? "zendesk")
      .eq("external_ref", lead.external_ref)
      .gte("created_at", lead.created_at)
      .is("deleted_at", null)
      .not("status", "in", "(cancelled,deleted)")
      .order("created_at", { ascending: false })
      .limit(1);
    if (lead.client_id) q = q.eq("client_id", lead.client_id);
    const { data } = await q;
    const j = (data ?? [])[0] as { id: string; reference: string } | undefined;
    if (j) return j;
  }
  return null;
}
