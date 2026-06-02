#!/usr/bin/env node
/**
 * Backfill the Zendesk "Job ID" custom field (default id 5824403479839) with
 * the OS job reference (e.g. "JOB-1234") for every job that is linked to a
 * Zendesk ticket (external_source = 'zendesk', external_ref = <ticket_id>).
 *
 * Idempotent — safe to re-run. By default it skips tickets that already carry
 * the correct value (one extra GET per ticket); pass --force to always PUT.
 *
 * Usage (Node 20+, reads env from .env.local):
 *   node --env-file=.env.local scripts/zendesk-backfill-job-ids.mjs --dry-run
 *   node --env-file=.env.local scripts/zendesk-backfill-job-ids.mjs
 *   node --env-file=.env.local scripts/zendesk-backfill-job-ids.mjs --force
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
 *   SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY),
 *   ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN.
 *   Optional: ZENDESK_JOB_ID_FIELD_ID (default 5824403479839).
 */

import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run") || args.has("-n");
const FORCE = args.has("--force");
const CONCURRENCY = 4;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUBDOMAIN = (process.env.ZENDESK_SUBDOMAIN || "").trim();
const EMAIL = (process.env.ZENDESK_EMAIL || "").trim();
const API_TOKEN = (process.env.ZENDESK_API_TOKEN || "").trim();
const FIELD_ID = Number((process.env.ZENDESK_JOB_ID_FIELD_ID || "5824403479839").trim());

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) die("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY).");
if (!SUBDOMAIN || !EMAIL || !API_TOKEN) die("Missing Zendesk env (ZENDESK_SUBDOMAIN / ZENDESK_EMAIL / ZENDESK_API_TOKEN).");
if (!Number.isFinite(FIELD_ID)) die("ZENDESK_JOB_ID_FIELD_ID is not a number.");

const authHeader = "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
const zdBase = `https://${SUBDOMAIN}.zendesk.com/api/v2`;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Fetch all Zendesk-linked jobs, paging past Supabase's default 1000-row cap. */
async function fetchLinkedJobs() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("jobs")
      .select("id, reference, external_ref")
      .eq("external_source", "zendesk")
      .not("external_ref", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) die(`Supabase query failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalise an external_ref into a numeric Zendesk ticket id.
 * Accepts a bare number ("44989") or a full agent URL
 * (".../tickets/44989"). Returns null for anything else (e.g. e2e test refs).
 */
function normalizeTicketId(raw) {
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/tickets\/(\d+)/);
  if (m) return m[1];
  return null;
}

/** GET the ticket and return its current value for FIELD_ID (string|null). */
async function currentFieldValue(ticketId) {
  const res = await fetch(`${zdBase}/tickets/${encodeURIComponent(ticketId)}.json`, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (res.status === 404) return { missing: true };
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") || "5");
    await sleep((wait + 1) * 1000);
    return currentFieldValue(ticketId);
  }
  if (!res.ok) throw new Error(`GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const f = (j.ticket?.custom_fields ?? []).find((x) => Number(x.id) === FIELD_ID);
  return { value: f ? f.value : null };
}

/** PUT the field value onto the ticket. */
async function setFieldValue(ticketId, value) {
  const res = await fetch(`${zdBase}/tickets/${encodeURIComponent(ticketId)}.json`, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ticket: { custom_fields: [{ id: FIELD_ID, value }] } }),
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") || "5");
    await sleep((wait + 1) * 1000);
    return setFieldValue(ticketId, value);
  }
  if (!res.ok) throw new Error(`PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function processJob(job, report) {
  const ticketId = normalizeTicketId(job.external_ref ?? "");
  const ref = job.reference ? String(job.reference).trim() : "";
  if (!ticketId) { report.skipped.push({ id: job.id, ext: String(job.external_ref), reason: "non_numeric_ref" }); return; }
  if (!ref) { report.skipped.push({ id: job.id, ticketId, reason: "no_reference" }); return; }

  try {
    if (!FORCE) {
      const cur = await currentFieldValue(ticketId);
      if (cur.missing) { report.skipped.push({ id: job.id, ticketId, reason: "ticket_404" }); return; }
      if (cur.value === ref) { report.alreadyOk.push({ id: job.id, ticketId, ref }); return; }
    }
    if (DRY_RUN) { report.wouldUpdate.push({ id: job.id, ticketId, ref }); return; }
    await setFieldValue(ticketId, ref);
    report.updated.push({ id: job.id, ticketId, ref });
    console.log(`  ✓ ticket ${ticketId} ← ${ref}`);
  } catch (err) {
    report.failed.push({ id: job.id, ticketId, error: err.message });
    console.error(`  ✗ ticket ${ticketId} (${ref}): ${err.message}`);
  }
}

async function main() {
  console.log(`Zendesk Job-ID backfill — field ${FIELD_ID} on ${SUBDOMAIN}.zendesk.com${DRY_RUN ? " [DRY RUN]" : ""}${FORCE ? " [FORCE]" : ""}`);
  const jobs = await fetchLinkedJobs();
  console.log(`Found ${jobs.length} Zendesk-linked jobs.\n`);

  const report = { updated: [], wouldUpdate: [], alreadyOk: [], skipped: [], failed: [] };

  // Simple fixed-size worker pool to respect Zendesk rate limits.
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      await processJob(job, report);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("\n──────── Summary ────────");
  console.log(`updated:     ${report.updated.length}`);
  console.log(`wouldUpdate: ${report.wouldUpdate.length} (dry-run only)`);
  console.log(`alreadyOk:   ${report.alreadyOk.length}`);
  console.log(`skipped:     ${report.skipped.length}`);
  console.log(`failed:      ${report.failed.length}`);
  if (report.skipped.length) console.log("skipped detail:", JSON.stringify(report.skipped, null, 2));
  if (report.failed.length) console.log("failed detail:", JSON.stringify(report.failed, null, 2));
}

main().catch((e) => die(e.stack || e.message));
