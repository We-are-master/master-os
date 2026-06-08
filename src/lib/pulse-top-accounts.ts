import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardDateBounds } from "@/lib/dashboard-date-range";
import { jobBillableRevenue } from "@/lib/job-financials";
import { isPostgrestSelectSchemaError } from "@/lib/postgrest-errors";

export type PulseTopAccountRow = {
  rowId: string;
  name: string;
  ownerName: string | null;
  isAccount: boolean;
  jobs: number;
  billed: number;
};

type JobRow = {
  id: string;
  reference?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  quote_id?: string | null;
  property_id?: string | null;
  client_price?: number | null;
  extras_amount?: number | null;
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
};

type InvoiceRow = {
  source_account_id?: string | null;
  job_reference?: string | null;
};

type AccountRow = {
  id: string;
  company_name?: string | null;
  contact_name?: string | null;
  account_owner_id?: string | null;
};

type RpcPulseTopPayload = {
  accounts?: Array<{
    account_id: string;
    company_name: string;
    account_owner_id?: string | null;
    jobs: number;
    billed: number;
  }>;
  direct?: { jobs: number; billed: number };
};

function normName(raw?: string | null): string {
  return String(raw ?? "").trim().toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Same rule as `get_jobs_for_account` RPC: client_name ILIKE %company_name%. */
function matchJobClientNameToAccount(
  jobClientName: string | null | undefined,
  accounts: AccountRow[],
): string | null {
  const jn = String(jobClientName ?? "").trim();
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

function namesLooselyMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

async function fetchViaRpc(
  supabase: SupabaseClient,
  bounds: DashboardDateBounds | null,
  limit: number,
): Promise<PulseTopAccountRow[] | null> {
  const { data, error } = await supabase.rpc("get_pulse_top_accounts", {
    p_from: bounds?.fromIso ?? null,
    p_to: bounds?.toIso ?? null,
    p_limit: limit,
  });
  if (error) return null;

  const payload = data as RpcPulseTopPayload | null;
  if (!payload) return null;

  const ownerIds = new Set<string>();
  for (const row of payload.accounts ?? []) {
    const oid = row.account_owner_id?.trim();
    if (oid) ownerIds.add(oid);
  }

  const ownerNames = new Map<string, string>();
  if (ownerIds.size > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...ownerIds]);
    for (const p of profs ?? []) {
      const id = (p as { id: string }).id;
      const nm =
        String((p as { full_name?: string }).full_name ?? "").trim() ||
        String((p as { email?: string }).email ?? "").trim() ||
        "User";
      ownerNames.set(id, nm);
    }
  }

  const rows: PulseTopAccountRow[] = (payload.accounts ?? []).map((r) => ({
    rowId: `acc:${r.account_id}`,
    name: r.company_name?.trim() || "Account",
    ownerName: r.account_owner_id ? ownerNames.get(r.account_owner_id.trim()) ?? null : null,
    isAccount: true,
    jobs: Number(r.jobs) || 0,
    billed: Number(r.billed) || 0,
  }));

  const direct = payload.direct;
  if (direct && Number(direct.billed) > 0) {
    rows.push({
      rowId: "__direct__",
      name: "Direct (No Account)",
      ownerName: null,
      isAccount: false,
      jobs: Number(direct.jobs) || 0,
      billed: Number(direct.billed) || 0,
    });
  }

  const accountsOnly = rows.filter((r) => r.isAccount);
  if (accountsOnly.length > 0) return accountsOnly.slice(0, limit);
  return rows.slice(0, limit);
}

async function loadAccountsForPulseTop(supabase: SupabaseClient): Promise<AccountRow[]> {
  const full = await supabase
    .from("accounts")
    .select("id, company_name, contact_name, account_owner_id")
    .is("deleted_at", null)
    .limit(5000);
  if (!full.error) return (full.data ?? []) as AccountRow[];

  if (isPostgrestSelectSchemaError(full.error)) {
    const slim = await supabase
      .from("accounts")
      .select("id, company_name, contact_name")
      .is("deleted_at", null)
      .limit(5000);
    if (!slim.error) return (slim.data ?? []) as AccountRow[];
  }

  throw full.error;
}

async function fetchViaClientJoin(
  supabase: SupabaseClient,
  bounds: DashboardDateBounds | null,
  limit: number,
): Promise<PulseTopAccountRow[]> {
  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, reference, client_id, client_name, quote_id, property_id, client_price, extras_amount, scheduled_start_at",
    )
    .is("deleted_at", null)
    .neq("status", "cancelled");

  if (bounds) {
    jobsQuery = jobsQuery
      .gte("scheduled_start_at", bounds.fromIso)
      .lte("scheduled_start_at", bounds.toIso);
  }

  const [{ data: jobsData, error: jobsErr }, accounts] = await Promise.all([
    jobsQuery.limit(5000),
    loadAccountsForPulseTop(supabase),
  ]);
  if (jobsErr) throw jobsErr;

  const jobs = (jobsData ?? []) as JobRow[];
  if (jobs.length === 0) return [];

  const accountMeta = new Map<string, AccountRow>();
  for (const a of accounts) accountMeta.set(a.id, a);

  const clientIds = [...new Set(jobs.map((j) => j.client_id?.trim()).filter(Boolean))] as string[];
  const quoteIds = [...new Set(jobs.map((j) => j.quote_id?.trim()).filter(Boolean))] as string[];
  const propertyIds = [...new Set(jobs.map((j) => j.property_id?.trim()).filter(Boolean))] as string[];
  const jobRefs = [...new Set(jobs.map((j) => j.reference?.trim()).filter(Boolean))] as string[];

  const clientById = new Map<string, ClientRow>();
  for (const ids of chunk(clientIds, 200)) {
    const { data } = await supabase
      .from("clients")
      .select("id, full_name, email, source_account_id")
      .in("id", ids)
      .is("deleted_at", null);
    for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
  }

  const { data: allLinkedClients } = await supabase
    .from("clients")
    .select("id, full_name, email, source_account_id")
    .not("source_account_id", "is", null)
    .is("deleted_at", null)
    .limit(8000);

  const quoteById = new Map<string, QuoteRow>();
  for (const ids of chunk(quoteIds, 200)) {
    const { data } = await supabase
      .from("quotes")
      .select("id, client_id, property_id, source_account_id")
      .in("id", ids)
      .is("deleted_at", null);
    for (const q of (data ?? []) as QuoteRow[]) quoteById.set(q.id, q);
  }

  const extraClientIds = new Set<string>();
  const extraPropertyIds = new Set<string>();
  for (const q of quoteById.values()) {
    const cid = q.client_id?.trim();
    if (cid && !clientById.has(cid)) extraClientIds.add(cid);
    const pid = q.property_id?.trim();
    if (pid && !propertyIds.includes(pid)) extraPropertyIds.add(pid);
  }
  for (const ids of chunk([...extraClientIds], 200)) {
    const { data } = await supabase
      .from("clients")
      .select("id, full_name, email, source_account_id")
      .in("id", ids)
      .is("deleted_at", null);
    for (const c of (data ?? []) as ClientRow[]) clientById.set(c.id, c);
  }

  const propertyIdToAccount = new Map<string, string>();
  const allPropertyIds = [...new Set([...propertyIds, ...extraPropertyIds])];
  for (const ids of chunk(allPropertyIds, 200)) {
    const { data } = await supabase
      .from("account_properties")
      .select("id, account_id")
      .in("id", ids)
      .is("deleted_at", null);
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
  if (emailsNeedingAccount.size > 0) {
    for (const emails of chunk([...emailsNeedingAccount], 50)) {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, email")
        .in("email", emails)
        .is("deleted_at", null);
      for (const a of accs ?? []) {
        const em = String((a as { email?: string }).email ?? "").trim().toLowerCase();
        const id = (a as { id: string }).id;
        if (em && id) accountIdsFromEmail.set(em, id);
      }
    }
  }

  const refToAccount = new Map<string, string>();
  for (const job of jobs) {
    const ref = job.reference?.trim();
    const cid = job.client_id?.trim();
    if (!ref || !cid) continue;
    const direct = clientById.get(cid)?.source_account_id?.trim();
    if (direct) refToAccount.set(ref, direct);
  }

  if (jobRefs.length > 0) {
    for (const refs of chunk(jobRefs, 100)) {
      const { data: invRows } = await supabase
        .from("invoices")
        .select("source_account_id, job_reference")
        .in("job_reference", refs)
        .is("deleted_at", null)
        .neq("status", "cancelled");
      for (const inv of (invRows ?? []) as InvoiceRow[]) {
        const aid = inv.source_account_id?.trim();
        const ref = inv.job_reference?.trim();
        if (ref && aid) refToAccount.set(ref, aid);
      }
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

  function accountFromClientName(jobName: string | null | undefined): string | null {
    const jn = String(jobName ?? "").trim();
    if (!jn) return null;

    for (const c of (allLinkedClients ?? []) as ClientRow[]) {
      const aid = c.source_account_id?.trim();
      if (!aid || !c.full_name) continue;
      if (namesLooselyMatch(jn, c.full_name)) return aid;
    }

    return matchJobClientNameToAccount(jn, accounts);
  }

  function resolveAccountForJob(job: JobRow): string | null {
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
    }

    const fromJobProperty = accountFromPropertyId(job.property_id);
    if (fromJobProperty) return fromJobProperty;

    const ref = job.reference?.trim();
    if (ref && refToAccount.has(ref)) return refToAccount.get(ref)!;

    return accountFromClientName(job.client_name);
  }

  const byAccount = new Map<string, { jobs: number; billed: number }>();
  let directJobs = 0;
  let directBilled = 0;

  for (const job of jobs) {
    const billed = jobBillableRevenue({
      client_price: Number(job.client_price ?? 0),
      extras_amount: Number(job.extras_amount ?? 0),
    });
    const aid = resolveAccountForJob(job);
    if (aid && accountMeta.has(aid)) {
      const cur = byAccount.get(aid) ?? { jobs: 0, billed: 0 };
      cur.jobs += 1;
      cur.billed += billed;
      byAccount.set(aid, cur);
    } else {
      directJobs += 1;
      directBilled += billed;
    }
  }

  const ownerIds = new Set<string>();
  for (const aid of byAccount.keys()) {
    const oid = accountMeta.get(aid)?.account_owner_id?.trim();
    if (oid) ownerIds.add(oid);
  }
  const ownerNames = new Map<string, string>();
  if (ownerIds.size > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...ownerIds]);
    for (const p of profs ?? []) {
      const id = (p as { id: string }).id;
      const nm =
        String((p as { full_name?: string }).full_name ?? "").trim() ||
        String((p as { email?: string }).email ?? "").trim() ||
        "User";
      ownerNames.set(id, nm);
    }
  }

  const rows: PulseTopAccountRow[] = [...byAccount.entries()]
    .map(([aid, totals]) => {
      const meta = accountMeta.get(aid)!;
      const ownerId = meta.account_owner_id?.trim() || null;
      return {
        rowId: `acc:${aid}`,
        name: meta.company_name?.trim() || "Account",
        ownerName: ownerId ? ownerNames.get(ownerId) ?? null : null,
        isAccount: true,
        jobs: totals.jobs,
        billed: totals.billed,
      };
    })
    .sort((a, b) => b.billed - a.billed);

  if (directBilled > 0) {
    rows.push({
      rowId: "__direct__",
      name: "Direct (No Account)",
      ownerName: null,
      isAccount: false,
      jobs: directJobs,
      billed: directBilled,
    });
  }

  const accountsOnly = rows.filter((r) => r.isAccount);
  if (accountsOnly.length > 0) return accountsOnly.slice(0, limit);
  return rows.slice(0, limit);
}

/**
 * Pulse “Top Accounts” — billed value in the dashboard period, grouped by corporate account.
 * Prefers Postgres RPC (migration 198); falls back to client-side joins + name matching.
 */
export async function fetchPulseTopAccounts(
  supabase: SupabaseClient,
  bounds: DashboardDateBounds | null,
  limit = 5,
): Promise<PulseTopAccountRow[]> {
  const [fromRpc, fromClient] = await Promise.all([
    fetchViaRpc(supabase, bounds, limit),
    fetchViaClientJoin(supabase, bounds, limit),
  ]);

  const rpcAccounts = fromRpc?.filter((r) => r.isAccount) ?? [];
  const clientAccounts = fromClient.filter((r) => r.isAccount);

  if (clientAccounts.length > 0) return clientAccounts.slice(0, limit);
  if (rpcAccounts.length > 0) return rpcAccounts.slice(0, limit);

  return fromClient.length > 0 ? fromClient.slice(0, limit) : (fromRpc ?? []);
}
