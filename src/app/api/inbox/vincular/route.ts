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

/** Os números ligados a um cadastro, para a aba Contacts dele. */
export async function GET(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const tipo = String(req.nextUrl.searchParams.get("tipo") ?? "") as keyof typeof TABELA;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!(tipo in TABELA) || !id) return NextResponse.json({ error: "tipo and id are required" }, { status: 400 });
  const { data, error } = await s.sb
    .from("inbox_conversas")
    .select("contato, atualizado_em")
    .eq("vinculo_tipo", tipo)
    .eq("vinculo_id", id)
    .order("atualizado_em", { ascending: false });
  if (error) {
    const falta = /vinculo/.test(error.message);
    return NextResponse.json({ contatos: [], falta355: falta }, { status: falta ? 200 : 500 });
  }
  const numeros = (data ?? []).map((r) => r.contato as string);
  // O nome que o WhatsApp mostra, da última mensagem que chegou de cada número.
  const perfis = new Map<string, string>();
  if (numeros.length) {
    const { data: msgs } = await s.sb
      .from("wa_mensagens")
      .select("contato, contato_nome")
      .in("contato", numeros)
      .eq("direcao", "entrada")
      .not("contato_nome", "is", null)
      .order("criado_em", { ascending: false })
      .limit(200);
    for (const m of msgs ?? []) if (!perfis.has(m.contato as string)) perfis.set(m.contato as string, m.contato_nome as string);
  }
  return NextResponse.json({
    contatos: (data ?? []).map((r) => ({ contato: r.contato, perfil: perfis.get(r.contato as string) ?? null, desde: r.atualizado_em })),
  });
}

/** Desfaz a ligação: a conversa volta a ser um número sem cadastro. */
export async function DELETE(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const corpo = (await req.json().catch(() => ({}))) as { contato?: unknown };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  if (!contato) return NextResponse.json({ error: "contato is required" }, { status: 400 });
  const { error } = await s.sb
    .from("inbox_conversas")
    .update({ vinculo_tipo: null, vinculo_id: null, atualizado_em: new Date().toISOString() })
    .eq("contato", contato);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
