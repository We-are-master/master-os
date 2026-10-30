/**
 * Cotação automática por parceiro (dono, 14/10/2026). As decisões, sem rede:
 * a varredura que fala com Zendesk, Sunshine e banco mora em
 * varredura-cotacao-automatica.ts e só obedece ao que sai daqui.
 *
 *   📝 Needs Quote   contexto completo?  não → pede ao cliente o que falta (uma vez)
 *                                        sim → convida os 3 a 5 melhores, 🟤 Sourcing
 *   6h sem lance     lembra os convidados uma vez, no mesmo canal do convite
 *   24h sem lance    avisa o cliente que segue cotando (sem prazo nenhum),
 *                    nota interna e tag harvey_no_bids (sobe no ⚡ Action Required)
 *   lance chegou     preço = lance com 30% de margem
 *                    até £600 e contexto completo → manda ao cliente, 🟠 Awaiting approval,
 *                    tag quote_sent_to_customer (o trigger "Quote Sent — Send to OS"
 *                    leva a quote para awaiting_customer)
 *                    acima disso ou contexto incompleto → 🟢 Ready to send com nota
 *
 * O estado mora nas tags do ticket (harvey_aq_*), como nas outras réguas daqui.
 * A cobrança da quote enviada é do followup-quotes.ts e não se repete aqui.
 */
import { MARGEM_MINIMA } from "./desconto";
import { precoDeVendaDoLance } from "@/lib/quotes/lance-para-proposta";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { gbp, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { fraseDePagamentoDaCotacao, servicoCurto } from "@/lib/zendesk-quote-sent";

/** Pedimos ao cliente o que faltava. */
export const TAG_PEDIU_CONTEXTO = "harvey_aq_asked_context";
/** Os parceiros foram convidados por esta régua: daqui em diante ela acompanha o ticket. */
export const TAG_CONVIDOU = "harvey_aq_invited";
/** Os convidados foram lembrados (6h). */
export const TAG_LEMBROU_PARCEIROS = "harvey_aq_partner_chase";
/** Ninguém cotou em 24h. Mesmo nome da varredura de lances: o ⚡ Action Required já lê esta. */
export const TAG_SEM_LANCE = "harvey_no_bids";
/** Quote saiu para o cliente sozinha. Dispara o trigger "Quote Sent — Send to OS". */
export const TAG_QUOTE_ENVIADA = "quote_sent_to_customer";
/** Preço pronto esperando uma pessoa (🟢 Ready to send). */
export const TAG_PARA_REVISAR = "harvey_aq_review";
/** Nada mais a fazer nesta régua. */
export const TAG_FIM = "harvey_aq_done";

export const HORAS_LEMBRAR_PARCEIROS = 6;
export const LIMITE_ENVIO_AUTOMATICO_GBP = 600;

export type Falta = "service" | "postcode" | "address" | "scope" | "photos";

export type ContextoDaCotacao = {
  servico: string | null;
  postcode: string | null;
  endereco: string | null;
  escopo: string | null;
  fotos: number;
};

/** Escopo com menos que isso é "fix the door": o parceiro não consegue cotar. */
export const ESCOPO_MINIMO = 25;

/**
 * Endereço completo é rua com número, não só o postcode. "NW2 6XJ" sozinho
 * (o que o lead do Checkatrade traz) tem dígito mas não diz qual casa.
 */
export function enderecoCompleto(endereco: string | null | undefined): boolean {
  const resto = String(endereco ?? "").replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, " ");
  return /\b\d{1,4}[a-z]?\b/i.test(resto) && /[a-z]{3,}/i.test(resto.replace(/\b(flat|apt|apartment|unit)\b/gi, ""));
}

/**
 * O cliente respondeu com o endereço no WhatsApp ou no e-mail: a linha que tem
 * postcode e número de casa vira o endereço. A mais recente ganha.
 */
export function enderecoNasMensagens(textos: readonly string[]): string | null {
  for (let i = textos.length - 1; i >= 0; i--) {
    for (const linha of String(textos[i] ?? "").split(/\n+/)) {
      const l = linha.trim();
      if (l.length > 120 || !extractUkPostcode(l)) continue;
      if (enderecoCompleto(l)) return l.replace(/\s+/g, " ");
    }
  }
  return null;
}

/**
 * "Lead · Carpentry · Chloe Doak · NW2 6XJ" → "Carpentry". O ticket de lead que
 * já falou com o cliente por e-mail tem o assunto da copy ("Your carpentry
 * enquiry · A few details to get started"): dali sai "carpentry".
 */
export function servicoDoAssunto(assunto: string | null | undefined): string | null {
  const a = String(assunto ?? "");
  const daCopy = a.match(/^Your (.+?) enquiry · /i);
  if (daCopy) return daCopy[1]!.trim() || null;
  const partes = a.split("·").map((p) => p.trim());
  if (partes.length >= 3 && /^lead$/i.test(partes[0]!)) return partes[1] || null;
  return null;
}

/** Quem recebe: o primeiro nome (B2C) ou o público já resolvido (B2B pela conta). */
export type Destinatario = string | Publico;

/** "Hi Chloe," / "Hi there," / "Hi Acme Lettings team,". "there" conta como sem nome. */
export function saudacaoDe(quem: Destinatario): string {
  if (typeof quem !== "string") return saudacao(quem);
  return saudacao({ tipo: "b2c", primeiroNome: /^there$/i.test(quem.trim()) ? "" : quem });
}

export function faltandoNoContexto(c: ContextoDaCotacao): Falta[] {
  const f: Falta[] = [];
  if (!c.servico?.trim()) f.push("service");
  if (!c.postcode?.trim()) f.push("postcode");
  if (!enderecoCompleto(c.endereco)) f.push("address");
  if ((c.escopo?.trim().length ?? 0) < ESCOPO_MINIMO) f.push("scope");
  if (c.fotos < 1) f.push("photos");
  return f;
}

const PEDIDO: Record<Falta, string> = {
  service: "what kind of work you need",
  postcode: "the property postcode",
  address: "the full property address, including the postcode",
  scope: "a short description of the work",
  photos: "a few photos",
};
/** A ordem da copy: fotos antes do endereço. */
const ORDEM_DO_PEDIDO: Falta[] = ["service", "photos", "address", "postcode", "scope"];

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} and ${itens.at(-1)}`;
}

/** Postcode é parte do endereço: pedir os dois soa a formulário. */
function oQuePedir(faltando: readonly Falta[]): string[] {
  const f = faltando.includes("address") ? faltando.filter((x) => x !== "postcode") : [...faltando];
  return ORDEM_DO_PEDIDO.filter((x) => f.includes(x)).map((x) => PEDIDO[x]);
}

/** Copy 22 "More details needed". WhatsApp ou e-mail, texto livre. */
export function textoPedeContexto(quem: Destinatario, faltando: readonly Falta[], servico?: string | null): string {
  const s = servicoCurto(servico);
  const sobre = s ? `Thanks for your enquiry about ${s}.` : "Thanks for your enquiry.";
  return `${saudacaoDe(quem)} ${sobre} Could you send ${juntar(oQuePedir(faltando))}? That will help us put together an accurate quote.`;
}

/** Copy 20, WhatsApp "Quote ready": a quote pronta em texto livre, com o link de aceite. */
export function textoDaQuote(a: {
  nome: Destinatario;
  servico?: string | null;
  total: number;
  referencia?: string | null;
  /** link para aceitar a quote: abre o pagamento da entrada (16/10/2026) */
  link?: string | null;
  /** entrada que o aceite cobra (regra da conta); 0 ou ausente = sem entrada */
  entrada?: number | null;
  /** Datas de início do parceiro já formatadas ("Fri 24 Oct"); o cliente escolhe no link. */
  datas?: string[];
  /** O que o preço cobre (oQueEstaIncluido). Vazio = a frase não aparece. */
  incluido?: string[];
  /** "Materials are included." / "Materials are supplied by you." */
  materiais?: string | null;
}): string {
  const s = servicoCurto(a.servico);
  const datas = (a.datas ?? []).filter(Boolean);
  const pagamento = fraseDePagamentoDaCotacao({ total: a.total, entrada: a.entrada });
  const seguir = a.link
    ? `Review the details and accept here: ${a.link}`
    : "If you’d like to go ahead, just reply and we’ll help with the next step.";
  return [
    `${saudacaoDe(a.nome)} Your quote${s ? ` for ${s}` : ""} is ready: ${gbp(a.total)} for the work described.`,
    a.incluido?.length ? `What's included: ${a.incluido.join("; ")}.` : "",
    a.materiais?.trim() ?? "",
    // Sem ponto colado no link: alguns aparelhos levam o ponto para dentro da URL.
    seguir,
    datas.length ? `The professional can start on ${datas.join(" or ")}${a.link ? ", and you choose the day when you accept" : ""}.` : "",
    pagamento,
    "If you have any questions, just reply.",
    a.referencia?.trim() ? `Reference: ${a.referencia.trim()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type PassoDoLeilao = "lembrar_parceiros" | "precificar" | null;

/**
 * O que fazer num ticket que já teve convite desta régua. Lance chegou ganha
 * de qualquer relógio; sem lance, 6h lembra os parceiros. As 24h (No Bids) e as
 * 48h ("not able to quote" e fecha) são da varredura de lances, para toda quote
 * (processo/quote-sem-lance.ts, dono 23/10/2026): o "still checking" ao cliente saiu.
 */
export function proximoPassoDoLeilao(a: { tags: readonly string[]; horasDesdeConvite: number; temLance: boolean }): PassoDoLeilao {
  if (a.tags.includes(TAG_FIM) || a.tags.includes(TAG_QUOTE_ENVIADA) || a.tags.includes(TAG_PARA_REVISAR)) return null;
  if (a.temLance) return "precificar";
  if (a.horasDesdeConvite >= HORAS_LEMBRAR_PARCEIROS && !a.tags.includes(TAG_LEMBROU_PARCEIROS) && !a.tags.includes(TAG_SEM_LANCE)) return "lembrar_parceiros";
  return null;
}

/** Preço ao cliente: o lance com 30% de margem, arredondado para cima de £5 (mesma conta do lance-para-proposta). */
export function precoDoLance(custo: number): number {
  return precoDeVendaDoLance(custo);
}

export function margemDe(total: number, custo: number): number {
  return total > 0 ? (total - custo) / total : 0;
}

export type DecisaoDeEnvio = { enviar: boolean; motivos: string[] };

export function decidirEnvio(a: {
  total: number;
  custo: number;
  faltando: readonly Falta[];
  /** WhatsApp fora da janela de 24h não aceita texto livre: preço não cabe em template. */
  canalAberto: boolean;
  limite?: number;
}): DecisaoDeEnvio {
  const limite = a.limite ?? LIMITE_ENVIO_AUTOMATICO_GBP;
  const motivos: string[] = [];
  if (!(a.total > 0) || !(a.custo > 0)) motivos.push("no valid price");
  else if (margemDe(a.total, a.custo) < MARGEM_MINIMA - 1e-9) motivos.push(`margin under ${Math.round(MARGEM_MINIMA * 100)}%`);
  if (a.total > limite) motivos.push(`over £${limite}`);
  if (a.faltando.length) motivos.push(`missing ${a.faltando.join(", ")}`);
  if (!a.canalAberto) motivos.push("WhatsApp 24h window closed");
  return { enviar: motivos.length === 0, motivos };
}

export function horaDeLondres(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(d));
}

/**
 * O que o preço cobre, para a quote no WhatsApp (dono, 30/10/2026). A QT-2026-1271
 * saiu como "General Maintenance £360" e a cliente respondeu "There's no detail at
 * all. Materials? Number of shelves?": o lance veio só com o valor, sem descrição.
 *
 * Vem das linhas da quote que dizem algo além do título, ou da descrição de mão de obra
 * do lance. Nada disso = lista vazia, e quem envia não manda (pede o detalhe ao parceiro).
 */
export function oQueEstaIncluido(a: {
  linhas: ReadonlyArray<string | null | undefined>;
  titulos: ReadonlyArray<string | null | undefined>;
  labourDescription?: string | null;
  materialsDescription?: string | null;
  materialsCost?: number | null;
}): { itens: string[]; materiais: string | null } {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const genericos = new Set(
    [...a.titulos, "works as described", "general maintenance", "handyman", "carpenter", "labour"].filter(Boolean).map((t) => norm(String(t))),
  );
  const frase = (t: string) => t.replace(/\s+/g, " ").replace(/[.;\s]+$/, "").trim();
  const dasLinhas = a.linhas.map((l) => frase(String(l ?? ""))).filter((l) => l.length > 3 && !genericos.has(norm(l)));
  const doLance = frase(String(a.labourDescription ?? ""))
    .split(/(?<=[.;])\s+/)
    .map(frase)
    .filter((l) => l.length > 3 && !genericos.has(norm(l)));
  const itens = [...new Set(dasLinhas.length ? dasLinhas : doLance)].slice(0, 6);
  const descMat = String(a.materialsDescription ?? "");
  const materiais =
    Number(a.materialsCost) > 0
      ? "Materials are included."
      : /customer|client|you\b|supplied by|buy/i.test(descMat)
        ? "Materials are supplied by you."
        : null;
  return { itens, materiais };
}
