/**
 * Documentos do OS que o site e os agentes leem (migration 316, dono 07/10/2026):
 *
 *   tabela_de_precos  a tabela do site (tamanhos, limpeza, extras, pintura,
 *                     reparos, certificados), no mesmo formato do pricing.js
 *   regras            o que vale para cliente, parceiro e conta, em blocos curtos
 *
 * Cada salvamento é uma versão nova (linha nova); a em vigor é a de maior id.
 * Desfazer = salvar de novo uma versão antiga. A tabela de preços tem uma trava:
 * preço que muda mais de 30% de uma vez só passa com confirmação.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoDeDocumento = "tabela_de_precos" | "regras";

export type Versao<T> = { id: number; documento: T; nota: string | null; criado_em: string; criado_por: string | null };

// ── formatos ────────────────────────────────────────────────────────────────

export type Precos = Record<string, number | null>;
export type Tamanho = { id: string; label: string; short: string; tiny: string; ativo?: boolean };
export type TipoDeLimpeza = { id: string; name: string; short: string; tiny: string; hint: string; detail: string; prices: Precos; osTitle: string };
export type ExtraDeLimpeza = { id: string; label: string; detail: string; price: number; unit?: string; max?: number };
export type OpcaoDePintura = { id: string; label: string; detail: string; price: number; unit?: string; max?: number };
export type Pacote = { id: string; label: string; detail: string; minutes: number; price: number };
export type Tarefa = { id: string; label: string; minutes: number };
export type Certificado = { id: string; label: string; short: string; detail: string; valid: string; price?: number | null; prices?: Precos | null; osTitle: string };

export type TabelaDePrecos = {
  formato: 1;
  moeda: string;
  sizes: Tamanho[];
  bathroomOptions: number[];
  defaultCleanKind: string;
  clean: {
    id: string;
    verb: string;
    includedBathrooms: number;
    ovenIncluded: boolean;
    productsIncluded: boolean;
    teamOfTwoFromSize: string;
    extraBathroomSteps: number[];
    extras: ExtraDeLimpeza[];
    kinds: TipoDeLimpeza[];
  };
  paint: { id: string; verb: string; name: string; osTitle: string; options: OpcaoDePintura[]; materials: { id: string; label: string; detail: string; price: number } };
  fix: { id: string; verb: string; name: string; osTitle: string; packages: Pacote[]; toolsIncluded: boolean; tasks: Tarefa[] };
  cert: { id: string; verb: string; name: string; items: Certificado[] };
};

export type Regra = { id: string; titulo: string; texto: string };
export type PublicoDaRegra = "cliente" | "parceiro" | "conta";
export type Regras = { formato: 1; publicos: Record<PublicoDaRegra, Regra[]> };

export const PUBLICOS: Array<{ id: PublicoDaRegra; titulo: string; ajuda: string }> = [
  { id: "cliente", titulo: "Customers", ajuda: "What every customer can expect: payment, cancellation, guarantee, area." },
  { id: "parceiro", titulo: "Partners", ajuda: "What partners agree to: documents, jobs, cancellation fee, reports, pay." },
  { id: "conta", titulo: "Accounts", ajuda: "Letting agents, landlords and property managers booking for an account." },
];

// ── leitura ─────────────────────────────────────────────────────────────────

export async function versaoAtual<T>(sb: SupabaseClient, tipo: TipoDeDocumento): Promise<Versao<T> | null> {
  const { data, error } = await sb.from("os_documentos").select("id, documento, nota, criado_em, criado_por").eq("tipo", tipo).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Versao<T> | null) ?? null;
}

export async function historico(sb: SupabaseClient, tipo: TipoDeDocumento, limite = 20): Promise<Array<Omit<Versao<unknown>, "documento">>> {
  const { data, error } = await sb.from("os_documentos").select("id, nota, criado_em, criado_por").eq("tipo", tipo).order("id", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Omit<Versao<unknown>, "documento">>;
}

export async function versaoPorId<T>(sb: SupabaseClient, tipo: TipoDeDocumento, id: number): Promise<Versao<T> | null> {
  const { data } = await sb.from("os_documentos").select("id, documento, nota, criado_em, criado_por").eq("tipo", tipo).eq("id", id).maybeSingle();
  return (data as Versao<T> | null) ?? null;
}

// ── validação ───────────────────────────────────────────────────────────────

const preco = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000;
const texto = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Mesma régua do site (tabela-ao-vivo.js): o que não passa aqui o site também recusaria. */
export function validarTabela(d: unknown): string[] {
  const erros: string[] = [];
  const t = d as TabelaDePrecos;
  if (!t || typeof t !== "object" || t.formato !== 1) return ["Unknown price list format"];
  if (!Array.isArray(t.sizes) || !t.sizes.length) erros.push("No property sizes");
  const ativos = (t.sizes ?? []).filter((s) => s.ativo !== false);
  if (!ativos.length) erros.push("At least one property size must be on");
  for (const s of t.sizes ?? []) if (!texto(s.id) || !texto(s.label)) erros.push(`A property size has no name (${s.id || "?"})`);
  if (!t.clean?.kinds?.length) erros.push("No cleaning types");
  for (const k of t.clean?.kinds ?? []) {
    if (!texto(k.name)) erros.push(`Cleaning type ${k.id} has no name`);
    for (const s of ativos) {
      const v = k.prices?.[s.id];
      if (v !== null && !preco(v)) erros.push(`${k.name || k.id}: price for ${s.label} must be a number above £0 (or "Quote")`);
    }
  }
  for (const e of t.clean?.extras ?? []) if (!preco(e.price) || !texto(e.label)) erros.push(`Cleaning extra "${e.label || e.id}" needs a name and a price`);
  if (!(t.clean?.extraBathroomSteps ?? []).length || !(t.clean?.extraBathroomSteps ?? []).every(preco)) erros.push("Extra bathroom prices must be numbers above £0");
  if (!Number.isInteger(t.clean?.includedBathrooms) || t.clean.includedBathrooms < 1) erros.push("Included bathrooms must be 1 or more");
  if (!(t.sizes ?? []).some((s) => s.id === t.clean?.teamOfTwoFromSize)) erros.push("Team of two must start at one of the sizes");
  for (const o of t.paint?.options ?? []) if (!preco(o.price) || !texto(o.label)) erros.push(`Painting option "${o.label || o.id}" needs a name and a price`);
  if (!preco(t.paint?.materials?.price)) erros.push("Paint materials pack needs a price");
  for (const p of t.fix?.packages ?? []) if (!preco(p.price) || !texto(p.label)) erros.push(`Repairs package "${p.label || p.id}" needs a name and a price`);
  for (const c of t.cert?.items ?? []) {
    if (!texto(c.label)) erros.push(`A certificate has no name (${c.id})`);
    if (c.prices) {
      for (const s of ativos) {
        const v = c.prices[s.id];
        if (v !== null && v !== undefined && !preco(v)) erros.push(`${c.label}: price for ${s.label} must be a number above £0 (or "Quote")`);
      }
    } else if (!preco(c.price)) erros.push(`${c.label} needs a price`);
  }
  return erros;
}

export function validarRegras(d: unknown): string[] {
  const r = d as Regras;
  if (!r || r.formato !== 1 || !r.publicos) return ["Unknown rules format"];
  const erros: string[] = [];
  for (const p of PUBLICOS) {
    for (const regra of r.publicos[p.id] ?? []) {
      if (!texto(regra.titulo) || !texto(regra.texto)) erros.push(`${p.titulo}: every rule needs a title and a text`);
      if (/[—–]/.test(`${regra.titulo} ${regra.texto}`)) erros.push(`${p.titulo} · ${regra.titulo || "?"}: no dashes, use a full stop, comma or colon`);
    }
  }
  return erros;
}

// ── trava dos 30% ───────────────────────────────────────────────────────────

/** Todos os preços da tabela, com um nome legível, para comparar duas versões. */
function precosDe(t: TabelaDePrecos): Map<string, { nome: string; valor: number }> {
  const m = new Map<string, { nome: string; valor: number }>();
  const tam = new Map(t.sizes.map((s) => [s.id, s.label]));
  const add = (k: string, nome: string, v: unknown) => (preco(v) ? m.set(k, { nome, valor: v as number }) : undefined);
  for (const k of t.clean.kinds) for (const [s, v] of Object.entries(k.prices)) add(`clean.${k.id}.${s}`, `${k.name}, ${tam.get(s) ?? s}`, v);
  t.clean.extraBathroomSteps.forEach((v, i) => add(`bath.${i}`, `Extra bathroom ${i + 2}`, v));
  for (const e of t.clean.extras) add(`extra.${e.id}`, e.label, e.price);
  for (const o of t.paint.options) add(`paint.${o.id}`, o.label, o.price);
  add("paint.materials", t.paint.materials.label, t.paint.materials.price);
  for (const p of t.fix.packages) add(`fix.${p.id}`, `Repairs ${p.label}`, p.price);
  for (const c of t.cert.items) {
    if (c.prices) for (const [s, v] of Object.entries(c.prices)) add(`cert.${c.id}.${s}`, `${c.label}, ${tam.get(s) ?? s}`, v);
    else add(`cert.${c.id}`, c.label, c.price);
  }
  return m;
}

/** Preços que mudam mais de 30% contra a versão em vigor (para pedir confirmação). */
export function mudancasGrandes(antes: TabelaDePrecos | null, depois: TabelaDePrecos): string[] {
  if (!antes) return [];
  const a = precosDe(antes);
  const out: string[] = [];
  for (const [k, d] of precosDe(depois)) {
    const x = a.get(k);
    if (x && Math.abs(d.valor - x.valor) / x.valor > 0.3) out.push(`${d.nome}: £${x.valor} → £${d.valor}`);
  }
  return out;
}

// ── escrita ─────────────────────────────────────────────────────────────────

export async function salvarVersao(sb: SupabaseClient, tipo: TipoDeDocumento, documento: unknown, quem: string, nota: string | null): Promise<number> {
  const { data, error } = await sb.from("os_documentos").insert({ tipo, documento, nota, criado_por: quem }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

// ── cache para quem lê muito (site, agentes) ────────────────────────────────

const cache = new Map<TipoDeDocumento, { em: number; versao: Versao<unknown> | null }>();

/** Versão em vigor com cache de 30 s. Falhou a leitura, devolve a última boa. */
export async function versaoEmVigor<T>(sb: SupabaseClient, tipo: TipoDeDocumento): Promise<Versao<T> | null> {
  const c = cache.get(tipo);
  if (c && Date.now() - c.em < 30_000) return c.versao as Versao<T> | null;
  try {
    const v = await versaoAtual<T>(sb, tipo);
    cache.set(tipo, { em: Date.now(), versao: v });
    return v;
  } catch (e) {
    console.error(`[os-documentos] ${tipo}`, e);
    return (c?.versao as Versao<T> | null) ?? null;
  }
}
