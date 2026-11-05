/**
 * POST /api/crm/leads/sync  { leadId }
 *
 * Alinha a etapa do lead com as quotes dele (fase 3 do CRM). Chamado pela tela
 * depois de criar ou editar uma quote com lead_id (src/services/quotes.ts),
 * sem esperar a resposta. A regra mora na aplicação, nunca em trigger, e a
 * rotina do espelho (10 min) passa em todos de novo, então perder uma chamada
 * daqui não deixa o lead errado por muito tempo.
 *
 * Só equipe: quem pode ver Leads ou Quotes (conta de parceiro não passa).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { sincronizarEtapasPelasQuotes } from "@/lib/crm/lead-servidor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const leads = await requireStaffPermission(auth, "leads");
  if (leads instanceof NextResponse) {
    const quotes = await requireStaffPermission(auth, "quotes");
    if (quotes instanceof NextResponse) return quotes;
  }

  const body = (await req.json().catch(() => null)) as { leadId?: unknown } | null;
  const leadId = String(body?.leadId ?? "").trim();
  if (!isValidUUID(leadId)) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const r = await sincronizarEtapasPelasQuotes(createServiceClient(), { leadIds: [leadId] });
  if (r.erros.length) return NextResponse.json({ ok: false, ...r }, { status: 500 });
  return NextResponse.json({ ok: true, ...r });
}
