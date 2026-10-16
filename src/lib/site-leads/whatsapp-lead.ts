/**
 * O passo 4 da reserva abandonada: um WhatsApp às 15h do dia do e-mail 3, com
 * o mesmo código de 10%.
 *
 * Template `fixfy_booking_recovery_v1` (en_GB, MARKETING), aprovado pela Meta
 * em 28/09/2026:
 *
 *   Hi {{1}}, your {{2}} price is still saved at Fixfy, and your 10% code {{3}}
 *   is ready to use. Tap below to finish your booking in about 2 minutes, or
 *   reply here with any question.
 *   [Finish my booking] https://www.getfixfy.com/{{1}}    [Stop promotions]
 *
 * O link cai na HOME com o preço (`?s=clean&kind=deep&size=2&promo=…`), não no
 * /book: o /book de hoje perde o `promo` no caminho. Conserto, pintura e
 * certificado não têm cartão na home, então vão pelo link da própria reserva.
 *
 * Quem responde cai no Zendesk (o app dele é inscrito na WABA) num ticket
 * `via:whatsapp`; "Stop promotions" o webhook do OS bloqueia na hora.
 */

import { primeiroNome } from "@/lib/marketing/whatsapp";
import { buscarTemplate, saudeDoNumero, toWhatsAppNumber, whatsappConfigured, WhatsAppError } from "@/lib/whatsapp/cloud";

export const CAMPANHA_WHATSAPP = "reserva-abandonada:whatsapp4";
const TEMPLATE_PADRAO = "fixfy_booking_recovery_v1";
const IDIOMA_PADRAO = "en_GB";

/** WhatsApp atrasado mais que isto não sai: a sequência fecha sem ele. */
export const VALIDADE_DO_WHATSAPP_HORAS = 48;

export function templateDaRetomada(): { nome: string; idioma: string } {
  return {
    nome: process.env.RESERVA_ABANDONADA_WA_TEMPLATE?.trim() || TEMPLATE_PADRAO,
    idioma: process.env.RESERVA_ABANDONADA_WA_LANG?.trim() || IDIOMA_PADRAO,
  };
}

/** O passo 4 existe: WhatsApp configurado e ninguém desligou (RESERVA_ABANDONADA_WHATSAPP=off). */
export function whatsappDaRetomadaLigado(): boolean {
  return whatsappConfigured() && process.env.RESERVA_ABANDONADA_WHATSAPP?.trim().toLowerCase() !== "off";
}

/** Este lead tem passo 4: número que a Meta aceita e o canal ligado. */
export function leadTemWhatsApp(phone: string | null | undefined): boolean {
  return whatsappDaRetomadaLigado() && toWhatsAppNumber(phone) != null;
}

const UTM: Array<[string, string]> = [
  ["utm_source", "whatsapp"],
  ["utm_medium", "recovery"],
  ["utm_campaign", "reserva_abandonada"],
];

type LeadDoLink = { selection?: unknown; resume_url?: string | null };

/**
 * O fim do link do botão (o template tem `https://www.getfixfy.com/{{1}}`).
 *
 * Só limpeza: o cartão da home, `?s=clean&kind=deep&size=2&promo=…&utm_…`
 * (end of tenancy é o padrão do site e não vai no link). O resto: o caminho e a
 * query do link da reserva (`book?…&pc=…`), mais o código e a origem.
 */
export function sufixoDoBotao(l: LeadDoLink, codigo: string): string {
  const sel = (l.selection && typeof l.selection === "object" ? l.selection : {}) as {
    services?: unknown;
    size?: unknown;
    clean?: { kind?: unknown } | null;
  };
  const servicos = Array.isArray(sel.services) ? sel.services.map(String) : [];

  if (servicos.length > 0 && servicos.every((s) => s === "clean")) {
    const q = new URLSearchParams();
    q.set("s", "clean");
    const kind = String(sel.clean?.kind ?? "");
    if (/^[a-z]+$/.test(kind) && kind !== "eot") q.set("kind", kind);
    const size = String(sel.size ?? "");
    if (/^(studio|\d)$/.test(size)) q.set("size", size);
    q.set("promo", codigo);
    for (const [k, v] of UTM) q.set(k, v);
    return `?${q.toString()}`;
  }

  let u: URL;
  try {
    u = new URL(l.resume_url || "https://www.getfixfy.com/");
  } catch {
    u = new URL("https://www.getfixfy.com/");
  }
  // O botão só abre o nosso site: link de outro domínio vira a home.
  if (!/(^|\.)getfixfy\.com$/i.test(u.hostname)) u = new URL("https://www.getfixfy.com/");
  u.searchParams.set("promo", codigo);
  for (const [k, v] of UTM) u.searchParams.set(k, v);
  return `${u.pathname.replace(/^\/+/, "")}${u.search}`;
}

/**
 * {{1}} primeiro nome ("there" se não der), {{2}} o serviço como o site
 * escreveu ("2 bed deep clean"), {{3}} o código. A Meta recusa parâmetro com
 * quebra de linha ou espaço em excesso.
 */
export function parametrosDoCorpo(l: { full_name?: string | null; service_label?: string | null }, codigo: string): string[] {
  const servico = String(l.service_label ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "booking";
  return [primeiroNome(l.full_name), servico, codigo];
}

export type TipoDeErro = "template" | "ritmo" | "numero" | "outro";

/** Template ainda não aprovado, pausado ou desligado: espera, sem gritar. */
const ERROS_DE_TEMPLATE = [132001, 132015, 132016];
/** A Meta segurando por ritmo ou qualidade: devolve e tenta depois. */
const ERROS_DE_RITMO = [131048, 131049, 130429, 80007, 368, 131056];
/** O número não recebe (sem WhatsApp, ou é o próprio remetente): fecha sem WhatsApp. */
const ERROS_DE_NUMERO = [131026, 131021];

export function tipoDoErro(err: unknown): TipoDeErro {
  if (!(err instanceof WhatsAppError)) return "outro";
  const code = err.code ?? 0;
  if (ERROS_DE_TEMPLATE.includes(code)) return "template";
  if (ERROS_DE_RITMO.includes(code)) return "ritmo";
  if (ERROS_DE_NUMERO.includes(code)) return "numero";
  if (!err.code && /inválido/.test(err.message)) return "numero";
  return "outro";
}

export type ProntoParaWhatsApp = { ok: true; botaoUrl: number } | { ok: false; motivo: string };

/**
 * O que a volta confere UMA vez, antes do primeiro WhatsApp: o template está
 * aprovado (e em que posição está o botão de link), e o número está GREEN,
 * como nas campanhas: é o mesmo número da confirmação de visita.
 *
 * Sem WHATSAPP_WABA_ID não dá para ler o template; aí vai o botão 0 e o erro
 * da própria Meta (132001 etc.) é quem segura.
 */
export function verificadorDoWhatsApp(): () => Promise<ProntoParaWhatsApp> {
  let pronto: Promise<ProntoParaWhatsApp> | null = null;
  return () => (pronto ??= verificar());
}

async function verificar(): Promise<ProntoParaWhatsApp> {
  const { nome, idioma } = templateDaRetomada();
  let botaoUrl = 0;
  if (process.env.WHATSAPP_WABA_ID?.trim()) {
    try {
      const t = await buscarTemplate(nome, idioma);
      if (!t) return { ok: false, motivo: `template ${nome} (${idioma}) not found in the WABA` };
      if (t.status !== "APPROVED") return { ok: false, motivo: `template ${nome} is ${t.status}, not APPROVED yet` };
      const i = t.buttons.findIndex((b) => b.type === "URL");
      if (i < 0) return { ok: false, motivo: `template ${nome} has no link button` };
      botaoUrl = i;
    } catch {
      // Ler o template falhou: segue com o botão 0 e a resposta da Meta decide.
    }
  }
  try {
    const saude = await saudeDoNumero();
    if (saude.qualidade !== "GREEN") return { ok: false, motivo: `number quality is ${saude.qualidade}, marketing paused until GREEN` };
  } catch (err) {
    return { ok: false, motivo: `could not read the number quality (${err instanceof Error ? err.message : "error"})` };
  }
  return { ok: true, botaoUrl };
}
