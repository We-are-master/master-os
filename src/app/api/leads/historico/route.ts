/**
 * Histórico e reputação de um lead, para a ficha em Leads (B2B e B2C).
 *
 *   GET ?client_id= | ?email= | ?phone= | ?account_id=
 *
 * Acha os clientes do OS por id, e-mail, telefone ou conta, soma os jobs e as faturas
 * deles e devolve o resumo (src/lib/leads/reputacao.ts). Só leitura; staff logado.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { montarHistorico } from "@/lib/leads/reputacao";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const p = req.nextUrl.searchParams;
  const clientId = p.get("client_id")?.trim() ?? "";
  const accountId = p.get("account_id")?.trim() ?? "";
  const email = p.get("email")?.trim().toLowerCase() ?? "";
  const digitos = (p.get("phone") ?? "").replace(/\D/g, "");
  const sb = createServiceClient();

  const ids = new Set<string>();
  if (isValidUUID(clientId)) ids.add(clientId);
  if (isValidUUID(accountId)) {
    const { data } = await sb.from("clients").select("id").eq("source_account_id", accountId).limit(2000);
    for (const c of data ?? []) ids.add(String(c.id));
  }
  if (email.includes("@")) {
    const { data } = await sb.from("clients").select("id").ilike("email", email).limit(20);
    for (const c of data ?? []) ids.add(String(c.id));
  }
  if (digitos.length >= 9) {
    // Os 9 últimos dígitos casam +44 7…, 07… e 447… do mesmo número.
    const { data } = await sb.from("clients").select("id").ilike("phone", `%${digitos.slice(-9)}`).limit(20);
    for (const c of data ?? []) ids.add(String(c.id));
  }
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (ids.size === 0) return NextResponse.json({ clientes: 0, historico: montarHistorico([], [], hoje), recentes: [] });

  const lista = [...ids];
  const jobs: Array<{ reference: string; status: string; title: string | null; client_price: number | null; extras_amount: number | null; scheduled_date: string | null; completed_date: string | null; on_hold_reason_preset_id: string | null }> = [];
  for (let i = 0; i < lista.length; i += 100) {
    const { data } = await sb
      .from("jobs")
      .select("reference, status, title, client_price, extras_amount, scheduled_date, completed_date, on_hold_reason_preset_id")
      .in("client_id", lista.slice(i, i + 100))
      .is("deleted_at", null)
      .order("scheduled_date", { ascending: false })
      .limit(1000);
    jobs.push(...((data ?? []) as typeof jobs));
  }
  const refs = jobs.map((j) => j.reference).filter(Boolean);
  const faturas: Array<{ status: string; due_date: string | null; amount: number | null; amount_paid: number | null }> = [];
  for (let i = 0; i < refs.length; i += 100) {
    const { data } = await sb.from("invoices").select("status, due_date, amount, amount_paid").in("job_reference", refs.slice(i, i + 100)).is("deleted_at", null);
    faturas.push(...((data ?? []) as typeof faturas));
  }
  return NextResponse.json({
    clientes: ids.size,
    historico: montarHistorico(jobs, faturas, hoje),
    recentes: jobs.slice(0, 5).map((j) => ({ reference: j.reference, status: j.status, title: j.title, date: (j.completed_date ?? j.scheduled_date ?? "").slice(0, 10), value: Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0) })),
  });
}
