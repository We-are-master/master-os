/**
 * Tabela de preços como LISTA DE SERVIÇOS (formato 2, dono 07/10/2026): cada
 * serviço tem nome, categoria, como cobra, preços, extras e descrição. É o que
 * a tela /price-list edita e o que o Harvey lê.
 *
 * O site e o checkout continuam lendo o formato 1 (o do pricing.js): paraSite()
 * converte. O que o site ainda não sabe vender sozinho (handyman por hora,
 * call-out, semana, mês; categoria "other"; extras fora de limpeza e o pacote de
 * material da pintura) fica marcado "Harvey only": o Harvey cota e passa para a
 * equipe fechar.
 */

import type { TabelaDePrecos, Tamanho, Tarefa } from "@/lib/os-documentos";

export type Categoria = "cleaning" | "handyman" | "painting" | "certificate" | "other";
export type Cobranca = "por_tamanho" | "pacotes" | "fixo" | "por_unidade";
export type TipoDePacote = "half_day" | "full_day" | "hours" | "per_hour" | "call_out" | "week" | "month";

export type Pacote = { id: string; tipo: TipoDePacote; rotulo: string; detalhe: string; horas: number | null; preco: number };
export type Extra = { id: string; rotulo: string; detalhe: string; preco: number; porUnidade: boolean; max?: number };

export type ServicoV2 = {
  id: string;
  nome: string;
  categoria: Categoria;
  /** A frase do site e do Harvey sobre o serviço. */
  descricao: string;
  /** O tipo de trabalho do job no OS (lista canônica ou o nome que o site já usa). */
  osTitle: string;
  cobranca: Cobranca;
  precosPorTamanho?: Record<string, number | null>;
  pacotes?: Pacote[];
  preco?: number | null;
  unidade?: string;
  maxUnidades?: number;
  extras: Extra[];
  ativo: boolean;
  /** Textos curtos que só o site usa (botão, cabeçalho, validade do certificado). */
  site?: { short?: string; tiny?: string; hint?: string; valid?: string };
};

export type TabelaV2 = {
  formato: 2;
  moeda: string;
  tamanhos: Tamanho[];
  bathroomOptions: number[];
  limpeza: { banheirosInclusos: number; banheiroExtra: number[]; equipeDeDoisAPartir: string; padrao: string };
  tarefas: Tarefa[];
  servicos: ServicoV2[];
};

export const CATEGORIAS: Array<{ id: Categoria; nome: string; cobrancas: Cobranca[] }> = [
  { id: "cleaning", nome: "Cleaning", cobrancas: ["por_tamanho"] },
  { id: "handyman", nome: "Handyman", cobrancas: ["pacotes"] },
  { id: "painting", nome: "Painting", cobrancas: ["fixo", "por_unidade"] },
  { id: "certificate", nome: "Certificate", cobrancas: ["fixo", "por_tamanho"] },
  { id: "other", nome: "Other", cobrancas: ["fixo", "por_unidade", "pacotes"] },
];

export const NOME_DA_COBRANCA: Record<Cobranca, string> = {
  por_tamanho: "By property size",
  pacotes: "By time (packages)",
  fixo: "Fixed price",
  por_unidade: "Per unit (room, item)",
};

export const TIPOS_DE_PACOTE: Array<{ id: TipoDePacote; nome: string; horas: number | null; noSite: boolean }> = [
  { id: "half_day", nome: "Half day", horas: 3.5, noSite: true },
  { id: "full_day", nome: "Full day", horas: 7, noSite: true },
  { id: "hours", nome: "Set number of hours", horas: 2, noSite: true },
  { id: "per_hour", nome: "Per hour", horas: null, noSite: false },
  { id: "call_out", nome: "Call-out", horas: null, noSite: false },
  { id: "week", nome: "Week", horas: null, noSite: false },
  { id: "month", nome: "Month", horas: null, noSite: false },
];

const PACOTE_NO_SITE = new Set(TIPOS_DE_PACOTE.filter((t) => t.noSite).map((t) => t.id));

// ── do formato 1 (o do site) para a lista ───────────────────────────────────

export function deV1(t: TabelaDePrecos): TabelaV2 {
  const extrasDeLimpeza: Extra[] = t.clean.extras.map((e) => ({ id: e.id, rotulo: e.label, detalhe: e.detail, preco: e.price, porUnidade: e.unit === "room", ...(e.max ? { max: e.max } : {}) }));
  const material: Extra = { id: t.paint.materials.id || "materials", rotulo: t.paint.materials.label, detalhe: t.paint.materials.detail, preco: t.paint.materials.price, porUnidade: false };
  return {
    formato: 2,
    moeda: t.moeda,
    tamanhos: t.sizes,
    bathroomOptions: t.bathroomOptions,
    limpeza: { banheirosInclusos: t.clean.includedBathrooms, banheiroExtra: t.clean.extraBathroomSteps, equipeDeDoisAPartir: t.clean.teamOfTwoFromSize, padrao: t.defaultCleanKind },
    tarefas: t.fix.tasks,
    servicos: [
      ...t.clean.kinds.map(
        (k): ServicoV2 => ({
          id: k.id,
          nome: k.name,
          categoria: "cleaning",
          descricao: k.detail,
          osTitle: k.osTitle,
          cobranca: "por_tamanho",
          precosPorTamanho: { ...k.prices },
          extras: structuredClone(extrasDeLimpeza),
          ativo: true,
          site: { short: k.short, tiny: k.tiny, hint: k.hint },
        }),
      ),
      ...t.paint.options.map(
        (o): ServicoV2 => ({
          id: o.id,
          nome: o.label,
          categoria: "painting",
          descricao: o.detail,
          osTitle: t.paint.osTitle,
          cobranca: o.unit ? "por_unidade" : "fixo",
          preco: o.price,
          ...(o.unit ? { unidade: o.unit, maxUnidades: o.max ?? 8 } : {}),
          extras: [structuredClone(material)],
          ativo: true,
        }),
      ),
      {
        id: t.fix.id || "fix",
        nome: t.fix.name,
        categoria: "handyman",
        descricao: "Repairs and small jobs, sold by time. Tools included, no call out fee, materials never included.",
        osTitle: t.fix.osTitle,
        cobranca: "pacotes",
        pacotes: t.fix.packages.map((p) => ({
          id: p.id,
          tipo: p.id === "half" ? "half_day" : p.id === "day" ? "full_day" : "hours",
          rotulo: p.label,
          detalhe: p.detail,
          horas: p.minutes / 60,
          preco: p.price,
        })),
        extras: [],
        ativo: true,
      },
      ...t.cert.items.map(
        (c): ServicoV2 => ({
          id: c.id,
          nome: c.label,
          categoria: "certificate",
          descricao: c.detail,
          osTitle: c.osTitle,
          cobranca: c.prices ? "por_tamanho" : "fixo",
          ...(c.prices ? { precosPorTamanho: { ...c.prices } } : { preco: c.price ?? null }),
          extras: [],
          ativo: true,
          site: { short: c.short, valid: c.valid },
        }),
      ),
    ],
  };
}

/** Aceita os dois formatos guardados no banco e devolve sempre a lista. */
export function comoLista(doc: unknown): TabelaV2 {
  const d = doc as { formato?: number };
  return d?.formato === 2 ? (doc as TabelaV2) : deV1(doc as TabelaDePrecos);
}

// ── da lista para o formato 1 (o que o site e o checkout leem) ──────────────

/** O que vai para o site; o resto é "Harvey only". */
export function vaiProSite(s: ServicoV2): boolean {
  if (!s.ativo) return false;
  if (s.categoria === "cleaning") return s.cobranca === "por_tamanho";
  if (s.categoria === "painting") return s.cobranca === "fixo" || s.cobranca === "por_unidade";
  if (s.categoria === "handyman") return (s.pacotes ?? []).some((p) => PACOTE_NO_SITE.has(p.tipo) && p.horas);
  if (s.categoria === "certificate") return true;
  return false;
}

export function paraSite(t: TabelaV2): TabelaDePrecos {
  const ativos = t.servicos.filter(vaiProSite);
  const limpeza = ativos.filter((s) => s.categoria === "cleaning");
  const pintura = ativos.filter((s) => s.categoria === "painting");
  const reparo = ativos.find((s) => s.categoria === "handyman");
  const extrasDeLimpeza = new Map<string, Extra>();
  for (const s of limpeza) for (const e of s.extras) if (!extrasDeLimpeza.has(e.id)) extrasDeLimpeza.set(e.id, e);
  const material = pintura.flatMap((s) => s.extras).find((e) => e.id === "materials") ?? pintura.flatMap((s) => s.extras)[0];
  return {
    formato: 1,
    moeda: t.moeda,
    sizes: t.tamanhos,
    bathroomOptions: t.bathroomOptions,
    defaultCleanKind: t.limpeza.padrao,
    clean: {
      id: "clean",
      verb: "Clean",
      includedBathrooms: t.limpeza.banheirosInclusos,
      ovenIncluded: true,
      productsIncluded: true,
      teamOfTwoFromSize: t.limpeza.equipeDeDoisAPartir,
      extraBathroomSteps: t.limpeza.banheiroExtra,
      extras: [...extrasDeLimpeza.values()].map((e) => ({ id: e.id, label: e.rotulo, detail: e.detalhe, price: e.preco, ...(e.porUnidade ? { unit: "room", max: e.max ?? 8 } : {}) })),
      kinds: limpeza.map((s) => ({
        id: s.id,
        name: s.nome,
        short: s.site?.short || s.nome,
        tiny: s.site?.tiny || s.nome,
        hint: s.site?.hint || "",
        detail: s.descricao,
        prices: { ...(s.precosPorTamanho ?? {}) },
        osTitle: s.osTitle,
      })),
    },
    paint: {
      id: "paint",
      verb: "Paint",
      name: "Fresh coat",
      osTitle: pintura[0]?.osTitle || "Painter",
      options: pintura.map((s) => ({
        id: s.id,
        label: s.nome,
        detail: s.descricao,
        price: s.preco ?? 0,
        ...(s.cobranca === "por_unidade" ? { unit: s.unidade || "room", max: s.maxUnidades ?? 8 } : {}),
      })),
      materials: { id: material?.id ?? "materials", label: material?.rotulo ?? "Paint and materials pack", detail: material?.detalhe ?? "", price: material?.preco ?? 0 },
    },
    fix: {
      id: "fix",
      verb: "Fix",
      name: reparo?.nome || "Repairs",
      osTitle: reparo?.osTitle || "General Maintenance",
      toolsIncluded: true,
      packages: (reparo?.pacotes ?? [])
        .filter((p) => PACOTE_NO_SITE.has(p.tipo) && p.horas)
        .map((p) => ({ id: p.id, label: p.rotulo, detail: p.detalhe, minutes: Math.round((p.horas ?? 0) * 60), price: p.preco })),
      tasks: t.tarefas,
    },
    cert: {
      id: "cert",
      verb: "Certify",
      name: "Landlord certificates",
      items: ativos
        .filter((s) => s.categoria === "certificate")
        .map((s) => ({
          id: s.id,
          label: s.nome,
          short: s.site?.short || s.nome,
          detail: s.descricao,
          valid: s.site?.valid || "",
          osTitle: s.osTitle,
          ...(s.cobranca === "por_tamanho" ? { prices: { ...(s.precosPorTamanho ?? {}) } } : { price: s.preco ?? null }),
        })),
    },
  };
}

// ── o que só o Harvey vende (o site ainda não) ──────────────────────────────

const gbp = (n: number | null | undefined) => (n == null ? "quote" : `£${n}`);

export function soDoHarvey(t: TabelaV2): string[] {
  const out: string[] = [];
  for (const s of t.servicos.filter((x) => x.ativo)) {
    const fora = (s.pacotes ?? []).filter((p) => !PACOTE_NO_SITE.has(p.tipo) || !p.horas);
    for (const p of fora) out.push(`${s.nome}: ${p.rotulo} ${gbp(p.preco)}${p.detalhe ? ` (${p.detalhe})` : ""}`);
    if (!vaiProSite(s) && s.categoria !== "handyman") {
      const preco = s.cobranca === "por_tamanho" ? Object.entries(s.precosPorTamanho ?? {}).filter(([, v]) => v != null).map(([k, v]) => `${k}: £${v}`).join(", ") : `${gbp(s.preco)}${s.unidade ? ` per ${s.unidade}` : ""}`;
      out.push(`${s.nome}: ${preco}. ${s.descricao}`);
    }
    const extrasFora = s.categoria === "cleaning" ? [] : s.categoria === "painting" ? s.extras.filter((e) => e.id !== "materials") : s.extras;
    for (const e of extrasFora) out.push(`${s.nome} extra: ${e.rotulo} ${gbp(e.preco)}${e.porUnidade ? " each" : ""}`);
  }
  return out;
}

// ── validação da lista (o site também valida o que recebe) ──────────────────

export function validarV2(t: TabelaV2): string[] {
  const erros: string[] = [];
  const ids = new Set<string>();
  const preco = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000;
  for (const s of t.servicos) {
    if (!s.nome?.trim()) erros.push("Every service needs a name");
    if (!s.id || ids.has(s.id)) erros.push(`Duplicate or missing service id (${s.nome})`);
    ids.add(s.id);
    if (!s.osTitle?.trim()) erros.push(`${s.nome}: pick the type of work`);
    if (!s.ativo) continue;
    if (s.cobranca === "fixo" && s.preco != null && !preco(s.preco)) erros.push(`${s.nome}: price must be above £0`);
    if (s.cobranca === "por_unidade" && !preco(s.preco)) erros.push(`${s.nome}: price per unit must be above £0`);
    if (s.cobranca === "pacotes" && !(s.pacotes ?? []).length) erros.push(`${s.nome}: add at least one way to charge`);
    for (const p of s.pacotes ?? []) if (!preco(p.preco) || !p.rotulo?.trim()) erros.push(`${s.nome}: "${p.rotulo || p.tipo}" needs a name and a price`);
    for (const e of s.extras) if (!preco(e.preco) || !e.rotulo?.trim()) erros.push(`${s.nome}: extra "${e.rotulo || "?"}" needs a name and a price`);
  }
  // O site usa um preço só por extra de limpeza: o mesmo extra não pode ter dois preços.
  const precoDoExtra = new Map<string, { preco: number; servico: string }>();
  for (const s of t.servicos.filter((x) => x.ativo && x.categoria === "cleaning")) {
    for (const e of s.extras) {
      const ja = precoDoExtra.get(e.rotulo.trim().toLowerCase());
      if (ja && ja.preco !== e.preco) erros.push(`Cleaning extra "${e.rotulo}" is £${ja.preco} in ${ja.servico} and £${e.preco} in ${s.nome}: the website uses one price per extra`);
      else precoDoExtra.set(e.rotulo.trim().toLowerCase(), { preco: e.preco, servico: s.nome });
    }
  }
  return erros;
}
