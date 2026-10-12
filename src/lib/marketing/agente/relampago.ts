/**
 * Promoção relâmpago: 36 horas, e-mail e WhatsApp, fechando no site.
 *
 * A ordem do dia de abertura, e por que é esta:
 *
 *   1. O código tem que funcionar no CHECKOUT antes de qualquer mensagem sair.
 *      Quem confere é o próprio site (`/api/b2c/promo`), não a Stripe: é o site
 *      que o cliente vai usar, e ele recusa cupom que a Stripe aceita (cliente
 *      específico, produto específico). Se o site recusa, o agente não manda
 *      nada e avisa.
 *   2. O e-mail é um broadcast da Resend para a lista do clube, às 11h.
 *   3. O WhatsApp sai 4 horas depois, só para os números mais quentes e com
 *      teto, pelo número do Zendesk: a resposta do cliente cai na conversa que
 *      o Harvey e a equipe já atendem.
 *
 * O template do WhatsApp é um só para todo relâmpago (`fixfy_flash_offer`): o
 * nome, a oferta, o código e o prazo são variáveis. Template novo a cada
 * promoção seria uma aprovação da Meta a cada promoção.
 */

import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { custoPorMensagem } from "@/lib/marketing/campanha";
import { enviarTemplatePeloZendesk, zendeskWhatsAppConfigurado } from "@/lib/harvey-wa/template-zendesk";
import {
  HORA_DO_WHATSAPP_RELAMPAGO, SITE, abreEm, fechaEm, horaDeLondres, linkDoRelampago, type Relampago,
} from "./calendario";
import { htmlDoBroadcast, remetente } from "./clube";
import { publico } from "./lista";
import { agendarBroadcast, broadcasts, criarBroadcast } from "./resend";

export const campanhaDoRelampago = (r: Relampago) => `flash:${r.slug}`;
export const nomeDoBroadcastRelampago = (r: Relampago) => `Fixfy Flash · ${r.dia} · ${r.codigo}`;

const templateDoWhatsApp = () => process.env.MARKETING_FLASH_WA_TEMPLATE?.trim() || "fixfy_flash_offer";

/** Quantos WhatsApp por relâmpago. Marketing na Meta custa por mensagem (~4p): 150 são ~£6. */
export function tetoDoWhatsApp(): number {
  const n = Number(process.env.MARKETING_FLASH_WA_TETO?.trim());
  return Number.isFinite(n) && n >= 0 ? n : 150;
}

/** O texto submetido à Meta. Mudar aqui não muda o template aprovado. */
export const TEMPLATE_DO_WHATSAPP = {
  nome: "fixfy_flash_offer",
  idioma: "en_GB",
  categoria: "MARKETING",
  corpo: "Hi {{1}}, it's the Fixfy team. For the next 36 hours only: {{2}}.\n\nUse code {{3}} at getfixfy.com before {{4}}. Fixed prices, VAT included, vetted and insured pros.\n\nReply here with any question.",
  botoes: [
    { tipo: "URL", texto: "Book online", url: `${SITE}/?promo={{1}}` },
    { tipo: "QUICK_REPLY", texto: "Stop promotions" },
  ],
} as const;

/* ═══════════════════ O código ═══════════════════ */

/** Pergunta ao site se o código vale, com uma reserva de exemplo (deep clean de 2 quartos). */
export async function codigoValeNoSite(codigo: string): Promise<{ ok: boolean; percentual: number | null; erro?: string }> {
  try {
    const res = await fetch(`${SITE}/api/b2c/promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codigo, selection: { services: ["clean"], size: "2bed", bathrooms: 1, clean: { kind: "deep" } } }),
      signal: AbortSignal.timeout(20_000),
    });
    const dados = (await res.json()) as { promo?: { percentOff?: number | null }; error?: string };
    if (!res.ok || !dados.promo) return { ok: false, percentual: null, erro: dados.error ?? `site respondeu ${res.status}` };
    return { ok: true, percentual: dados.promo.percentOff ?? null };
  } catch (e) {
    return { ok: false, percentual: null, erro: String((e as Error).message ?? e) };
  }
}

/**
 * Garante o código no checkout. Cria na Stripe do site quando falta (a chave é
 * a `STRIPE_PROMO_SECRET_KEY`, restrita a cupons) e confere de novo no site.
 * Devolve o motivo quando não dá: sem código que funciona, nada sai.
 */
export async function garantirCodigo(r: Relampago, aplicar: boolean): Promise<{ ok: boolean; criado: boolean; motivo?: string }> {
  const antes = await codigoValeNoSite(r.codigo);
  if (antes.ok) {
    if (antes.percentual !== r.percentual) return { ok: false, criado: false, motivo: `o site dá ${antes.percentual}% em ${r.codigo}, a mensagem promete ${r.percentual}%` };
    return { ok: true, criado: false };
  }
  const chave = process.env.STRIPE_PROMO_SECRET_KEY?.trim();
  if (!chave) return { ok: false, criado: false, motivo: `${r.codigo} não existe na Stripe e falta a STRIPE_PROMO_SECRET_KEY para criar (${antes.erro})` };
  if (!aplicar) return { ok: true, criado: false, motivo: `${r.codigo} ainda não existe: será criado na abertura` };

  const stripe = new Stripe(chave, { typescript: true });
  const expira = Math.floor(fechaEm(r).getTime() / 1000);
  const metadata = { origem: "agente-marketing", relampago: r.slug };
  const cupom = await stripe.coupons.create({ percent_off: r.percentual, duration: "once", redeem_by: expira, max_redemptions: r.maxUsos, name: r.nome, metadata });
  await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: cupom.id }, code: r.codigo, expires_at: expira, max_redemptions: r.maxUsos, metadata });

  const depois = await codigoValeNoSite(r.codigo);
  if (!depois.ok) return { ok: false, criado: true, motivo: `criado na Stripe, mas o site recusa: ${depois.erro}` };
  return { ok: true, criado: true };
}

/* ═══════════════════ E-mail ═══════════════════ */

const prazoPorExtenso = "Thursday at midnight";

export function htmlDoRelampago(r: Relampago): string {
  return htmlDoBroadcast({
    preheader: r.email.preheader,
    etiqueta: "36 hours only",
    titulo: r.email.titulo,
    blocos: r.email.blocos,
    oferta: { codigo: r.codigo, valor: `${r.percentual}% off`, sobre: "any Fixfy service, applied for you at checkout", validade: "Thursday, midnight" },
    cta: { texto: r.email.cta, url: linkDoRelampago(r, "email") },
  });
}

async function emailDoRelampago(r: Relampago, segmento: string, agora: Date): Promise<string> {
  const nome = nomeDoBroadcastRelampago(r);
  const existente = (await broadcasts()).find((b) => b.name === nome);
  if (existente && (existente.scheduled_at || existente.sent_at || existente.status !== "draft")) return "já estava agendado";
  const { from, reply_to } = remetente();
  const id = existente?.id ?? (await criarBroadcast({ segment_id: segmento, from, reply_to, subject: r.email.assunto, html: htmlDoRelampago(r), name: nome })).id;
  const quando = abreEm(r);
  await agendarBroadcast(id, quando.getTime() > agora.getTime() + 2 * 60 * 1000 ? quando : undefined);
  return quando.getTime() > agora.getTime() ? `agendado para ${quando.toISOString()}` : "enviado agora";
}

/* ═══════════════════ WhatsApp ═══════════════════ */

/** Põe na fila os números mais quentes (quem comprou primeiro), até o teto. Rodar de novo não duplica. */
async function filaDoWhatsApp(r: Relampago, aplicar: boolean): Promise<{ alcancaveis: number; naFila: number }> {
  const { alvos } = await publico({ ignorarJobRecente: false });
  const comNumero = alvos.filter((a) => a.phone);
  const escolhidos = comNumero.slice(0, tetoDoWhatsApp());
  if (!aplicar || !escolhidos.length) return { alcancaveis: comNumero.length, naFila: escolhidos.length };

  const quando = horaDeLondres(r.dia, HORA_DO_WHATSAPP_RELAMPAGO).toISOString();
  const linhas = escolhidos.map((a) => ({
    campanha: campanhaDoRelampago(r), client_id: a.clientId, grupo: a.email ? "os_dois" : "so_numero", canal: "whatsapp",
    passo: "wa_oferta", email: null, phone: a.phone, primeiro_nome: a.nome, agendado_para: quando,
  }));
  const sb = createServiceClient();
  const { error } = await sb.from("marketing_queue").upsert(linhas, { onConflict: "campanha,passo,client_id", ignoreDuplicates: true });
  if (error) throw new Error(`fila do relâmpago: ${error.message}`);
  return { alcancaveis: comNumero.length, naFila: escolhidos.length };
}

export type ResultadoDaAbertura = { relampago: string; codigo: string; ok: boolean; motivo?: string; codigoCriado?: boolean; email?: string; whatsapp?: { alcancaveis: number; naFila: number } };

/** O dia de abertura inteiro. Sem `aplicar` diz o que faria. */
export async function abrirRelampago(r: Relampago, opcoes: { aplicar: boolean; segmento: string | null; agora?: Date }): Promise<ResultadoDaAbertura> {
  const agora = opcoes.agora ?? new Date();
  const res: ResultadoDaAbertura = { relampago: r.slug, codigo: r.codigo, ok: false };
  if (agora.getTime() > fechaEm(r).getTime() - 6 * 60 * 60 * 1000) return { ...res, motivo: "tarde demais: faltam menos de 6 horas para fechar" };

  const codigo = await garantirCodigo(r, opcoes.aplicar);
  res.codigoCriado = codigo.criado;
  if (!codigo.ok) return { ...res, motivo: codigo.motivo };
  if (codigo.motivo) res.motivo = codigo.motivo;

  res.whatsapp = await filaDoWhatsApp(r, opcoes.aplicar);
  if (opcoes.aplicar) {
    if (!opcoes.segmento) return { ...res, motivo: "a lista da Resend ainda não existe" };
    res.email = await emailDoRelampago(r, opcoes.segmento, agora);
  } else res.email = `seria agendado para ${abreEm(r).toISOString()}`;
  res.ok = true;
  return res;
}

export type ResultadoDoWhatsApp = { relampago: string | null; enviados: number; falhas: number; pulados: number; parou: string | null };

/**
 * Manda o que está vencido na fila do relâmpago que está no ar. Três falhas
 * seguidas param a volta e devolvem o resto para a fila: é o sinal de template
 * não aprovado ou número com problema, e insistir só piora a nota do número.
 */
export async function voltaDoWhatsApp(r: Relampago | null, opcoes: { aplicar: boolean; max?: number }): Promise<ResultadoDoWhatsApp> {
  const res: ResultadoDoWhatsApp = { relampago: r?.slug ?? null, enviados: 0, falhas: 0, pulados: 0, parou: null };
  if (!r) { res.parou = "nenhum relâmpago no ar"; return res; }
  if (!zendeskWhatsAppConfigurado()) { res.parou = "WhatsApp do Zendesk sem credenciais (SUNSHINE_*)"; return res; }
  const horaLondres = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()));
  if (horaLondres < 10 || horaLondres >= 19) { res.parou = "fora da janela (10h às 19h de Londres)"; return res; }

  const sb = createServiceClient();
  const campanha = campanhaDoRelampago(r);
  const { data: vencidas, error } = await sb
    .from("marketing_queue")
    .select("id, client_id, phone, primeiro_nome")
    .eq("campanha", campanha).eq("canal", "whatsapp").eq("status", "planejado")
    .lte("agendado_para", new Date().toISOString())
    .order("criado_em", { ascending: true })
    .limit(opcoes.max ?? tetoDoWhatsApp());
  if (error) throw new Error(error.message);
  if (!opcoes.aplicar) { res.pulados = vencidas?.length ?? 0; res.parou = "ensaio"; return res; }

  // Quem pediu para sair entre a montagem da fila e agora não recebe.
  const { data: bloqueio } = await sb.from("whatsapp_suppressions").select("phone").in("phone", (vencidas ?? []).map((v) => v.phone).slice(0, 200));
  const fora = new Set((bloqueio ?? []).map((b) => b.phone));
  let seguidas = 0;

  for (const linha of vencidas ?? []) {
    if (fora.has(linha.phone)) {
      await sb.from("marketing_queue").update({ status: "pulado", erro: "saiu da lista" }).eq("id", linha.id);
      res.pulados++;
      continue;
    }
    const { data: minha } = await sb.from("marketing_queue").update({ status: "reservado", reservado_em: new Date().toISOString() }).eq("id", linha.id).eq("status", "planejado").select("id");
    if (!minha?.length) continue;
    try {
      const envio = await enviarTemplatePeloZendesk({
        to: linha.phone,
        name: templateDoWhatsApp(),
        language: TEMPLATE_DO_WHATSAPP.idioma,
        bodyParams: [linha.primeiro_nome || "there", r.linha, r.codigo, prazoPorExtenso],
        buttonUrlParam: r.codigo,
      });
      const agora = new Date().toISOString();
      await sb.from("marketing_queue").update({ status: "enviado", enviado_em: agora, provider_id: envio.messageId || null, custo_estimado: custoPorMensagem("whatsapp") }).eq("id", linha.id);
      await sb.from("marketing_touches").insert({ phone: linha.phone, client_id: linha.client_id, campaign: `${campanha}:wa_oferta`, channel: "whatsapp", segment: "b2c", subject: r.codigo, provider_id: envio.messageId || null, sent_at: agora });
      res.enviados++;
      seguidas = 0;
    } catch (e) {
      const erro = String((e as Error).message ?? e).slice(0, 300);
      seguidas++;
      res.falhas++;
      if (seguidas >= 3) {
        await sb.from("marketing_queue").update({ status: "planejado", reservado_em: null, erro }).eq("id", linha.id);
        res.parou = `3 falhas seguidas: ${erro}`;
        break;
      }
      await sb.from("marketing_queue").update({ status: "falhou", erro }).eq("id", linha.id);
    }
  }
  return res;
}
