import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLinkedLabel } from "@/lib/account-display";
import { isInvoiceOpen } from "@/lib/billing-invoice-list-data";
import { invoiceFinanceListTodayYmd } from "@/lib/invoice-finance-tab";
import type { Invoice } from "@/types/database";

const CHUNK = 100;

export type InvoiceAccountResolutionSource =
  | "invoice_source_account_id"
  | "job_client_source_account_id"
  | "quote_source_account_id"
  | "quote_external_ref_sibling"
  | "ticket_account_id"
  | "service_request_account_id"
  | "property_account_id"
  | "sibling_invoice"
  | "client_email_account"
  | "client_name_heuristic"
  | "job_name_heuristic"
  | "unresolved";

export type InvoiceAccountResolution = {
  invoiceId: string;
  accountId: string | null;
  source: InvoiceAccountResolutionSource;
  previousAccountId: string | null;
};

export type RepairInvoiceRow = Pick<
  Invoice,
  "id" | "source_account_id" | "job_reference" | "client_name" | "status"
>;

type JobRow = {
  id?: string;
  reference?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  quote_id?: string | null;
  property_id?: string | null;
  external_ref?: string | null;
  external_source?: string | null;
};

type ClientRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  source_account_id?: string | null;
};

type QuoteRow = {
  id: string;
  client_id?: string | null;
  property_id?: string | null;
  source_account_id?: string | null;
  request_id?: string | null;
  external_ref?: string | null;
};

type ServiceRequestRow = {
  id: string;
  client_id?: string | null;
  account_id?: string | null;
};

type AccountRow = {
  id: string;
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  zendesk_organization_id?: string | null;
};

type TicketRow = {
  job_id?: string | null;
  account_id?: string | null;
};

export type InvoiceRepairContext = {
  jobByRef: Map<string, JobRow>;
  jobIdToTicketAccount: Map<string, string>;
  clientById: Map<string, ClientRow>;
  quoteById: Map<string, QuoteRow>;
  quoteAccountByExternalRef: Map<string, string>;
  requestById: Map<string, ServiceRequestRow>;
  propertyIdToAccount: Map<string, string>;
  jobRefToAccountFromSiblingInvoice: Map<string, string>;
  accountIdsFromClientEmail: Map<string, string>;
  allLinkedClients: ClientRow[];
  accounts: AccountRow[];
};

export type RepairAccountSummary = {
  id: string;
  label: string;
  logoUrl: string | null;
  count: number;
};

export type InvoiceAccountRepairResult = {
  resolutions: InvoiceAccountResolution[];
  linked: number;
  unlinked: number;
  updated: number;
  byAccount: Record<string, number>;
  clientBackfills: number;
  skippedInvalid: number;
  accounts: RepairAccountSummary[];
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normName(raw?: string | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

function namesLooselyMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function matchNameToAccountCompany(
  name: string | null | undefined,
  accounts: AccountRow[],
): string | null {
  const jn = String(name ?? "").trim();
  if (jn.length < 2) return null;
  const jnLower = jn.toLowerCase();

  let best: { id: string; score: number } | null = null;
  for (const a of accounts) {
    const cn = String(a.company_name ?? "").trim();
    if (cn.length < 3) continue;
    const cnLower = cn.toLowerCase();
    const exact = jnLower === cnLower;
    const contains = jnLower.includes(cnLower) || cnLower.includes(jnLower);
    if (!exact && !contains) continue;
    const score = exact ? 10_000 + cn.length : cn.length;
    if (!best || score > best.score) best = { id: a.id, score };
  }
  return best?.id ?? null;
}

function accountFromClientId(
  cid: string | null | undefined,
  ctx: InvoiceRepairContext,
): string | null {
  if (!cid?.trim()) return null;
  const client = ctx.clientById.get(cid.trim());
  const direct = client?.source_account_id?.trim();
  if (direct) return direct;
  const em = client?.email?.trim().toLowerCase();
  if (em && ctx.accountIdsFromClientEmail.has(em)) return ctx.accountIdsFromClientEmail.get(em)!;
  return null;
}

function accountFromPropertyId(
  pid: string | null | undefined,
  ctx: InvoiceRepairContext,
): string | null {
  if (!pid?.trim()) return null;
  return ctx.propertyIdToAccount.get(pid.trim()) ?? null;
}

function accountFromPersonName(
  name: string | null | undefined,
  ctx: InvoiceRepairContext,
): string | null {
  const jn = String(name ?? "").trim();
  if (!jn) return null;

  for (const c of ctx.allLinkedClients) {
    const aid = c.source_account_id?.trim();
    if (!aid || !c.full_name) continue;
    if (namesLooselyMatch(jn, c.full_name)) return aid;
  }

  return matchNameToAccountCompany(jn, ctx.accounts);
}

function resolveAccountForJob(
  job: JobRow,
  ctx: InvoiceRepairContext,
): { accountId: string | null; source: InvoiceAccountResolutionSource } {
  const ref = job.reference?.trim();
  if (ref) {
    const fromSibling = ctx.jobRefToAccountFromSiblingInvoice.get(ref);
    if (fromSibling) return { accountId: fromSibling, source: "sibling_invoice" };
  }

  const fromClient = accountFromClientId(job.client_id, ctx);
  if (fromClient) return { accountId: fromClient, source: "job_client_source_account_id" };

  const qid = job.quote_id?.trim();
  if (qid) {
    const quote = ctx.quoteById.get(qid);
    const qAcc = quote?.source_account_id?.trim();
    if (qAcc) return { accountId: qAcc, source: "quote_source_account_id" };
    const fromQuoteClient = accountFromClientId(quote?.client_id, ctx);
    if (fromQuoteClient) return { accountId: fromQuoteClient, source: "job_client_source_account_id" };
    const fromQuoteProperty = accountFromPropertyId(quote?.property_id, ctx);
    if (fromQuoteProperty) return { accountId: fromQuoteProperty, source: "property_account_id" };
    const reqId = quote?.request_id?.trim();
    if (reqId) {
      const req = ctx.requestById.get(reqId);
      const reqAcc = req?.account_id?.trim();
      if (reqAcc) return { accountId: reqAcc, source: "service_request_account_id" };
      const fromReqClient = accountFromClientId(req?.client_id, ctx);
      if (fromReqClient) return { accountId: fromReqClient, source: "job_client_source_account_id" };
    }
  }

  const extRef = job.external_ref?.trim();
  if (extRef) {
    const fromQuoteSibling = ctx.quoteAccountByExternalRef.get(extRef);
    if (fromQuoteSibling) return { accountId: fromQuoteSibling, source: "quote_external_ref_sibling" };
  }

  const jid = job.id?.trim();
  if (jid) {
    const fromTicket = ctx.jobIdToTicketAccount.get(jid);
    if (fromTicket) return { accountId: fromTicket, source: "ticket_account_id" };
  }

  const fromJobProperty = accountFromPropertyId(job.property_id, ctx);
  if (fromJobProperty) return { accountId: fromJobProperty, source: "property_account_id" };

  const fromName = accountFromPersonName(job.client_name, ctx);
  if (fromName) return { accountId: fromName, source: "job_name_heuristic" };

  return { accountId: null, source: "unresolved" };
}

/** Pure resolver — used by API and unit tests. */
export function resolveInvoiceAccount(
  inv: RepairInvoiceRow,
  ctx: InvoiceRepairContext,
): InvoiceAccountResolution {
  const previous = inv.source_account_id?.trim() || null;

  const direct = inv.source_account_id?.trim();
  if (direct) {
    return {
      invoiceId: inv.id,
      accountId: direct,
      source: "invoice_source_account_id",
      previousAccountId: previous,
    };
  }

  const ref = inv.job_reference?.trim();
  if (ref) {
    const job = ctx.jobByRef.get(ref);
    if (job) {
      const fromJob = resolveAccountForJob(job, ctx);
      if (fromJob.accountId) {
        return {
          invoiceId: inv.id,
          accountId: fromJob.accountId,
          source: fromJob.source,
          previousAccountId: previous,
        };
      }
    }

    const fromSibling = ctx.jobRefToAccountFromSiblingInvoice.get(ref);
    if (fromSibling) {
      return {
        invoiceId: inv.id,
        accountId: fromSibling,
        source: "sibling_invoice",
        previousAccountId: previous,
      };
    }
  }

  const cn = inv.client_name?.trim();
  if (cn) {
    const fromName = accountFromPersonName(cn, ctx);
    if (fromName) {
      return {
        invoiceId: inv.id,
        accountId: fromName,
        source: "client_name_heuristic",
        previousAccountId: previous,
      };
    }
  }

  return {
    invoiceId: inv.id,
    accountId: null,
    source: "unresolved",
    previousAccountId: previous,
  };
}

export async function loadInvoiceRepairContext(
  supabase: SupabaseClient,
  invoices: RepairInvoiceRow[],
): Promise<InvoiceRepairContext> {
  const refs = [...new Set(invoices.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];

  const jobByRef = new Map<string, JobRow>();
  const jobIds = new Set<string>();
  const clientIds = new Set<string>();
  const quoteIds = new Set<string>();
  const propertyIds = new Set<string>();
  const externalRefs = new Set<string>();

  for (const part of chunk(refs, CHUNK)) {
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, reference, client_id, client_name, quote_id, property_id, external_ref, external_source",
      )
      .in("reference", part)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of (data ?? []) as JobRow[]) {
      const ref = row.reference?.trim();
      if (!ref) continue;
      jobByRef.set(ref, row);
      const jid = row.id?.trim();
      if (jid) jobIds.add(jid);
      const cid = row.client_id?.trim();
      const qid = row.quote_id?.trim();
      const pid = row.property_id?.trim();
      const er = row.external_ref?.trim();
      if (cid) clientIds.add(cid);
      if (qid) quoteIds.add(qid);
      if (pid) propertyIds.add(pid);
      if (er) externalRefs.add(er);
    }
  }

  const [{ data: accountsData }, { data: linkedClientsData }] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, company_name, contact_name, email, zendesk_organization_id")
      .is("deleted_at", null)
      .limit(5000),
    supabase
      .from("clients")
      .select("id, full_name, email, source_account_id")
      .not("source_account_id", "is", null)
      .is("deleted_at", null)
      .limit(8000),
  ]);

  const accounts = (accountsData ?? []) as AccountRow[];
  const allLinkedClients = (linkedClientsData ?? []) as ClientRow[];

  const clientById = new Map<string, ClientRow>();
  for (const ids of chunk([...clientIds], CHUNK)) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, email, source_account_id")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
  }

  const quoteById = new Map<string, QuoteRow>();
  const requestIds = new Set<string>();
  for (const ids of chunk([...quoteIds], CHUNK)) {
    const { data, error } = await supabase
      .from("quotes")
      .select("id, client_id, property_id, source_account_id, request_id, external_ref")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const q of (data ?? []) as QuoteRow[]) {
      quoteById.set(q.id, q);
      const cid = q.client_id?.trim();
      const pid = q.property_id?.trim();
      const rid = q.request_id?.trim();
      const er = q.external_ref?.trim();
      if (cid && !clientById.has(cid)) clientIds.add(cid);
      if (pid) propertyIds.add(pid);
      if (rid) requestIds.add(rid);
      if (er) externalRefs.add(er);
    }
  }

  const quoteAccountByExternalRef = new Map<string, string>();
  const siblingQuoteClientIds = new Set<string>();
  for (const refsPart of chunk([...externalRefs], CHUNK)) {
    if (refsPart.length === 0) continue;
    const { data, error } = await supabase
      .from("quotes")
      .select("external_ref, source_account_id, client_id")
      .in("external_ref", refsPart)
      .is("deleted_at", null);
    if (error) throw error;
    for (const q of (data ?? []) as QuoteRow[]) {
      const er = q.external_ref?.trim();
      if (!er || quoteAccountByExternalRef.has(er)) continue;
      const qAcc = q.source_account_id?.trim();
      if (qAcc) {
        quoteAccountByExternalRef.set(er, qAcc);
        continue;
      }
      const fromClient = q.client_id?.trim();
      if (fromClient) {
        if (!clientById.has(fromClient)) siblingQuoteClientIds.add(fromClient);
        const client = clientById.get(fromClient);
        const cAcc = client?.source_account_id?.trim();
        if (cAcc) quoteAccountByExternalRef.set(er, cAcc);
      }
    }
  }

  if (siblingQuoteClientIds.size > 0) {
    for (const ids of chunk([...siblingQuoteClientIds], CHUNK)) {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, source_account_id")
        .in("id", ids)
        .is("deleted_at", null);
      if (error) throw error;
      for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
    }
    for (const refsPart of chunk([...externalRefs], CHUNK)) {
      if (refsPart.length === 0) continue;
      const { data } = await supabase
        .from("quotes")
        .select("external_ref, source_account_id, client_id")
        .in("external_ref", refsPart)
        .is("deleted_at", null);
      for (const q of (data ?? []) as QuoteRow[]) {
        const er = q.external_ref?.trim();
        if (!er || quoteAccountByExternalRef.has(er)) continue;
        const fromClient = q.client_id?.trim();
        if (!fromClient) continue;
        const cAcc = clientById.get(fromClient)?.source_account_id?.trim();
        if (cAcc) quoteAccountByExternalRef.set(er, cAcc);
      }
    }
  }

  for (const ids of chunk([...clientIds].filter((id) => !clientById.has(id)), CHUNK)) {
    if (ids.length === 0) continue;
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, email, source_account_id")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
  }

  const requestById = new Map<string, ServiceRequestRow>();
  for (const ids of chunk([...requestIds], CHUNK)) {
    const { data, error } = await supabase
      .from("service_requests")
      .select("id, client_id, account_id")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const r of (data ?? []) as ServiceRequestRow[]) {
      requestById.set(r.id, r);
      const cid = r.client_id?.trim();
      if (cid && !clientById.has(cid)) clientIds.add(cid);
    }
  }

  if (clientIds.size > 0) {
    for (const ids of chunk([...clientIds].filter((id) => !clientById.has(id)), CHUNK)) {
      if (ids.length === 0) continue;
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, source_account_id")
        .in("id", ids)
        .is("deleted_at", null);
      if (error) throw error;
      for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
    }
  }

  const propertyIdToAccount = new Map<string, string>();
  for (const ids of chunk([...propertyIds], CHUNK)) {
    const { data, error } = await supabase
      .from("account_properties")
      .select("id, account_id")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { id: string }).id;
      const aid = (row as { account_id?: string }).account_id?.trim();
      if (id && aid) propertyIdToAccount.set(id, aid);
    }
  }

  const jobIdToTicketAccount = new Map<string, string>();
  if (jobIds.size > 0) {
    for (const ids of chunk([...jobIds], CHUNK)) {
      const { data, error } = await supabase
        .from("tickets")
        .select("job_id, account_id")
        .in("job_id", ids);
      if (error) throw error;
      for (const t of (data ?? []) as TicketRow[]) {
        const jid = t.job_id?.trim();
        const aid = t.account_id?.trim();
        if (jid && aid && !jobIdToTicketAccount.has(jid)) jobIdToTicketAccount.set(jid, aid);
      }
    }
  }

  const jobRefToAccountFromSiblingInvoice = new Map<string, string>();
  for (const part of chunk(refs, CHUNK)) {
    const { data, error } = await supabase
      .from("invoices")
      .select("source_account_id, job_reference")
      .in("job_reference", part)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .not("source_account_id", "is", null);
    if (error) throw error;
    for (const inv of (data ?? []) as Array<{ source_account_id?: string | null; job_reference?: string | null }>) {
      const aid = inv.source_account_id?.trim();
      const ref = inv.job_reference?.trim();
      if (ref && aid) jobRefToAccountFromSiblingInvoice.set(ref, aid);
    }
  }

  const accountIdsFromClientEmail = new Map<string, string>();
  const emailsNeedingAccount = new Set<string>();
  for (const c of clientById.values()) {
    if (c.source_account_id?.trim()) continue;
    const em = c.email?.trim().toLowerCase();
    if (em) emailsNeedingAccount.add(em);
  }
  for (const emails of chunk([...emailsNeedingAccount], 50)) {
    const { data } = await supabase
      .from("accounts")
      .select("id, email")
      .in("email", emails)
      .is("deleted_at", null);
    for (const a of data ?? []) {
      const em = String((a as { email?: string }).email ?? "").trim().toLowerCase();
      const id = (a as { id: string }).id;
      if (em && id) accountIdsFromClientEmail.set(em, id);
    }
  }

  return {
    jobByRef,
    jobIdToTicketAccount,
    clientById,
    quoteById,
    quoteAccountByExternalRef,
    requestById,
    propertyIdToAccount,
    jobRefToAccountFromSiblingInvoice,
    accountIdsFromClientEmail,
    allLinkedClients,
    accounts,
  };
}

async function loadValidAccountIds(
  supabase: SupabaseClient,
  accountIds: string[],
): Promise<Set<string>> {
  const valid = new Set<string>();
  const unique = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
  for (const part of chunk(unique, CHUNK)) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .in("id", part)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { id?: string }).id?.trim();
      if (id) valid.add(id);
    }
  }
  return valid;
}

export async function fetchRepairAccountSummaries(
  supabase: SupabaseClient,
  byAccount: Record<string, number>,
): Promise<RepairAccountSummary[]> {
  const ids = Object.keys(byAccount).filter(Boolean);
  if (ids.length === 0) return [];

  const rows: RepairAccountSummary[] = [];
  for (const part of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, company_name, contact_name, email, logo_url")
      .in("id", part)
      .is("deleted_at", null);
    if (error) throw error;
    for (const a of data ?? []) {
      const row = a as {
        id: string;
        company_name?: string | null;
        contact_name?: string | null;
        email?: string | null;
        logo_url?: string | null;
      };
      rows.push({
        id: row.id,
        label: accountLinkedLabel(row) || "Unknown account",
        logoUrl: row.logo_url?.trim() || null,
        count: byAccount[row.id] ?? 0,
      });
    }
  }

  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function repairInvoiceAccounts(
  supabase: SupabaseClient,
  options: {
    invoices: RepairInvoiceRow[];
    persist?: boolean;
    backfillClients?: boolean;
  },
): Promise<InvoiceAccountRepairResult> {
  const ctx = await loadInvoiceRepairContext(supabase, options.invoices);
  const resolutions = options.invoices.map((inv) => resolveInvoiceAccount(inv, ctx));

  const candidateAccountIds = [
    ...new Set(resolutions.map((r) => r.accountId?.trim()).filter(Boolean)),
  ] as string[];
  const validAccountIds = await loadValidAccountIds(supabase, candidateAccountIds);

  let linked = 0;
  let unlinked = 0;
  let skippedInvalid = 0;
  const byAccount: Record<string, number> = {};
  const toUpdate: Array<{ id: string; accountId: string }> = [];

  for (const r of resolutions) {
    const aid = r.accountId?.trim() || null;
    if (!aid) {
      unlinked += 1;
      continue;
    }
    if (!validAccountIds.has(aid)) {
      unlinked += 1;
      skippedInvalid += 1;
      continue;
    }
    linked += 1;
    byAccount[aid] = (byAccount[aid] ?? 0) + 1;
    if (aid !== r.previousAccountId) {
      toUpdate.push({ id: r.invoiceId, accountId: aid });
    }
  }

  let updated = 0;
  if (options.persist !== false && toUpdate.length > 0) {
    for (const part of chunk(toUpdate, 50)) {
      await Promise.all(
        part.map((row) =>
          supabase.from("invoices").update({ source_account_id: row.accountId }).eq("id", row.id),
        ),
      );
      updated += part.length;
    }
  }

  let clientBackfills = 0;
  if (options.backfillClients !== false && options.persist !== false) {
    const clientUpdates = new Map<string, string>();
    for (const inv of options.invoices) {
      const ref = inv.job_reference?.trim();
      if (!ref) continue;
      const job = ctx.jobByRef.get(ref);
      const cid = job?.client_id?.trim();
      if (!cid) continue;
      const client = ctx.clientById.get(cid);
      if (client?.source_account_id?.trim()) continue;
      const resolution = resolutions.find((r) => r.invoiceId === inv.id);
      const aid = resolution?.accountId?.trim();
      if (!aid || !validAccountIds.has(aid)) continue;
      if (!clientUpdates.has(cid)) clientUpdates.set(cid, aid);
    }
    for (const [clientId, accountId] of clientUpdates) {
      const { error } = await supabase
        .from("clients")
        .update({ source_account_id: accountId })
        .eq("id", clientId)
        .is("source_account_id", null);
      if (!error) clientBackfills += 1;
    }
  }

  const accounts = await fetchRepairAccountSummaries(supabase, byAccount);

  return {
    resolutions,
    linked,
    unlinked,
    updated,
    byAccount,
    clientBackfills,
    skippedInvalid,
    accounts,
  };
}

export async function fetchOpenReceivableInvoices(
  supabase: SupabaseClient,
  invoiceIds?: string[],
): Promise<RepairInvoiceRow[]> {
  const todayYmd = invoiceFinanceListTodayYmd();
  const acc: RepairInvoiceRow[] = [];

  if (invoiceIds?.length) {
    for (const part of chunk(invoiceIds, CHUNK)) {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, source_account_id, job_reference, client_name, status")
        .in("id", part)
        .is("deleted_at", null);
      if (error) throw error;
      for (const row of (data ?? []) as RepairInvoiceRow[]) {
        if (isInvoiceOpen(row as Invoice, todayYmd)) acc.push(row);
      }
    }
    return acc;
  }

  const chunkSize = 500;
  for (let from = 0; from < 50_000; from += chunkSize) {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, source_account_id, job_reference, client_name, status")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + chunkSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as RepairInvoiceRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (isInvoiceOpen(row as Invoice, todayYmd)) acc.push(row);
    }
    if (rows.length < chunkSize) break;
  }
  return acc;
}
