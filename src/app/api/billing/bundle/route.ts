import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { loadBillingBundle } from "@/lib/billing-standalone-bundle";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import { runWithSupabase } from "@/lib/supabase/request-scope-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/billing/bundle[?from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * O pacote inteiro do Billing numa chamada. Roda com a SESSÃO de quem pediu (mesmo RLS do
 * navegador), só que do lado do servidor: as dezenas de consultas deixam de atravessar o
 * oceano uma a uma. Sem `from`/`to` devolve o histórico todo, como a tela já fazia.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const from = req.nextUrl.searchParams.get("from")?.trim() ?? "";
  const to = req.nextUrl.searchParams.get("to")?.trim() ?? "";
  const bounds: YmdBounds | null = YMD.test(from) && YMD.test(to) ? { from, to } : null;

  try {
    const supabase = await createClient();
    const started = Date.now();
    const bundle = await runWithSupabase(supabase, () => loadBillingBundle(bounds));
    return NextResponse.json(bundle, {
      headers: { "Cache-Control": "no-store", "Server-Timing": `bundle;dur=${Date.now() - started}` },
    });
  } catch (e) {
    console.error("billing bundle:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load billing" },
      { status: 500 },
    );
  }
}
