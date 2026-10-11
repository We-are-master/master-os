/**
 * Reserva de job Express entre as contas do Checkatrade (dono, 11/10/2026).
 *
 *   POST { externalId, account }  →  200 { ok: true }            esta conta pode aceitar
 *                                    409 { ok: false, account }   outra conta já reservou
 *
 * Reservar de novo pela MESMA conta devolve 200 (o Ruben pode cair e voltar).
 * Auth: X-API-Key = MASTER_OS_JOB_WEBHOOK_API_KEY, a mesma do /api/jobs.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { contaValida } from "@/lib/checkatrade-contas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (!esperada || req.headers.get("x-api-key")?.trim() !== esperada) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { externalId?: string; account?: string };
  const externalId = String(body.externalId ?? "").trim();
  const account = contaValida(body.account);
  if (!/^[a-z0-9]{8,40}$/i.test(externalId) || !account) return NextResponse.json({ error: "externalId and account are required" }, { status: 400 });

  const sb = createServiceClient();
  const { error } = await sb.from("express_claims").insert({ external_id: externalId, account });
  if (!error) return NextResponse.json({ ok: true });
  if ((error as { code?: string }).code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  const { data } = await sb.from("express_claims").select("account").eq("external_id", externalId).maybeSingle();
  const dono = String((data as { account?: string } | null)?.account ?? "");
  return dono === account ? NextResponse.json({ ok: true, already: true }) : NextResponse.json({ ok: false, account: dono }, { status: 409 });
}
