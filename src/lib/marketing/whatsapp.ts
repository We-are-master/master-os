/**
 * Campanha de WhatsApp para a base própria. Uma porta só, como o e-mail.
 *
 * Decisão do dono em 23/09/2026: todos os números nossos recebem, não só quem
 * comprou. Por isso o risco mora no ritmo e nas travas, não na lista:
 *
 *   1. `deleted_at`, tag `no-marketing`   igual ao e-mail
 *   2. conta de origem                     cliente de Housekeep/Fantastic/
 *                                          imobiliária NUNCA recebe (mesma
 *                                          regra do funil, `contasNossas`)
 *   3. bloqueio do WhatsApp                quem tocou Stop, bloqueou ou não
 *                                          tem WhatsApp
 *   4. bloqueio do e-mail                  quem saiu da lista de e-mail disse
 *                                          não a promoção, não a um canal
 *   5. uma vez por campanha                índice único no banco
 *   6. nada de promoção em cima da visita  job nos últimos 14 dias fica de fora
 *   7. 20 horas de folga                   teve toque de marketing (qualquer
 *                                          canal) nas últimas 20h, fica para
 *                                          a próxima volta
 *   8. teto por dia e janela               200/dia por padrão, 10h-18h de
 *                                          Londres, segunda a sábado
 *   9. qualidade do número                 abaixo de GREEN, para tudo. Este
 *                                          número é o da confirmação da
 *                                          visita e o do botão do site;
 *                                          restrito por denúncia, a operação
 *                                          perde o canal junto com a campanha
 *
 * As respostas caem no Zendesk (app inscrito na WABA). O que ESTE código
 * precisa saber delas (Stop, entrega, número morto) chega pelo webhook próprio
 * em /api/webhooks/whatsapp.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { bloqueados, normalizarEmail } from "./suppressions";
import { contasNossas } from "./lifecycle";
import { saudeDoNumero, sendTemplate, toWhatsAppNumber, whatsappConfigured, WhatsAppError } from "@/lib/whatsapp/cloud";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** O interruptor. Fechado por padrão: deploy não vira disparo. */
export function whatsappMarketingLigado(): boolean {
  return process.env.MARKETING_WHATSAPP?.trim().toLowerCase() === "on";
}

export function campanhaAtual(): { campanha: string; template: string; idioma: string } {
  return {
    campanha: process.env.MARKETING_WHATSAPP_CAMPANHA?.trim() || "wa_limpeza_lancamento_2026_10",
    template: process.env.MARKETING_WHATSAPP_TEMPLATE?.trim() || "fixfy_cleaning_prices",
    idioma: process.env.MARKETING_WHATSAPP_LANG?.trim() || "en_GB",
  };
}

function tetoPorDia(): number {
  const n = Number(process.env.MARKETING_WHATSAPP_POR_DIA?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

const ABRE = 10;
const FECHA = 18;

/** Segunda a sábado, 10h às 18h de Londres. Domingo ninguém quer promoção. */
export function dentroDaJanela(d = new Date()): boolean {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const hora = Number(partes.find((p) => p.type === "hour")?.value);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  return dia !== "Sun" && hora >= ABRE && hora < FECHA;
}

/** O primeiro nome, apresentável. "JOHN SMITH" vira "John"; vazio vira "there". */
export function primeiroNome(nome: string | null | undefined): string {
  const primeiro = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}'-]{2,}$/u.test(primeiro)) return "there";
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** O que conta como "me tira daqui". Só a mensagem inteira, para "stop by at 3pm" não bloquear ninguém. */
export function ehPedidoDeSaida(texto: string | null | undefined): boolean {
  const t = String(texto ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
  return ["stop", "stop promotions", "unsubscribe", "opt out", "optout", "remove me", "stop all"].includes(t);
}

type ClienteBruto = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  source_account_id: string | null;
  last_job_date: string | null;
  created_at: string;
};

export type Alvo = { clientId: string; phone: string; nome: string };

export type ResultadoWhatsApp = {
  ensaio: boolean;
  campanha: string;
  template: string;
  olhados: number;
  alcancaveis: number;
  jaReceberam: number;
  plataforma: number;
  semNumero: number;
  bloqueados: number;
  jobRecente: number;
  tocadosHa20h: number;
  cabemHoje: number;
  enviados: number;
  falhas: Array<{ phone: string; erro: string }>;
  parou: string | null;
  qualidade: string | null;
  amostra: Alvo[];
};

async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
    if ((data ?? []).length < 1000) return todos;
  }
}

/**
 * Quem recebe, já na ordem: quem comprou primeiro (conhece a marca, denuncia
 * menos), depois o lead mais novo. A ordem importa porque o teto do dia deixa
 * entrar poucos por vez, e os primeiros dias decidem a qualidade do número.
 */
export async function montarPublico(campanha: string): Promise<{ alvos: Alvo[]; res: Omit<ResultadoWhatsApp, "ensaio" | "template" | "cabemHoje" | "enviados" | "falhas" | "parou" | "qualidade" | "amostra"> }> {
  const sb = createServiceClient();
  const nossas = contasNossas();

  const clientes = await paginar<ClienteBruto>((de, ate) =>
    sb
      .from("clients")
      .select("id, full_name, email, phone, tags, source_account_id, last_job_date, created_at")
      .is("deleted_at", null)
      .not("phone", "is", null)
      .order("last_job_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(de, ate),
  );

  const res = { campanha, olhados: clientes.length, alcancaveis: 0, jaReceberam: 0, plataforma: 0, semNumero: 0, bloqueados: 0, jobRecente: 0, tocadosHa20h: 0 };

  // Listas inteiras em memória: `in(...)` com milhares de valores estoura a URL
  // do PostgREST ("URI too long", ver suppressions.ts).
  const [bloqueioWa, jaNaCampanha, toquesRecentes] = await Promise.all([
    paginar<{ phone: string }>((de, ate) => sb.from("whatsapp_suppressions").select("phone").range(de, ate)),
    paginar<{ phone: string }>((de, ate) =>
      sb.from("marketing_touches").select("phone").eq("channel", "whatsapp").eq("campaign", campanha).range(de, ate),
    ),
    paginar<{ client_id: string | null; phone: string | null; email: string | null }>((de, ate) =>
      sb
        .from("marketing_touches")
        .select("client_id, phone, email")
        .gte("sent_at", new Date(Date.now() - 20 * HORA_MS).toISOString())
        .range(de, ate),
    ),
  ]);
  const barradoWa = new Set(bloqueioWa.map((b) => b.phone));
  const recebeu = new Set(jaNaCampanha.map((t) => t.phone));
  const tocadoCliente = new Set(toquesRecentes.map((t) => t.client_id).filter(Boolean) as string[]);
  const tocadoFone = new Set(toquesRecentes.map((t) => t.phone).filter(Boolean) as string[]);

  const emails = clientes.map((c) => normalizarEmail(c.email)).filter(Boolean) as string[];
  const barradoEmail = await bloqueados(emails);

  const vistos = new Set<string>();
  const alvos: Alvo[] = [];
  const recente = Date.now() - 14 * DIA_MS;

  for (const c of clientes) {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (tags.includes("no-marketing")) { res.bloqueados++; continue; }
    if (c.source_account_id && !nossas.has(c.source_account_id)) { res.plataforma++; continue; }

    const phone = toWhatsAppNumber(c.phone);
    if (!phone) { res.semNumero++; continue; }
    if (vistos.has(phone)) continue; // mesmo número em dois cadastros: uma mensagem só
    vistos.add(phone);

    const email = normalizarEmail(c.email);
    if (barradoWa.has(phone) || (email && barradoEmail.has(email))) { res.bloqueados++; continue; }
    if (recebeu.has(phone)) { res.jaReceberam++; continue; }
    if (c.last_job_date && new Date(c.last_job_date).getTime() > recente) { res.jobRecente++; continue; }
    if (tocadoCliente.has(c.id) || tocadoFone.has(phone)) { res.tocadosHa20h++; continue; }

    alvos.push({ clientId: c.id, phone, nome: primeiroNome(c.full_name) });
  }
  res.alcancaveis = alvos.length;
  return { alvos, res };
}

/**
 * Uma volta do disparo. Hora a hora, dentro da janela, manda até um sexto do
 * teto do dia: o dia fecha espalhado em vez de 200 mensagens às 10h em ponto.
 */
export async function dispararWhatsApp(opcoes: { aplicar: boolean; forcarJanela?: boolean }): Promise<ResultadoWhatsApp> {
  const ensaio = !opcoes.aplicar;
  const { campanha, template, idioma } = campanhaAtual();
  const sb = createServiceClient();

  const { alvos, res: base } = await montarPublico(campanha);
  const res: ResultadoWhatsApp = {
    ...base,
    ensaio,
    template,
    cabemHoje: 0,
    enviados: 0,
    falhas: [],
    parou: null,
    qualidade: null,
    amostra: alvos.slice(0, 10).map((a) => ({ ...a, phone: a.phone.slice(0, 5) + "…" + a.phone.slice(-3) })),
  };

  const { count } = await sb
    .from("marketing_touches")
    .select("id", { count: "exact", head: true })
    .eq("channel", "whatsapp")
    .gte("sent_at", new Date(Date.now() - DIA_MS).toISOString());
  res.cabemHoje = Math.max(0, tetoPorDia() - (count ?? 0));

  if (!whatsappConfigured()) { res.parou = "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID ausentes"; return res; }

  const saude = await saudeDoNumero();
  res.qualidade = saude.qualidade;
  if (saude.qualidade !== "GREEN") {
    res.parou = `qualidade do número em ${saude.qualidade}: disparo parado até voltar a GREEN`;
    return res;
  }

  if (ensaio) return res;
  if (!opcoes.forcarJanela && !dentroDaJanela()) { res.parou = `fora da janela (${ABRE}h-${FECHA}h Londres, seg-sáb)`; return res; }

  const nestaVolta = Math.min(res.cabemHoje, Math.ceil(tetoPorDia() / 6), alvos.length);
  for (const alvo of alvos.slice(0, nestaVolta)) {
    // Reserva o lugar ANTES de mandar: se duas voltas se cruzarem, o índice
    // único derruba a segunda aqui e ninguém recebe duas vezes.
    const { data: toque, error: reserva } = await sb
      .from("marketing_touches")
      .insert({ phone: alvo.phone, client_id: alvo.clientId, campaign: campanha, channel: "whatsapp", segment: "b2c", subject: template })
      .select("id")
      .single();
    if (reserva || !toque) continue;

    try {
      const { messageId } = await sendTemplate({ to: alvo.phone, name: template, language: idioma, bodyParams: [alvo.nome] });
      await sb.from("marketing_touches").update({ provider_id: messageId }).eq("id", toque.id);
      res.enviados++;
    } catch (err) {
      const erro = err instanceof WhatsAppError ? `${err.code ?? ""} ${err.message}`.trim() : String(err);
      res.falhas.push({ phone: alvo.phone.slice(0, 5) + "…", erro });
      const segurou = err instanceof WhatsAppError && [131048, 131049, 130429, 80007, 368].includes(err.code ?? 0);
      if (segurou) {
        // A culpa não é do número: devolve o lugar para a próxima volta.
        await sb.from("marketing_touches").delete().eq("id", toque.id);
      } else {
        // Número recusado fica marcado e não é tentado de novo nesta campanha.
        await sb.from("marketing_touches").update({ bounced_at: new Date().toISOString() }).eq("id", toque.id);
      }
      /**
       * 131048/131049: a Meta está segurando por spam ou por excesso de
       * marketing para o usuário. 130429/80007: limite de taxa. Em qualquer
       * delas, continuar é piorar a nota do número.
       */
      if (segurou) {
        res.parou = `Meta segurou o envio (${(err as WhatsAppError).code}): volta parada`;
        break;
      }
      if (res.falhas.length >= 10) { res.parou = "10 falhas na mesma volta: parado para olhar"; break; }
    }
  }
  return res;
}
