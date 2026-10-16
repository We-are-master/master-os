/**
 * Lead lançado pelo time na aba Leads: um (Add lead) ou vários (Import CSV).
 *
 *   POST { origem: "form" | "csv", leads: [{ name, email, phone, postcode,
 *          channel, service, price, status, notes, campaign, tags, created_at }] }
 *
 * Usa a sessão de quem está logado (a política da 294 só deixa staff), e o
 * nome dessa pessoa vai em created_by e na linha do tempo. Regras em
 * src/lib/site-leads/manual.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { gravarLeads, type LinhaDeLead } from "@/lib/site-leads/manual";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAXIMO = 2000;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { origem?: string; leads?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const leads = Array.isArray(body.leads) ? (body.leads as LinhaDeLead[]) : [];
  if (!leads.length) return NextResponse.json({ error: "No leads to add." }, { status: 400 });
  if (leads.length > MAXIMO) return NextResponse.json({ error: `Up to ${MAXIMO} rows per import.` }, { status: 400 });

  const sb = await createClient();
  const r = await gravarLeads(sb, leads, { actorId: auth.user.id, origem: body.origem === "csv" ? "csv" : "form" });
  return NextResponse.json({ ok: true, ...r });
}
