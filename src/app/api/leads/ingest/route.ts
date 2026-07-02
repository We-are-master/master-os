import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeApifyItem, isEmailable, type LeadSegment } from "@/lib/leads/normalize";
import { enrollInSequence } from "@/lib/email-sequences/enroll";
import { COLD_SEQUENCE_BY_SEGMENT } from "@/lib/email-sequences/definitions";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ITEMS = 2000; // safety cap per ingestion run

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull dataset items from the Apify API (webhooks deliver metadata, not items). */
async function fetchApifyDataset(datasetId: string, token: string): Promise<unknown[]> {
  const items: unknown[] = [];
  const limit = 1000;
  let offset = 0;
  while (items.length < MAX_ITEMS) {
    const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`apify ${res.status}`);
    const page = (await res.json()) as unknown[];
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return items.slice(0, MAX_ITEMS);
}

/**
 * Apify webhook → lead ingestion. Configure the Apify webhook to POST here on
 * ACTOR.RUN.SUCCEEDED with the segment in the query and the secret in a header:
 *
 *   URL:    https://app.getfixfy.com/api/leads/ingest?segment=partner
 *   Header: x-fixfy-webhook-secret: <APIFY_WEBHOOK_SECRET>
 *
 * Also accepts a direct `{ items: [...] }` body for manual/testing ingestion.
 */
export async function POST(req: NextRequest) {
  const provided =
    req.headers.get("x-fixfy-webhook-secret") ||
    (req.headers.get("authorization")?.startsWith("Bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);
  if (!secretsMatch(provided, process.env.APIFY_WEBHOOK_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const segment = req.nextUrl.searchParams.get("segment") as LeadSegment | null;
  if (segment !== "partner" && segment !== "b2b_client") {
    return NextResponse.json({ error: "segment must be 'partner' or 'b2b_client'" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine for some webhook configs; we still need a datasetId though
  }

  // Resolve items: prefer a direct items array, else fetch the Apify dataset.
  let items: unknown[] = Array.isArray(body.items) ? (body.items as unknown[]) : [];
  let actorId: string | null = null;
  let runId: string | null = null;

  if (items.length === 0) {
    const resource = (body.resource ?? {}) as Record<string, unknown>;
    const eventData = (body.eventData ?? {}) as Record<string, unknown>;
    const datasetId =
      (resource.defaultDatasetId as string | undefined) ||
      (req.nextUrl.searchParams.get("datasetId") ?? undefined);
    actorId = (eventData.actorId as string | undefined) ?? null;
    runId = (resource.id as string | undefined) ?? (eventData.actorRunId as string | undefined) ?? null;

    if (!datasetId) {
      return NextResponse.json({ error: "No items and no datasetId to fetch" }, { status: 400 });
    }
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) {
      return NextResponse.json({ error: "APIFY_TOKEN not configured" }, { status: 503 });
    }
    try {
      items = await fetchApifyDataset(datasetId, token);
    } catch (e) {
      return NextResponse.json({ error: `Could not fetch dataset: ${e instanceof Error ? e.message : "unknown"}` }, { status: 502 });
    }
  }

  const admin = createServiceClient();
  const sequenceKey = COLD_SEQUENCE_BY_SEGMENT[segment];
  const ctaField = segment === "partner" ? "applyUrl" : "callUrl";

  let stored = 0;
  let duplicates = 0;
  let enrolled = 0;
  let invalid = 0;

  for (const raw of items.slice(0, MAX_ITEMS)) {
    const lead = normalizeApifyItem(raw);
    const emailable = isEmailable(lead);

    const { data: inserted, error: insErr } = await admin
      .from("leads")
      .insert({
        source: "apify",
        apify_actor: actorId,
        apify_run_id: runId,
        segment,
        email: lead.email,
        company_name: lead.company_name,
        contact_name: lead.contact_name,
        phone: lead.phone,
        website: lead.website,
        category: lead.category,
        town: lead.town,
        country: lead.country,
        status: emailable ? "new" : "invalid",
        raw: raw as object,
      })
      .select("id")
      .single();

    if (insErr) {
      if (insErr.code === "23505") duplicates++; // already have this email
      continue;
    }
    if (!emailable) {
      invalid++;
      continue;
    }
    stored++;

    // Enroll the fresh, emailable lead into its cold sequence.
    const result = await enrollInSequence({
      sequenceKey,
      email: lead.email!,
      name: lead.contact_name || lead.company_name || undefined,
      context: {
        company_name: lead.company_name ?? undefined,
        town: lead.town ?? undefined,
        category: lead.category ?? undefined,
        [ctaField]: undefined, // use template defaults unless you override per-campaign
        unsubscribeUrl: unsubscribeUrl(lead.email!),
      },
    });

    if (result.ok && !result.alreadyActive) {
      enrolled++;
      await admin
        .from("leads")
        .update({ status: "enrolled", enrolled_sequence: sequenceKey, updated_at: new Date().toISOString() })
        .eq("id", inserted.id);
    }
  }

  return NextResponse.json({
    ok: true,
    segment,
    received: items.length,
    stored,
    enrolled,
    duplicates,
    invalid,
  });
}
