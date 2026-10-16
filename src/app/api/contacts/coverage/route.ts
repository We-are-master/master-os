import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Which Checkatrade lead ids does the contact base already hold?
 *
 * Ingestion stamps `checkatrade-lead:<id>` into each contact's notes, and this
 * hands the set back so the RPA can reconcile the board against the OS
 * lead-by-lead. Counting rows on both sides can't answer "is every lead we
 * paid for in here?" — only matching ids can.
 *
 * Auth: header `X-API-Key` must match env `MASTER_OS_LEAD_WEBHOOK_API_KEY`.
 * Response: { external_ids: string[], contacts_with_marker: number }
 */
function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const MARKER = /checkatrade-(?:lead|job):([\w-]+)/g;

export async function GET(req: NextRequest) {
  const expected = process.env.MASTER_OS_LEAD_WEBHOOK_API_KEY?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(req.headers.get("x-api-key"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ids = new Set<string>();
  let withMarker = 0;

  // Page through: the contact base is thousands of rows and a single select
  // would silently truncate at PostgREST's default limit, which would report
  // leads as missing when they are simply past the cut.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("clients")
      .select("notes")
      .not("notes", "is", null)
      .is("deleted_at", null)
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const notes = (row as { notes: string | null }).notes ?? "";
      let m: RegExpExecArray | null;
      MARKER.lastIndex = 0;
      let matched = false;
      while ((m = MARKER.exec(notes)) !== null) {
        ids.add(m[1]);
        matched = true;
      }
      if (matched) withMarker++;
    }
    if (data.length < PAGE) break;
  }

  return NextResponse.json({ external_ids: [...ids], contacts_with_marker: withMarker });
}
