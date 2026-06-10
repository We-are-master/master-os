import { getSupabase } from "@/services/base";
import type { Invoice } from "@/types/database";

const CHUNK = 100;

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

/** Same rule as `get_jobs_for_account` RPC: client_name ILIKE %company_name%. */
function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function fetchScopedAccountsAndLinkedClients(
  supabase: ReturnType<typeof getSupabase>,
  invoices: Pick<Invoice, "source_account_id" | "client_name">[],
  jobRows: JobRow[],
): Promise<{ accounts: AccountRow[]; linkedClientsForNames: ClientRow[] }> {
  const accountById = new Map<string, AccountRow>();
  const linkedById = new Map<string, ClientRow>();
  const linkedClientsForNames: ClientRow[] = [];

  const directAccountIds = [
    ...new Set(invoices.map((i) => i.source_account_id?.trim()).filter(Boolean)),
  ] as string[];
  for (const ids of chunk(directAccountIds, CHUNK)) {
    if (ids.length === 0) continue;
    const { data, error } = await supabase
      .from("accounts")
      .select("id, company_name, contact_name, email")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw error;
    for (const a of (data ?? []) as AccountRow[]) accountById.set(a.id, a);
  }

  const namesForHeuristic = new Set<string>();
  for (const inv of invoices) {
    const n = inv.client_name?.trim();
    if (n && n.length >= 2) namesForHeuristic.add(n);
  }
  for (const job of jobRows) {
    const n = job.client_name?.trim();
    if (n && n.length >= 2) namesForHeuristic.add(n);
  }

  const nameList = [...namesForHeuristic];
  const NAME_QUERY_BATCH = 12;
  for (let i = 0; i < nameList.length; i += NAME_QUERY_BATCH) {
    const batch = nameList.slice(i, i + NAME_QUERY_BATCH);
    await Promise.all(
      batch.map(async (name) => {
        const pattern = `%${escapeIlike(name)}%`;
        const [{ data: accts, error: acctErr }, { data: clients, error: clientErr }] = await Promise.all([
          supabase
            .from("accounts")
            .select("id, company_name, contact_name, email")
            .is("deleted_at", null)
            .or(`company_name.ilike."${pattern}",contact_name.ilike."${pattern}"`)
            .limit(5),
          supabase
            .from("clients")
            .select("id, full_name, email, source_account_id")
            .not("source_account_id", "is", null)
            .is("deleted_at", null)
            .ilike("full_name", pattern)
            .limit(5),
        ]);
        if (acctErr) throw acctErr;
        if (clientErr) throw clientErr;
        for (const a of (accts ?? []) as AccountRow[]) accountById.set(a.id, a);
        for (const c of (clients ?? []) as ClientRow[]) {
          if (linkedById.has(c.id)) continue;
          linkedById.set(c.id, c);
          linkedClientsForNames.push(c);
        }
      }),
    );
  }

  return { accounts: [...accountById.values()], linkedClientsForNames };
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

export type InvoiceAccountMaps = {
  jobRefToAccountId: Record<string, string>;
  clientNameToAccountId: Record<string, string>;
};

/**
 * Resolves invoice → account using the same paths as Pulse / portal:
 * invoice.source_account_id, job → client / quote / property, sibling invoices, name heuristics.
 */
export async function buildInvoiceAccountMaps(
  invoices: Pick<Invoice, "source_account_id" | "job_reference" | "client_name">[],
): Promise<InvoiceAccountMaps> {
  const jobRefToAccountId: Record<string, string> = {};
  const clientNameToAccountId: Record<string, string> = {};

  const refs = [...new Set(invoices.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];
  const invoiceNames = [...new Set(invoices.map((i) => i.client_name?.trim()).filter(Boolean))] as string[];

  for (const inv of invoices) {
    const direct = inv.source_account_id?.trim();
    const ref = inv.job_reference?.trim();
    if (direct && ref) jobRefToAccountId[ref] = direct;
  }

  if (refs.length === 0 && invoiceNames.length === 0) {
    return { jobRefToAccountId, clientNameToAccountId };
  }

  const supabase = getSupabase();

  const jobRows: JobRow[] = [];
  const jobIds = new Set<string>();
  const externalRefs = new Set<string>();
  for (const part of chunk(refs, CHUNK)) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, reference, client_id, client_name, quote_id, property_id, external_ref, external_source")
      .in("reference", part)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of (data ?? []) as JobRow[]) {
      jobRows.push(row);
      const jid = row.id?.trim();
      const er = row.external_ref?.trim();
      if (jid) jobIds.add(jid);
      if (er) externalRefs.add(er);
    }
  }

  const { accounts, linkedClientsForNames } = await fetchScopedAccountsAndLinkedClients(
    supabase,
    invoices,
    jobRows,
  );

  const clientIds = new Set<string>();
  const quoteIds = new Set<string>();
  const propertyIds = new Set<string>();

  for (const job of jobRows) {
    const cid = job.client_id?.trim();
    const qid = job.quote_id?.trim();
    const pid = job.property_id?.trim();
    if (cid) clientIds.add(cid);
    if (qid) quoteIds.add(qid);
    if (pid) propertyIds.add(pid);
  }

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
  const quoteAccountByExternalRef = new Map<string, string>();
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
        const cAcc = clientById.get(fromClient)?.source_account_id?.trim();
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
        .select("external_ref, client_id")
        .in("external_ref", refsPart)
        .is("deleted_at", null);
      for (const q of (data ?? []) as QuoteRow[]) {
        const er = q.external_ref?.trim();
        if (!er || quoteAccountByExternalRef.has(er)) continue;
        const cAcc = clientById.get(q.client_id?.trim() ?? "")?.source_account_id?.trim();
        if (cAcc) quoteAccountByExternalRef.set(er, cAcc);
      }
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
      for (const t of data ?? []) {
        const jid = (t as { job_id?: string }).job_id?.trim();
        const aid = (t as { account_id?: string }).account_id?.trim();
        if (jid && aid && !jobIdToTicketAccount.has(jid)) jobIdToTicketAccount.set(jid, aid);
      }
    }
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

  const accountIdsFromEmail = new Map<string, string>();
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
      if (em && id) accountIdsFromEmail.set(em, id);
    }
  }

  for (const part of chunk(refs, CHUNK)) {
    const { data } = await supabase
      .from("invoices")
      .select("source_account_id, job_reference")
      .in("job_reference", part)
      .is("deleted_at", null)
      .neq("status", "cancelled");
    for (const inv of (data ?? []) as Array<{ source_account_id?: string | null; job_reference?: string | null }>) {
      const aid = inv.source_account_id?.trim();
      const ref = inv.job_reference?.trim();
      if (ref && aid) jobRefToAccountId[ref] = aid;
    }
  }

  function accountFromClientId(cid: string | null | undefined): string | null {
    if (!cid?.trim()) return null;
    const client = clientById.get(cid.trim());
    const direct = client?.source_account_id?.trim();
    if (direct) return direct;
    const em = client?.email?.trim().toLowerCase();
    if (em && accountIdsFromEmail.has(em)) return accountIdsFromEmail.get(em)!;
    return null;
  }

  function accountFromPropertyId(pid: string | null | undefined): string | null {
    if (!pid?.trim()) return null;
    return propertyIdToAccount.get(pid.trim()) ?? null;
  }

  function accountFromPersonName(name: string | null | undefined): string | null {
    const jn = String(name ?? "").trim();
    if (!jn) return null;

    for (const c of linkedClientsForNames) {
      const aid = c.source_account_id?.trim();
      if (!aid || !c.full_name) continue;
      if (namesLooselyMatch(jn, c.full_name)) return aid;
    }
    for (const c of clientById.values()) {
      const aid = c.source_account_id?.trim();
      if (!aid || !c.full_name) continue;
      if (namesLooselyMatch(jn, c.full_name)) return aid;
    }

    return matchNameToAccountCompany(jn, accounts);
  }

  function resolveAccountForJob(job: JobRow): string | null {
    const ref = job.reference?.trim();
    if (ref && jobRefToAccountId[ref]) return jobRefToAccountId[ref];

    const fromClient = accountFromClientId(job.client_id);
    if (fromClient) return fromClient;

    const qid = job.quote_id?.trim();
    if (qid) {
      const quote = quoteById.get(qid);
      const qAcc = quote?.source_account_id?.trim();
      if (qAcc) return qAcc;
      const fromQuoteClient = accountFromClientId(quote?.client_id);
      if (fromQuoteClient) return fromQuoteClient;
      const fromQuoteProperty = accountFromPropertyId(quote?.property_id);
      if (fromQuoteProperty) return fromQuoteProperty;
      const reqId = quote?.request_id?.trim();
      if (reqId) {
        const req = requestById.get(reqId);
        const reqAcc = req?.account_id?.trim();
        if (reqAcc) return reqAcc;
        const fromReqClient = accountFromClientId(req?.client_id);
        if (fromReqClient) return fromReqClient;
      }
    }

    const extRef = job.external_ref?.trim();
    if (extRef) {
      const fromQuoteSibling = quoteAccountByExternalRef.get(extRef);
      if (fromQuoteSibling) return fromQuoteSibling;
    }

    const jid = job.id?.trim();
    if (jid) {
      const fromTicket = jobIdToTicketAccount.get(jid);
      if (fromTicket) return fromTicket;
    }

    const fromJobProperty = accountFromPropertyId(job.property_id);
    if (fromJobProperty) return fromJobProperty;

    return accountFromPersonName(job.client_name);
  }

  for (const job of jobRows) {
    const ref = job.reference?.trim();
    if (!ref) continue;
    const aid = resolveAccountForJob(job);
    if (aid) jobRefToAccountId[ref] = aid;
  }

  for (const inv of invoices) {
    const name = inv.client_name?.trim();
    if (!name || clientNameToAccountId[name]) continue;
    const ref = inv.job_reference?.trim();
    if (ref && jobRefToAccountId[ref]) {
      clientNameToAccountId[name] = jobRefToAccountId[ref];
      continue;
    }
    const fromName = accountFromPersonName(name);
    if (fromName) clientNameToAccountId[name] = fromName;
  }

  for (const part of chunk(invoiceNames, CHUNK)) {
    const { data, error } = await supabase
      .from("clients")
      .select("full_name, source_account_id")
      .in("full_name", part)
      .is("deleted_at", null);
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as { full_name?: string | null; source_account_id?: string | null };
      const fn = r.full_name?.trim();
      const aid = r.source_account_id?.trim();
      if (fn && aid) clientNameToAccountId[fn] = aid;
    }
  }

  return { jobRefToAccountId, clientNameToAccountId };
}
