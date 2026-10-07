/**
 * Salva a tabela de preços ou as regras do OS (telas /services/price-list e /rules).
 *
 *   GET  ?tipo=tabela_de_precos|regras                 histórico (últimas 20 versões)
 *   POST { tipo, documento, nota?, confirmar? }         versão nova
 *   POST { tipo, restaurar: <id> }                      salva de novo uma versão antiga
 *
 * Só admin e manager. Preço que muda mais de 30% de uma vez volta 409 com a
 * lista, e só passa com confirmar: true (erro de digitação vai direto ao site).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  historico,
  mudancasGrandes,
  salvarVersao,
  validarRegras,
  validarTabela,
  versaoAtual,
  versaoPorId,
  type TabelaDePrecos,
  type TipoDeDocumento,
} from "@/lib/os-documentos";
import { comoLista, paraSite, validarV2, type TabelaV2 } from "@/lib/tabela-v2";

export const dynamic = "force-dynamic";

const EDITA = new Set(["admin", "manager"]);
const TIPOS = new Set<TipoDeDocumento>(["tabela_de_precos", "regras"]);

async function quemEdita() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { erro: auth };
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  return { sb, role: String(eu?.role ?? ""), quem: String(eu?.full_name || eu?.email || "team") };
}

export async function GET(req: NextRequest) {
  const r = await quemEdita();
  if ("erro" in r) return r.erro;
  const tipo = req.nextUrl.searchParams.get("tipo") as TipoDeDocumento;
  if (!TIPOS.has(tipo)) return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  return NextResponse.json({ versoes: await historico(r.sb, tipo) });
}

export async function POST(req: NextRequest) {
  const r = await quemEdita();
  if ("erro" in r) return r.erro;
  if (!EDITA.has(r.role)) return NextResponse.json({ error: "Only admins and managers can change this" }, { status: 403 });
  const corpo = (await req.json().catch(() => ({}))) as { tipo?: TipoDeDocumento; documento?: unknown; nota?: string; confirmar?: boolean; restaurar?: number };
  const tipo = corpo.tipo as TipoDeDocumento;
  if (!TIPOS.has(tipo)) return NextResponse.json({ error: "Unknown type" }, { status: 400 });

  let documento = corpo.documento;
  let nota = (corpo.nota ?? "").trim().slice(0, 200) || null;
  if (corpo.restaurar) {
    const antiga = await versaoPorId(r.sb, tipo, Number(corpo.restaurar));
    if (!antiga) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    documento = antiga.documento;
    nota = `Restored version ${antiga.id}`;
  }

  // Tabela: a lista (formato 2) tem de passar na régua dela E virar uma tabela que o site aceita.
  const lista = tipo === "tabela_de_precos" ? comoLista(documento) : null;
  const erros = lista ? [...validarV2(lista as TabelaV2), ...validarTabela(paraSite(lista))] : validarRegras(documento);
  if (erros.length) return NextResponse.json({ error: erros[0], erros }, { status: 400 });

  if (lista && !corpo.confirmar) {
    const atual = await versaoAtual<TabelaDePrecos>(r.sb, tipo);
    const grandes = mudancasGrandes(atual ? paraSite(comoLista(atual.documento)) : null, paraSite(lista));
    if (grandes.length) {
      return NextResponse.json({ error: "Some prices change by more than 30%. Confirm to save.", confirmar: grandes }, { status: 409 });
    }
  }
  const id = await salvarVersao(r.sb, tipo, documento, r.quem, nota);
  return NextResponse.json({ ok: true, versao: id });
}
