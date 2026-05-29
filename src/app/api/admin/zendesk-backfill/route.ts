import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isZendeskConfigured } from "@/lib/zendesk";
import { syncPartnerToZendesk } from "@/lib/zendesk-partner-sync";
import { syncAccountToZendesk } from "@/lib/zendesk-account-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL     = process.env.ZENDESK_EMAIL?.trim();
const API_TOKEN = process.env.ZENDESK_API_TOKEN?.trim();

function authHeader(): string {
  return "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
}
function zdBase(): string {
  return `https://${SUBDOMAIN}.zendesk.com/api/v2`;
}

/** Strip leading emoji + extra whitespace so we can name-match across Zendesk and the OS. */
function cleanName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/^[\p{Extended_Pictographic}\u{FE0F}\s]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface ZendeskOrg {
  id:           number;
  name:         string;
  external_id:  string | null;
}

async function fetchAllZendeskOrgs(): Promise<ZendeskOrg[]> {
  const out: ZendeskOrg[] = [];
  let nextUrl: string | null = `${zdBase()}/organizations.json?per_page=100`;
  while (nextUrl) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Zendesk orgs fetch failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const j: { organizations?: ZendeskOrg[]; next_page?: string | null } = await res.json();
    out.push(...(j.organizations ?? []));
    nextUrl = j.next_page ?? null;
  }
  return out;
}

/** PUT a Zendesk org with the OS dedup key + custom fields, preserving any existing data. */
async function attachOsLinkToZendeskOrg(
  zdOrgId: number,
  kind: "partner" | "account",
  entityId: string,
  cleanedDisplayName: string,
): Promise<{ ok: boolean; error?: string }> {
  const emoji = kind === "partner" ? "🔧" : "🏢";
  const body = {
    organization: {
      name:        `${emoji} ${cleanedDisplayName}`,
      external_id: `fixfy:${kind}:${entityId}`,
      organization_fields: {
        org_id:  entityId,
        os_type: kind,
      },
    },
  };
  const res = await fetch(`${zdBase()}/organizations/${zdOrgId}.json`, {
    method:  "PUT",
    headers: {
      Authorization: authHeader(),
      Accept:        "application/json",
      "Content-Type":"application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { ok: true };
}

interface BackfillReport {
  scanned:   { partners: number; accounts: number; zendeskOrgs: number };
  matched:   { partners: Array<{ id: string; name: string; zdOrgId: number }>; accounts: Array<{ id: string; name: string; zdOrgId: number }> };
  created:   { partners: Array<{ id: string; name: string; zdOrgId?: string }>; accounts: Array<{ id: string; name: string; zdOrgId?: string }> };
  skipped:   { partners: Array<{ id: string; reason: string }>; accounts: Array<{ id: string; reason: string }> };
  failed:    { partners: Array<{ id: string; error: string }>; accounts: Array<{ id: string; error: string }> };
  dryRun:    boolean;
}

/**
 * POST /api/admin/zendesk-backfill
 *
 * Walks every partner + account in the OS and links / mirrors them into
 * Zendesk Organisations. For each entity:
 *   - If a Zendesk org with the matching clean name already exists → PUT
 *     the OS dedup keys (external_id + org_id + os_type custom fields) and
 *     the canonical emoji-prefixed name. Persist the Zendesk org id back
 *     to the OS row.
 *   - Else → call sync* which creates new (org + user) and stores ids.
 *
 * Idempotent. Safe to re-run. Use `dryRun: true` for a no-write preview.
 *
 * Body: { dryRun?: boolean; kind?: "partner" | "account" | "all" }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSb = await createServerSupabase();
  const { data: profile } = await serverSb
    .from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: "Zendesk not configured" }, { status: 503 });
  }

  let body: { dryRun?: boolean; kind?: string } = {};
  try { body = (await req.json()) as { dryRun?: boolean; kind?: string }; }
  catch { /* empty body OK */ }
  const dryRun = body.dryRun === true;
  const kindFilter = (body.kind ?? "all").toLowerCase();
  const doPartners = kindFilter === "all" || kindFilter === "partner";
  const doAccounts = kindFilter === "all" || kindFilter === "account";

  const sb = createServiceClient();

  // ─── Build name → zendesk org id map ─────────────────────────────────
  const zdOrgs = await fetchAllZendeskOrgs();
  const nameIndex = new Map<string, ZendeskOrg>();
  for (const o of zdOrgs) {
    const k = cleanName(o.name);
    if (k) nameIndex.set(k, o);
  }

  const report: BackfillReport = {
    scanned: { partners: 0, accounts: 0, zendeskOrgs: zdOrgs.length },
    matched: { partners: [], accounts: [] },
    created: { partners: [], accounts: [] },
    skipped: { partners: [], accounts: [] },
    failed:  { partners: [], accounts: [] },
    dryRun,
  };

  // ─── Partners ────────────────────────────────────────────────────────
  if (doPartners) {
    const { data: partners } = await sb
      .from("partners")
      .select("id, company_name, contact_name, email, zendesk_organization_id");
    const rows = (partners ?? []) as Array<{
      id: string;
      company_name: string | null;
      contact_name: string | null;
      email: string | null;
      zendesk_organization_id: string | null;
    }>;
    report.scanned.partners = rows.length;

    for (const p of rows) {
      if (p.zendesk_organization_id) {
        report.skipped.partners.push({ id: p.id, reason: "already_linked" });
        continue;
      }
      const display = (p.company_name?.trim() || p.contact_name?.trim() || p.email?.split("@")[0]) ?? "";
      const key = cleanName(display);
      if (!key) {
        report.skipped.partners.push({ id: p.id, reason: "no_name" });
        continue;
      }

      const matched = nameIndex.get(key);
      if (matched) {
        if (!dryRun) {
          const r = await attachOsLinkToZendeskOrg(matched.id, "partner", p.id, display);
          if (!r.ok) { report.failed.partners.push({ id: p.id, error: r.error ?? "unknown" }); continue; }
          await sb.from("partners")
            .update({ zendesk_organization_id: String(matched.id) })
            .eq("id", p.id);
        }
        report.matched.partners.push({ id: p.id, name: display, zdOrgId: matched.id });
      } else {
        if (!dryRun) {
          const r = await syncPartnerToZendesk(p.id);
          if (!r.ok && !r.skipped) { report.failed.partners.push({ id: p.id, error: r.error ?? "unknown" }); continue; }
          if (r.skipped) { report.skipped.partners.push({ id: p.id, reason: r.skipped }); continue; }
          report.created.partners.push({ id: p.id, name: display, zdOrgId: r.organizationId ?? undefined });
        } else {
          report.created.partners.push({ id: p.id, name: display });
        }
      }
    }
  }

  // ─── Accounts ────────────────────────────────────────────────────────
  if (doAccounts) {
    const { data: accounts } = await sb
      .from("accounts")
      .select("id, company_name, contact_name, email, zendesk_organization_id")
      .is("deleted_at", null);
    const rows = (accounts ?? []) as Array<{
      id: string;
      company_name: string | null;
      contact_name: string | null;
      email: string | null;
      zendesk_organization_id: string | null;
    }>;
    report.scanned.accounts = rows.length;

    for (const a of rows) {
      if (a.zendesk_organization_id) {
        report.skipped.accounts.push({ id: a.id, reason: "already_linked" });
        continue;
      }
      const display = (a.company_name?.trim() || a.contact_name?.trim() || a.email?.split("@")[0]) ?? "";
      const key = cleanName(display);
      if (!key) {
        report.skipped.accounts.push({ id: a.id, reason: "no_name" });
        continue;
      }

      const matched = nameIndex.get(key);
      if (matched) {
        if (!dryRun) {
          const r = await attachOsLinkToZendeskOrg(matched.id, "account", a.id, display);
          if (!r.ok) { report.failed.accounts.push({ id: a.id, error: r.error ?? "unknown" }); continue; }
          await sb.from("accounts")
            .update({ zendesk_organization_id: String(matched.id) })
            .eq("id", a.id);
        }
        report.matched.accounts.push({ id: a.id, name: display, zdOrgId: matched.id });
      } else {
        if (!dryRun) {
          const r = await syncAccountToZendesk(a.id);
          if (!r.ok && !r.skipped) { report.failed.accounts.push({ id: a.id, error: r.error ?? "unknown" }); continue; }
          if (r.skipped) { report.skipped.accounts.push({ id: a.id, reason: r.skipped }); continue; }
          report.created.accounts.push({ id: a.id, name: display, zdOrgId: r.organizationId ?? undefined });
        } else {
          report.created.accounts.push({ id: a.id, name: display });
        }
      }
    }
  }

  return NextResponse.json(report);
}
