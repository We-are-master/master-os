/**
 * A resposta do parceiro a uma reclamação: o que ele oferece, e quando.
 *
 * Até aqui o formulário pedia texto livre ("How you'll resolve this") e duas
 * datas, a segunda opcional. Texto livre não fecha o ciclo: cada parceiro
 * escreve de um jeito, e o escritório tinha que ler, interpretar e redigitar
 * antes de falar com o cliente. Por isso o que volta agora é ESCOLHA, não
 * redação — desconto ou voltar lá — e o que a gente oferece ao cliente sai
 * montado sozinho.
 *
 * Regra do dono (09/09/2026): sempre DUAS janelas quando ele vai voltar. Uma
 * só não é oferta, é imposição, e o cliente que não pode naquele dia devolve a
 * conversa para o começo.
 *
 * Desconto não pede data: ninguém volta. Pedir duas janelas ali seria fingir
 * que existe uma visita e sujar a oferta ao cliente com dia que não importa.
 */
import { normalizarDatasDeRetorno } from "@/lib/job-on-hold-datas-de-retorno";

/** As janelas que o OS já usa no dia do parceiro (dono, 26/08/2026). */
export const SLOTS = ["morning", "afternoon"] as const;
export type Slot = (typeof SLOTS)[number];

export const ROTULO_DO_SLOT: Readonly<Record<Slot, string>> = {
  morning: "Morning (8am to 1pm)",
  afternoon: "Afternoon (1pm to 6pm)",
};

/** O que ele oferece. Duas saídas, e só duas. */
export type Remedio = "revisit" | "discount";

export const ROTULO_DO_REMEDIO: Readonly<Record<Remedio, string>> = {
  revisit: "Go back and put it right",
  discount: "Offer a discount instead",
};

export type Oferta = { data: string; slot: Slot };

export type Resolucao = {
  remedio: Remedio;
  /** Exatamente duas quando `revisit`; vazio quando `discount`. */
  ofertas: Oferta[];
  /** Em libras, quando `discount`; `null` quando `revisit`. */
  descontoGbp: number | null;
  notas: string;
};

export type Veredito =
  | { ok: true; resolucao: Resolucao }
  | { ok: false; erros: string[] };

/** Quantas janelas o parceiro tem que dar quando vai voltar. */
export const JANELAS_EXIGIDAS = 2;

function ehSlot(v: unknown): v is Slot {
  return typeof v === "string" && (SLOTS as readonly string[]).includes(v);
}

function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê o que veio do formulário e diz se dá para agir.
 *
 * Devolve TODOS os erros de uma vez, não o primeiro: o parceiro está no
 * celular, a caminho de outro job, e mandar de volta três vezes seguidas por
 * um campo de cada vez é como se perde uma resposta que já custou 19 tentativas
 * sem nenhuma.
 */
export function lerResolucao(bruto: unknown, hoje: string): Veredito {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const erros: string[] = [];

  const notas = String(o.notes ?? o.notas ?? "").trim();
  if (!notas) erros.push("Tell us what happened before sending.");

  const remedio = String(o.remedy ?? o.remedio ?? "").trim() as Remedio;
  if (remedio !== "revisit" && remedio !== "discount") {
    erros.push("Choose whether you'll go back or offer a discount.");
    return { ok: false, erros };
  }

  if (remedio === "discount") {
    const valor = numero(o.discount_gbp ?? o.descontoGbp);
    if (valor === null || valor <= 0) erros.push("Enter the discount amount in pounds.");
    if (erros.length) return { ok: false, erros };
    return { ok: true, resolucao: { remedio, ofertas: [], descontoGbp: Math.round(valor! * 100) / 100, notas } };
  }

  const cruas = Array.isArray(o.offers ?? o.ofertas) ? ((o.offers ?? o.ofertas) as unknown[]) : [];
  const ofertas: Oferta[] = [];
  const vistas = new Set<string>();
  for (const c of cruas) {
    const item = (c ?? {}) as Record<string, unknown>;
    const data = String(item.date ?? item.data ?? "").trim();
    const slot = item.slot;
    if (!data || !ehSlot(slot)) continue;
    // A mesma trava de data do resto do OS: formato, calendário e passado.
    const { datas } = normalizarDatasDeRetorno([data], hoje);
    if (datas.length === 0) continue;
    const chave = `${datas[0]}|${slot}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    ofertas.push({ data: datas[0]!, slot });
  }

  if (ofertas.length < JANELAS_EXIGIDAS) {
    erros.push(
      ofertas.length === 0
        ? "Give two windows you can really do."
        : "Give a second window: one option is not a choice for the customer.",
    );
  }
  if (erros.length) return { ok: false, erros };

  ofertas.sort((a, b) => (a.data !== b.data ? a.data.localeCompare(b.data) : a.slot.localeCompare(b.slot)));
  return { ok: true, resolucao: { remedio, ofertas: ofertas.slice(0, JANELAS_EXIGIDAS), descontoGbp: null, notas } };
}

/** `2026-09-12` → `Friday 12 September`. O cliente lê dia da semana, não ISO. */
export function dataPorExtenso(ymd: string): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(a!, m! - 1, d!));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  }).format(dt);
}

/**
 * O que sai para o cliente, montado a partir da escolha do parceiro.
 *
 * O parceiro não aparece: quem contratou foi a gente, e a relação com a conta é
 * nossa. Mesma regra da quote, onde o nome de quem passou o trabalho nunca
 * chega a quem executa — aqui é o contrário e vale igual.
 *
 * Sai como RASCUNHO em nota interna, nunca direto ao cliente. Reclamação é a
 * conversa mais cara que a gente tem, e o desenho é o mesmo do preço: a máquina
 * escreve, uma pessoa lê e manda.
 */
export function emailParaOCliente(
  r: Resolucao,
  contexto: { referencia: string; endereco?: string | null },
): string {
  const abertura = [
    "Hi Team,",
    "",
    `Sorry about the issue at ${contexto.endereco?.trim() || "the property"} (${contexto.referencia}).`,
    "",
  ];

  if (r.remedio === "discount") {
    return [
      ...abertura,
      `We've applied a £${r.descontoGbp!.toFixed(2)} reduction to this job rather than send the team back.`,
      "",
      "Let us know if that works and we'll update the invoice.",
      "",
      "Thank you",
    ].join("\n");
  }

  return [
    ...abertura,
    "We'll come back and put it right at no extra cost. Two windows are open:",
    "",
    ...r.ofertas.map((o, i) => `  ${i + 1}. ${dataPorExtenso(o.data)} — ${ROTULO_DO_SLOT[o.slot]}`),
    "",
    "Reply with the one that suits and we'll confirm it.",
    "",
    "Thank you",
  ].join("\n");
}

/** A nota interna: o que o parceiro respondeu, e o texto pronto para enviar. */
export function notaDaResolucao(
  r: Resolucao,
  contexto: { referencia: string; endereco?: string | null; parceiro?: string | null },
): string {
  const oQueEle = r.remedio === "discount"
    ? `£${r.descontoGbp!.toFixed(2)} discount, no revisit`
    : r.ofertas.map((o) => `${dataPorExtenso(o.data)} · ${ROTULO_DO_SLOT[o.slot]}`).join("  |  ");

  return [
    `🔧 Partner answered the complaint on ${contexto.referencia}`,
    "",
    `Partner: ${contexto.parceiro?.trim() || "—"}`,
    `Chose: ${ROTULO_DO_REMEDIO[r.remedio]}`,
    `Offer: ${oQueEle}`,
    "",
    "In their words:",
    r.notas,
    "",
    "── Ready to send to the customer (copy from here) ──",
    emailParaOCliente(r, contexto),
  ].join("\n");
}
