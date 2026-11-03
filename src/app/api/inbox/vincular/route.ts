/**
 * Liga um número que o cadastro não reconhece a quem ele é: parceiro, cliente,
 * conta ou lead. Fica em inbox_conversas (355), sem mexer no telefone do
 * cadastro; a caixa passa a tratar a conversa como desse cadastro.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";

export const dynamic = "force-dynamic";

const TABELA = { parceiro: "partners", cliente: "clients", conta: "accounts", lead: "site_leads" } as const;
const NOME = { parceiro: "company_name", cliente: "full_name", conta: "company_name", lead: "full_name" } as const;

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const corpo = (await req.json().catch(() => ({}))) as { contato?: unknown; tipo?: unknown; id?: unknown };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  const tipo = String(corpo.tipo ?? "") as keyof typeof TABELA;
  const id = typeof corpo.id === "string" ? corpo.id : "";
  if (!contato || !(tipo in TABELA) || !id) return NextResponse.json({ error: "contato, tipo and id are required" }, { status: 400 });

  const { data: alvo } = await s.sb.from(TABELA[tipo]).select(`id, ${NOME[tipo]}`).eq("id", id).maybeSingle();
  if (!alvo) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  const nome = ((alvo as Record<string, unknown>)[NOME[tipo]] as string | null) ?? null;

  const { error } = await s.sb
    .from("inbox_conversas")
    .upsert(
      { contato, vinculo_tipo: tipo, vinculo_id: id, ...(tipo === "lead" && nome ? { nome } : {}), atualizado_em: new Date().toISOString() },
      { onConflict: "contato" },
    );
  if (error) {
    const falta = /vinculo/.test(error.message);
    return NextResponse.json({ error: falta ? "Linking needs migration 355" : error.message }, { status: falta ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, nome });
}
