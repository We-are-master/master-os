/**
 * Campanha de disparo único para a base (a primeira é a WEEK10, 24/09 a 02/10/2026).
 *
 * Três grupos, decididos pelo que a pessoa tem:
 *
 *   os_dois    e-mail pelo nome, e 4 horas DEPOIS do e-mail daquela pessoa
 *              sair, um WhatsApp que cita o e-mail
 *   so_numero  WhatsApp com a oferta direta
 *   so_email   e-mail com a oferta direta
 *
 * A fila (`marketing_queue`) é montada uma vez e o resto só anda nela: o
 * e-mail sai pela volta de e-mail (Resend, em lotes), o WhatsApp sai pelo n8n,
 * que pede a próxima leva aqui e devolve o resultado. As regras ficam todas
 * deste lado, então a lista de bloqueio é uma só para os dois canais.
 *
 * Quem entra (decisão do dono em 23/09/2026): a base própria (`contasNossas`),
 * só caixa de e-mail pessoal. Plataforma nunca, e-mail de empresa nunca.
 */

import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { appBaseUrl } from "@/lib/app-base-url";
import { renderCampanha } from "@/lib/emails/campanha-layout";
import { bloqueados, normalizarEmail } from "./suppressions";
import { contasNossas } from "./lifecycle";
import { segmentoDoEmail } from "./segments";
import { primeiroNome } from "./whatsapp";
import { saudeDoNumero, toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { EMAILS, WEEK10, WHATSAPP, linkDaCampanha, type PassoEmail, type PassoWhatsApp } from "./week10-copy";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

export type Grupo = "os_dois" | "so_numero" | "so_email";
export type LinhaDaFila = {
  campanha: string;
  client_id: string;
  grupo: Grupo | "teste";
  canal: "email" | "whatsapp";
  passo: PassoEmail | PassoWhatsApp;
  email: string | null;
  phone: string | null;
  primeiro_nome: string;
  agendado_para: string | null;
};

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

/* ═══════════════════ Custos (o painel soma daqui) ═══════════════════ */

/**
 * Quanto custa cada mensagem, em libras. Estimativa, conferida depois com a
 * fatura: a Meta cobra marketing por mensagem entregue (tarifa do UK em USD,
 * a WABA fatura em USD), o Resend cobra por plano e aqui vira custo por envio.
 */
export function custoPorMensagem(canal: "email" | "whatsapp"): number {
  if (canal === "whatsapp") {
    const usd = Number(process.env.MARKETING_WA_CUSTO_USD ?? "0.0529");
    const cambio = Number(process.env.MARKETING_USD_GBP ?? "0.75");
    return usd * cambio;
  }
  return Number(process.env.MARKETING_EMAIL_CUSTO_GBP ?? "0.0009");
}

/* ═══════════════════ Montar ═══════════════════ */

export type Classificado = { clientId: string; nome: string; email: string | null; phone: string | null; grupo: Grupo };

/**
 * Decide o grupo de cada cliente. Função pura, para o teste pegar as regras:
 * dedupe por e-mail E por telefone (o mesmo número em dois cadastros recebe
 * uma mensagem só), e-mail de empresa descartado, bloqueio por canal.
 */
export function classificar(
  clientes: ClienteBruto[],
  bloqueio: { emails: Set<string>; phones: Set<string> },
  nossas: Set<string>,
): { alvos: Classificado[]; fora: Record<string, number> } {
  const fora: Record<string, number> = { plataforma: 0, no_marketing: 0, empresa: 0, sem_contato: 0, duplicado: 0, job_recente: 0 };
  const vistosEmail = new Set<string>();
  const vistosFone = new Set<string>();
  const alvos: Classificado[] = [];
  const recente = Date.now() - 7 * DIA_MS;

  for (const c of clientes) {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (tags.includes("no-marketing")) { fora.no_marketing++; continue; }
    if (c.source_account_id && !nossas.has(c.source_account_id)) { fora.plataforma++; continue; }

    let email = normalizarEmail(c.email);
    if (email && segmentoDoEmail(email) === "b2b") { fora.empresa++; continue; }
    if (email && bloqueio.emails.has(email)) email = null;

    let phone = toWhatsAppNumber(c.phone);
    if (phone && bloqueio.phones.has(phone)) phone = null;

    if (!email && !phone) { fora.sem_contato++; continue; }
    if ((email && vistosEmail.has(email)) || (phone && vistosFone.has(phone))) { fora.duplicado++; continue; }
    if (c.last_job_date && new Date(c.last_job_date).getTime() > recente) { fora.job_recente++; continue; }
    if (email) vistosEmail.add(email);
    if (phone) vistosFone.add(phone);

    alvos.push({
      clientId: c.id,
      nome: primeiroNome(c.full_name),
      email,
      phone,
      grupo: email && phone ? "os_dois" : phone ? "so_numero" : "so_email",
    });
  }
  return { alvos, fora };
}

/** O que cada grupo recebe. O follow-up nasce sem data: quem dá a data é o e-mail. */
export function linhasDoAlvo(a: Classificado, campanha: string, agora: Date): LinhaDaFila[] {
  const base = { campanha, client_id: a.clientId, grupo: a.grupo, primeiro_nome: a.nome } as const;
  if (a.grupo === "os_dois") {
    return [
      { ...base, canal: "email", passo: "email_quente", email: a.email, phone: null, agendado_para: agora.toISOString() },
      { ...base, canal: "whatsapp", passo: "wa_followup", email: null, phone: a.phone, agendado_para: null },
    ];
  }
  if (a.grupo === "so_numero") {
    return [{ ...base, canal: "whatsapp", passo: "wa_oferta", email: null, phone: a.phone, agendado_para: agora.toISOString() }];
  }
  return [{ ...base, canal: "email", passo: "email_oferta", email: a.email, phone: null, agendado_para: agora.toISOString() }];
}

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
 * Monta a fila inteira. Em ensaio só conta. Rodar de novo não duplica (índice
 * único por campanha, passo e cliente) e ainda pega quem entrou na base
 * depois: é assim que contato novo desta semana também recebe a oferta.
 */
export async function montarFila(opcoes: { aplicar: boolean; campanha?: string }) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const sb = createServiceClient();

  const clientes = await paginar<ClienteBruto>((de, ate) =>
    sb
      .from("clients")
      .select("id, full_name, email, phone, tags, source_account_id, last_job_date, created_at")
      .is("deleted_at", null)
      // Quem comprou primeiro: conhece a marca, e o teto do dia deixa entrar
      // poucos por vez nas primeiras horas, que decidem a nota do domínio.
      .order("last_job_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(de, ate),
  );

  const emails = clientes.map((c) => normalizarEmail(c.email)).filter(Boolean) as string[];
  const [emailsBloq, fonesBloq] = await Promise.all([
    bloqueados(emails),
    paginar<{ phone: string }>((de, ate) => sb.from("whatsapp_suppressions").select("phone").range(de, ate)),
  ]);

  const { alvos, fora } = classificar(clientes, { emails: emailsBloq, phones: new Set(fonesBloq.map((f) => f.phone)) }, contasNossas());
  const agora = new Date();
  const linhas = alvos.flatMap((a) => linhasDoAlvo(a, campanha, agora));

  const grupos = { os_dois: 0, so_numero: 0, so_email: 0 };
  for (const a of alvos) grupos[a.grupo]++;
  const resumo = { campanha, olhados: clientes.length, grupos, mensagens: linhas.length, fora, inseridas: 0 };
  if (!opcoes.aplicar) return resumo;

  for (let i = 0; i < linhas.length; i += 500) {
    const { data, error } = await sb
      .from("marketing_queue")
      .upsert(linhas.slice(i, i + 500), { onConflict: "campanha,passo,client_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`fila: ${error.message}`);
    resumo.inseridas += data?.length ?? 0;
  }
  return resumo;
}

/* ═══════════════════ Janela e travas ═══════════════════ */

const ABRE = Number(process.env.MARKETING_CAMPANHA_ABRE ?? "9");
const FECHA = Number(process.env.MARKETING_CAMPANHA_FECHA ?? "20");

/** A campanha trabalha 9h às 20h de Londres, todo dia: inclusive no fim de semana. */
export function campanhaNaJanela(d = new Date()): boolean {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(d));
  return hora >= ABRE && hora < FECHA;
}

/** Oferta vencida não sai: ninguém recebe "10% até sexta" no sábado. */
export function ofertaNoAr(d = new Date()): boolean {
  return d.getTime() < Date.parse(WEEK10.expiraEm) - 2 * HORA_MS;
}

/**
 * Reserva as próximas linhas vencidas de um canal. `update ... where status =
 * 'planejado'` por id é o que impede duas voltas de pegarem a mesma pessoa.
 */
async function reservar(campanha: string, canal: "email" | "whatsapp", n: number) {
  const sb = createServiceClient();
  const { data: vencidas, error } = await sb
    .from("marketing_queue")
    .select("id")
    .eq("campanha", campanha)
    .eq("canal", canal)
    .eq("status", "planejado")
    .lte("agendado_para", new Date().toISOString())
    .order("agendado_para", { ascending: true })
    .limit(n);
  if (error) throw new Error(error.message);
  const ids = (vencidas ?? []).map((v) => v.id);
  if (!ids.length) return [];
  const { data } = await sb
    .from("marketing_queue")
    .update({ status: "reservado", reservado_em: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "planejado")
    .select("id, client_id, grupo, passo, email, phone, primeiro_nome");
  return (data ?? []) as Array<{ id: string; client_id: string; grupo: string; passo: PassoEmail | PassoWhatsApp; email: string | null; phone: string | null; primeiro_nome: string }>;
}

/** O link de saída: o id da linha, não o e-mail. Vale em qualquer ambiente e não põe dado pessoal na URL. */
export function linkDeSaida(queueId: string): string {
  return `${appBaseUrl()}/api/marketing/sair?q=${encodeURIComponent(queueId)}`;
}

/* ═══════════════════ E-mail ═══════════════════ */

export async function voltaDeEmail(opcoes: { campanha?: string; n?: number; forcar?: boolean } = {}) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const n = opcoes.n ?? Number(process.env.MARKETING_EMAIL_POR_VOLTA ?? "60");
  const resultado = { enviados: 0, falhas: 0, followupsAgendados: 0, parou: null as string | null };

  if (!opcoes.forcar && !campanhaNaJanela()) { resultado.parou = "fora da janela"; return resultado; }
  if (!ofertaNoAr()) { resultado.parou = "oferta vencida"; return resultado; }
  const remetente = process.env.RESEND_MARKETING_FROM?.trim();
  if (!remetente) { resultado.parou = "RESEND_MARKETING_FROM ausente"; return resultado; }

  const linhas = await reservar(campanha, "email", Math.min(n, 100));
  if (!linhas.length) return resultado;

  const sb = createServiceClient();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const replyTo = process.env.RESEND_MARKETING_REPLY_TO?.trim();

  const lote = linhas.map((l) => {
    const passo = l.passo as PassoEmail;
    const copy = EMAILS[passo];
    const saida = linkDeSaida(l.id);
    return {
      from: remetente,
      to: [l.email as string],
      subject: copy.assunto,
      ...(replyTo ? { replyTo } : {}),
      headers: { "List-Unsubscribe": `<${saida}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campanha", value: campanha }, { name: "passo", value: passo }],
      html: renderCampanha({
        preheader: copy.preheader,
        etiqueta: copy.etiqueta,
        titulo: copy.titulo,
        nome: l.primeiro_nome === "there" ? undefined : l.primeiro_nome,
        blocos: copy.blocos,
        oferta: { codigo: WEEK10.codigo, valor: "10% off", sobre: "any Fixfy service, applied for you at checkout", validade: "Friday 2 October, midnight" },
        cta: { texto: copy.cta, url: linkDaCampanha(passo) },
        unsubscribeUrl: saida,
      }),
    };
  });

  const { data, error } = await resend.batch.send(lote);
  const agora = new Date();
  if (error || !data) {
    await sb.from("marketing_queue").update({ status: "planejado", reservado_em: null, erro: String(error?.message ?? "batch sem resposta") }).in("id", linhas.map((l) => l.id));
    resultado.parou = `Resend recusou o lote: ${error?.message}`;
    return resultado;
  }

  const ids = data.data ?? [];
  const custo = custoPorMensagem("email");
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const providerId = ids[i]?.id ?? null;
    await sb.from("marketing_queue").update({ status: "enviado", enviado_em: agora.toISOString(), provider_id: providerId, custo_estimado: custo }).eq("id", l.id);
    resultado.enviados++;
    if (l.grupo === "os_dois" || l.grupo === "teste") {
      const atraso = Number(process.env.MARKETING_FOLLOWUP_MIN ?? "240") * 60 * 1000;
      const { count } = await sb
        .from("marketing_queue")
        .update({ agendado_para: new Date(agora.getTime() + atraso).toISOString() }, { count: "exact" })
        .eq("campanha", campanha)
        .eq("client_id", l.client_id)
        .eq("passo", "wa_followup")
        .is("agendado_para", null);
      resultado.followupsAgendados += count ?? 0;
    }
  }

  await sb.from("marketing_touches").insert(
    linhas.map((l, i) => ({
      email: l.email,
      client_id: l.client_id,
      campaign: `${campanha}:${l.passo}`,
      channel: "email",
      segment: "b2c",
      subject: EMAILS[l.passo as PassoEmail].assunto,
      provider_id: ids[i]?.id ?? null,
      sent_at: agora.toISOString(),
    })),
  );
  return resultado;
}

/* ═══════════════════ WhatsApp (quem manda é o n8n) ═══════════════════ */

/**
 * A próxima leva para o n8n mandar. Volta vazia, com o motivo, quando mandar
 * agora seria errado: fora da janela, oferta vencida, número fora de GREEN ou
 * teto de 24 horas cheio. O n8n não decide nada, só obedece.
 */
export async function proximaLevaWhatsApp(opcoes: { campanha?: string; n?: number; forcar?: boolean } = {}) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const n = Math.min(opcoes.n ?? 50, 100);
  const sb = createServiceClient();

  if (!opcoes.forcar && !campanhaNaJanela()) return { itens: [], motivo: "fora da janela" };
  if (!ofertaNoAr()) return { itens: [], motivo: "oferta vencida" };

  const saude = await saudeDoNumero();
  if (saude.qualidade !== "GREEN") return { itens: [], motivo: `qualidade ${saude.qualidade}` };

  const teto = Number(process.env.MARKETING_WA_TETO_24H ?? "1800");
  const { count } = await sb
    .from("marketing_queue")
    .select("id", { count: "exact", head: true })
    .eq("canal", "whatsapp")
    .in("status", ["enviado", "reservado"])
    .gte("reservado_em", new Date(Date.now() - DIA_MS).toISOString());
  const cabem = Math.max(0, teto - (count ?? 0));
  if (!cabem) return { itens: [], motivo: `teto de ${teto}/24h` };

  const linhas = await reservar(campanha, "whatsapp", Math.min(n, cabem));
  return {
    motivo: null,
    itens: linhas.map((l) => {
      const w = WHATSAPP[l.passo as PassoWhatsApp];
      return {
        id: l.id,
        to: l.phone,
        template: w.template,
        idioma: "en_GB",
        // O corpo do n8n: exatamente o que a Graph API espera.
        corpo: {
          messaging_product: "whatsapp",
          to: l.phone,
          type: "template",
          template: {
            name: w.template,
            language: { code: "en_GB" },
            components: [{ type: "body", parameters: [{ type: "text", text: l.primeiro_nome }, { type: "text", text: WEEK10.codigo }] }],
          },
        },
      };
    }),
  };
}

/** O n8n devolve o que a Meta respondeu. Erro de número não se tenta de novo; erro de ritmo devolve para a fila. */
export async function registrarResultadoWhatsApp(itens: Array<{ id: string; wamid?: string | null; erro?: string | null; codigo?: number | null }>) {
  const sb = createServiceClient();
  const agora = new Date().toISOString();
  let enviados = 0, falhas = 0, devolvidos = 0;

  for (const r of itens) {
    const { data: linha } = await sb.from("marketing_queue").select("id, campanha, client_id, passo, phone, status").eq("id", r.id).maybeSingle();
    if (!linha || linha.status !== "reservado") continue;

    if (r.wamid) {
      await sb.from("marketing_queue").update({ status: "enviado", enviado_em: agora, provider_id: r.wamid, custo_estimado: custoPorMensagem("whatsapp") }).eq("id", r.id);
      await sb.from("marketing_touches").insert({ phone: linha.phone, client_id: linha.client_id, campaign: `${linha.campanha}:${linha.passo}`, channel: "whatsapp", segment: "b2c", subject: linha.passo, provider_id: r.wamid, sent_at: agora });
      enviados++;
      continue;
    }

    const ritmo = [131048, 131049, 130429, 80007, 368].includes(Number(r.codigo));
    if (ritmo) {
      await sb.from("marketing_queue").update({ status: "planejado", reservado_em: null, erro: r.erro ?? `código ${r.codigo}`, agendado_para: new Date(Date.now() + HORA_MS).toISOString() }).eq("id", r.id);
      devolvidos++;
    } else {
      await sb.from("marketing_queue").update({ status: "falhou", erro: r.erro ?? `código ${r.codigo}` }).eq("id", r.id);
      falhas++;
    }
  }
  return { enviados, falhas, devolvidos };
}

/**
 * Reserva que ficou presa (o n8n caiu no meio da leva) volta para a fila
 * depois de 30 minutos. Sem isso a pessoa nunca recebe e o painel mente.
 */
export async function soltarReservasPresas() {
  const sb = createServiceClient();
  const { count } = await sb
    .from("marketing_queue")
    .update({ status: "planejado", reservado_em: null }, { count: "exact" })
    .eq("status", "reservado")
    .lt("reservado_em", new Date(Date.now() - 30 * 60 * 1000).toISOString());
  return count ?? 0;
}

/* ═══════════════════ Saída ═══════════════════ */

/**
 * Tira a pessoa de TODA campanha, pelos dois canais: quem clica "unsubscribe"
 * no e-mail ou toca "Stop promotions" no WhatsApp não quer promoção, não quer
 * um canal a menos. As linhas ainda planejadas dela viram "pulado".
 */
export async function tirarDaLista(chave: { queueId?: string; phone?: string }, origem: string) {
  const sb = createServiceClient();
  let email: string | null = null;
  let phone: string | null = chave.phone ?? null;
  let clientId: string | null = null;

  if (chave.queueId) {
    const { data } = await sb.from("marketing_queue").select("email, phone, client_id").eq("id", chave.queueId).maybeSingle();
    if (!data) return { ok: false as const };
    email = data.email;
    phone = data.phone ?? phone;
    clientId = data.client_id;
  }
  if (clientId) {
    // A linha do e-mail não tem o telefone, e a do WhatsApp não tem o e-mail: o cliente tem os dois.
    const { data: c } = await sb.from("clients").select("email, phone").eq("id", clientId).maybeSingle();
    email = email ?? normalizarEmail(c?.email) ?? null;
    phone = phone ?? toWhatsAppNumber(c?.phone);
  }

  if (email) await sb.from("email_suppressions").upsert({ email, reason: "unsubscribed", source: origem }, { onConflict: "email", ignoreDuplicates: true });
  if (phone) await sb.from("whatsapp_suppressions").upsert({ phone, reason: "stopped", source: origem }, { onConflict: "phone", ignoreDuplicates: true });

  let q = sb.from("marketing_queue").update({ status: "pulado", erro: `saiu: ${origem}` }).eq("status", "planejado");
  if (clientId) q = q.eq("client_id", clientId);
  else if (phone) q = q.eq("phone", phone);
  await q;
  return { ok: true as const, email: Boolean(email), phone: Boolean(phone) };
}
