/**
 * Campanha de disparo único para a base (a primeira é a WEEK10, 24/09 a 02/10/2026).
 *
 * Três grupos, decididos pelo que a pessoa tem:
 *
 *   os_dois    e-mail pelo nome de manhã e, às 15h do MESMO dia em que o
 *              e-mail daquela pessoa saiu, um WhatsApp que cita o e-mail
 *   so_numero  WhatsApp com a oferta direta
 *   so_email   e-mail com a oferta direta
 *
 * Mais um passo que não é grupo: o lembrete de véspera ("WEEK10 ends
 * tomorrow"), só para quem chegou no checkout do site e não pagou
 * (`montarLembrete`).
 *
 * O ritmo (decisão do dono em 28/09/2026, horas de Londres, ver `ritmo.ts`):
 * e-mail só das 9h às 12h, WhatsApp só das 15h às 18h. Antes de cada mensagem
 * sair, a triagem (`triagem.ts`) pula quem comprou, respondeu ou saiu da lista
 * desde que a fila foi montada.
 *
 * A fila (`marketing_queue`) é montada uma vez e o resto só anda nela: o
 * e-mail sai pela volta de e-mail (Resend, em lotes), o WhatsApp sai por quem
 * pede a próxima leva aqui e devolve o resultado (o n8n, ou o disparador
 * local). As regras ficam todas deste lado, então a lista de bloqueio é uma
 * só para os dois canais.
 *
 * Quem entra (decisão do dono em 23/09/2026): a base própria (`contasNossas`),
 * só caixa de e-mail pessoal. Plataforma nunca, e-mail de empresa nunca.
 */

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { appBaseUrl } from "@/lib/app-base-url";
import { renderCampanha } from "@/lib/emails/campanha-layout";
import { bloqueados, normalizarEmail } from "./suppressions";
import { contasNossas } from "./lifecycle";
import { segmentoDoEmail } from "./segments";
import { primeiroNome } from "./whatsapp";
import { saudeDoNumero, toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { EMAILS, WEEK10, WHATSAPP, linkDaCampanha, type PassoEmail, type PassoWhatsApp } from "./week10-copy";
import { ehDiaDoLembrete, emailNaJanela, horarioDoFollowup, horarioDoLembrete, lembretePassou, whatsappNaJanela } from "./ritmo";
import { juntarFatos, motivoDoPulo, triar, type Pessoa } from "./triagem";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

export type Grupo = "os_dois" | "so_numero" | "so_email";
export type LinhaDaFila = {
  campanha: string;
  /** Nulo só no lembrete de quem reservou no site sem virar cliente. */
  client_id: string | null;
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

/* ═══════════════════ Lembrete de véspera ═══════════════════ */

export type LeadDoCheckout = {
  email: string | null;
  full_name: string | null;
  phone: string | null;
  client_id: string | null;
  source: Record<string, unknown> | null;
};

/**
 * Quem recebe "WEEK10 ends tomorrow" (decisão do dono em 28/09/2026). Já vem
 * filtrado do banco: chegou no checkout (passo 4) desde o início da campanha,
 * não pagou, não perdeu, não pediu para sair. Aqui fica a parte da campanha:
 * veio de um link da WEEK10 (utm_campaign `week10_*`) ou recebeu e-mail dela.
 * Um lembrete por e-mail e por cliente, e quem já está na fila não entra de novo.
 */
export function escolherLembretes(
  leads: LeadDoCheckout[],
  ctx: { campanha: string; receberamEmail: Set<string>; jaNaFila: { clientes: Set<string>; emails: Set<string> }; quando: Date },
): { linhas: LinhaDaFila[]; fora: Record<string, number> } {
  const fora: Record<string, number> = { sem_email: 0, fora_da_campanha: 0, ja_na_fila: 0, duplicado: 0 };
  const emails = new Set<string>();
  const clientes = new Set<string>();
  const linhas: LinhaDaFila[] = [];

  for (const l of leads) {
    const email = normalizarEmail(l.email);
    if (!email) { fora.sem_email++; continue; }
    const utm = String(l.source?.utm_campaign ?? "").trim().toLowerCase();
    if (!utm.startsWith(ctx.campanha) && !ctx.receberamEmail.has(email)) { fora.fora_da_campanha++; continue; }
    if (ctx.jaNaFila.emails.has(email) || (l.client_id && ctx.jaNaFila.clientes.has(l.client_id))) { fora.ja_na_fila++; continue; }
    if (emails.has(email) || (l.client_id && clientes.has(l.client_id))) { fora.duplicado++; continue; }
    emails.add(email);
    if (l.client_id) clientes.add(l.client_id);
    linhas.push({
      campanha: ctx.campanha,
      client_id: l.client_id,
      grupo: "so_email",
      canal: "email",
      passo: "email_lembrete",
      email,
      phone: null,
      primeiro_nome: primeiroNome(l.full_name),
      agendado_para: ctx.quando.toISOString(),
    });
  }
  return { linhas, fora };
}

/**
 * Monta o lembrete de véspera: uma linha `email_lembrete` por pessoa, para
 * quinta 01/10 às 9h30 de Londres. O disparador chama na quinta às 9h; em
 * ensaio só conta. Rodar de novo não duplica: com cliente, o índice único
 * (campanha, passo, client_id) segura; sem cliente o índice não segura (nulo
 * não colide no Postgres), então quem já está na fila sai pelo e-mail antes
 * de inserir.
 */
export async function montarLembrete(opcoes: { aplicar: boolean; campanha?: string }) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const sb = createServiceClient();
  const quando = horarioDoLembrete();

  const leads = await paginar<LeadDoCheckout>((de, ate) =>
    sb
      .from("site_leads")
      .select("email, full_name, phone, client_id, source")
      .eq("step_reached", 4)
      .not("status", "in", "(won,lost,unsubscribed)")
      .eq("marketing_opt_out", false)
      .gte("created_at", WEEK10.inicio)
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .range(de, ate),
  );

  const [receberam, naFila] = await Promise.all([
    paginar<{ email: string | null }>((de, ate) =>
      sb.from("marketing_queue").select("email").eq("campanha", campanha).eq("canal", "email").eq("status", "enviado").range(de, ate),
    ),
    paginar<{ client_id: string | null; email: string | null }>((de, ate) =>
      sb.from("marketing_queue").select("client_id, email").eq("campanha", campanha).eq("passo", "email_lembrete").range(de, ate),
    ),
  ]);

  // Lead sem cliente ainda: procura o cadastro pelo e-mail (o site cria o cliente no passo 1 ou 2).
  for (const l of leads) {
    const email = normalizarEmail(l.email);
    if (l.client_id || !email) continue;
    const { data } = await sb.from("clients").select("id").ilike("email", email).is("deleted_at", null).limit(1).maybeSingle();
    l.client_id = (data?.id as string | undefined) ?? null;
  }

  const { linhas, fora } = escolherLembretes(leads, {
    campanha,
    receberamEmail: new Set(receberam.map((r) => normalizarEmail(r.email)).filter(Boolean) as string[]),
    jaNaFila: {
      clientes: new Set(naFila.map((r) => r.client_id).filter(Boolean) as string[]),
      emails: new Set(naFila.map((r) => normalizarEmail(r.email)).filter(Boolean) as string[]),
    },
    quando,
  });

  // A mesma triagem do envio: quem comprou ou saiu desde o início não entra.
  const foneDoEmail = new Map(leads.map((l) => [normalizarEmail(l.email), toWhatsAppNumber(l.phone)]));
  const pessoas: Pessoa[] = linhas.map((l) => ({
    passo: "email_lembrete",
    canal: "email",
    clientId: l.client_id,
    endereco: l.email,
    emails: l.email ? [l.email] : [],
    fones: [foneDoEmail.get(l.email) ?? null].filter(Boolean) as string[],
    emailSaiuEm: null,
  }));
  const idsClientes = [...new Set(linhas.map((l) => l.client_id).filter(Boolean) as string[])];
  const semMarketing = new Set<string>();
  for (let i = 0; i < idsClientes.length; i += 100) {
    const { data, error } = await sb.from("clients").select("id, tags").in("id", idsClientes.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) if (Array.isArray(c.tags) && c.tags.includes("no-marketing")) semMarketing.add(c.id as string);
  }
  const fatos = await juntarFatos(pessoas, { semMarketing, zendesk: false, campanha });
  const aceitas = linhas.filter((_, i) => {
    const motivo = motivoDoPulo(pessoas[i], fatos);
    if (motivo) fora[motivo] = (fora[motivo] ?? 0) + 1;
    return !motivo;
  });

  const resumo = { campanha, agendadoPara: quando.toISOString(), candidatos: leads.length, lembretes: aceitas.length, fora, inseridas: 0 };
  if (!opcoes.aplicar || !aceitas.length) return resumo;

  const comCliente = aceitas.filter((l) => l.client_id);
  const semCliente = aceitas.filter((l) => !l.client_id);
  if (comCliente.length) {
    const { data, error } = await sb
      .from("marketing_queue")
      .upsert(comCliente, { onConflict: "campanha,passo,client_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`lembrete: ${error.message}`);
    resumo.inseridas += data?.length ?? 0;
  }
  if (semCliente.length) {
    const { data, error } = await sb.from("marketing_queue").insert(semCliente).select("id");
    if (error) throw new Error(`lembrete: ${error.message}`);
    resumo.inseridas += data?.length ?? 0;
  }
  return resumo;
}

/* ═══════════════════ Janela e travas ═══════════════════ */

/**
 * A campanha está trabalhando agora? Algum canal na janela dele: e-mail de
 * manhã, WhatsApp de tarde (`ritmo.ts`). Quem manda de fato consulta a janela
 * do próprio canal.
 */
export function campanhaNaJanela(d = new Date()): boolean {
  return emailNaJanela(d) || whatsappNaJanela(d);
}

/** Oferta vencida não sai: ninguém recebe "10% até sexta" no sábado. */
export function ofertaNoAr(d = new Date()): boolean {
  return d.getTime() < Date.parse(WEEK10.expiraEm) - 2 * HORA_MS;
}

type LinhaReservada = { id: string; client_id: string | null; grupo: string; passo: PassoEmail | PassoWhatsApp; email: string | null; phone: string | null; primeiro_nome: string };

/**
 * Reserva as próximas linhas vencidas de um canal. `update ... where status =
 * 'planejado'` por id é o que impede duas voltas de pegarem a mesma pessoa.
 * `so`/`sem` recortam por passo (o lembrete de véspera fura a fila).
 */
async function reservar(campanha: string, canal: "email" | "whatsapp", n: number, recorte: { so?: string; sem?: string } = {}): Promise<LinhaReservada[]> {
  if (n <= 0) return [];
  const sb = createServiceClient();
  let q = sb
    .from("marketing_queue")
    .select("id")
    .eq("campanha", campanha)
    .eq("canal", canal)
    .eq("status", "planejado")
    .lte("agendado_para", new Date().toISOString());
  if (recorte.so) q = q.eq("passo", recorte.so);
  if (recorte.sem) q = q.neq("passo", recorte.sem);
  const { data: vencidas, error } = await q.order("agendado_para", { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const ids = (vencidas ?? []).map((v) => v.id);
  if (!ids.length) return [];
  const { data } = await sb
    .from("marketing_queue")
    .update({ status: "reservado", reservado_em: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "planejado")
    .select("id, client_id, grupo, passo, email, phone, primeiro_nome");
  return (data ?? []) as LinhaReservada[];
}

/** Reservadas que não vão sair agora voltam para a fila, com o motivo. */
async function devolver(sb: SupabaseClient, ids: string[], erro: string) {
  if (!ids.length) return;
  await sb.from("marketing_queue").update({ status: "planejado", reservado_em: null, erro }).in("id", ids);
}

/**
 * Marca como `pulado` o que a triagem barrou, uma chamada por motivo. Quem
 * teve o e-mail quente pulado leva junto o follow-up que ainda esperava por
 * ele: sem o e-mail, aquele WhatsApp ("we sent you a quick email") nunca
 * ganharia data e ficaria "aguardando" para sempre no painel.
 */
async function marcarPulados(sb: SupabaseClient, campanha: string, linhas: LinhaReservada[], pular: Map<string, string>): Promise<number> {
  const porMotivo = new Map<string, string[]>();
  for (const [id, motivo] of pular) porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), id]);
  for (const [motivo, ids] of porMotivo) {
    await sb.from("marketing_queue").update({ status: "pulado", erro: motivo }).in("id", ids).eq("status", "reservado");
    const clientes = linhas.filter((l) => ids.includes(l.id) && l.passo === "email_quente" && l.client_id).map((l) => l.client_id as string);
    if (clientes.length) {
      await sb
        .from("marketing_queue")
        .update({ status: "pulado", erro: `${motivo} (e-mail pulado)` })
        .eq("campanha", campanha)
        .eq("passo", "wa_followup")
        .eq("status", "planejado")
        .is("agendado_para", null)
        .in("client_id", clientes);
    }
  }
  return pular.size;
}

/** O link de saída: o id da linha, não o e-mail. Vale em qualquer ambiente e não põe dado pessoal na URL. */
export function linkDeSaida(queueId: string): string {
  return `${appBaseUrl()}/api/marketing/sair?q=${encodeURIComponent(queueId)}`;
}

/* ═══════════════════ E-mail ═══════════════════ */

/**
 * Uma volta de e-mail: até MARKETING_EMAIL_POR_VOLTA (padrão 75) pelo batch
 * do Resend, só na janela da manhã. De 15 em 15 minutos são 12 voltas, 900
 * e-mails por manhã.
 *
 * No dia do lembrete ele sai primeiro: a fila anda do mais velho para o mais
 * novo, e o lembrete (9h30 da véspera) esperaria o resto da manhã inteira.
 * Passada a véspera, o lembrete que sobrou vira `pulado` ("ends tomorrow"
 * no sábado seria mentira).
 */
export async function voltaDeEmail(opcoes: { campanha?: string; n?: number; forcar?: boolean } = {}) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const porVolta = opcoes.n ?? Number(process.env.MARKETING_EMAIL_POR_VOLTA?.trim() || "75");
  const n = Math.max(0, Math.min(Number.isFinite(porVolta) ? Math.floor(porVolta) : 75, 100));
  const resultado = { enviados: 0, falhas: 0, pulados: 0, followupsAgendados: 0, parou: null as string | null };
  const inicioDaVolta = new Date();

  if (!opcoes.forcar && !emailNaJanela(inicioDaVolta)) { resultado.parou = "fora da janela"; return resultado; }
  if (!ofertaNoAr(inicioDaVolta)) { resultado.parou = "oferta vencida"; return resultado; }
  const remetente = process.env.RESEND_MARKETING_FROM?.trim();
  if (!remetente) { resultado.parou = "RESEND_MARKETING_FROM ausente"; return resultado; }

  const sb = createServiceClient();
  if (lembretePassou(inicioDaVolta)) {
    const { count } = await sb
      .from("marketing_queue")
      .update({ status: "pulado", erro: "lembrete passou do dia" }, { count: "exact" })
      .eq("campanha", campanha)
      .eq("passo", "email_lembrete")
      .eq("status", "planejado");
    resultado.pulados += count ?? 0;
  }
  const lembretes = ehDiaDoLembrete(inicioDaVolta) ? await reservar(campanha, "email", n, { so: "email_lembrete" }) : [];
  const resto = await reservar(campanha, "email", n - lembretes.length, { sem: "email_lembrete" });
  const reservadas = [...lembretes, ...resto];
  if (!reservadas.length) return resultado;

  // A última conferência: quem comprou ou saiu desde que a fila foi montada não recebe.
  let pular: Map<string, string>;
  try {
    pular = await triar(reservadas, { zendesk: false, campanha });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await devolver(sb, reservadas.map((l) => l.id), `triagem: ${motivo}`);
    resultado.parou = `triagem falhou: ${motivo}`;
    return resultado;
  }
  resultado.pulados += await marcarPulados(sb, campanha, reservadas, pular);
  const linhas = reservadas.filter((l) => !pular.has(l.id));
  if (!linhas.length) return resultado;

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
  // O follow-up de WhatsApp sai às 15h de Londres do mesmo dia (ritmo.ts). Conta
  // da hora em que a volta começou, que está sempre dentro da janela: uma volta
  // das 11h59 que termina 12h00 não empurra ninguém para o dia seguinte.
  const followup = horarioDoFollowup(inicioDaVolta).toISOString();
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const providerId = ids[i]?.id ?? null;
    await sb.from("marketing_queue").update({ status: "enviado", enviado_em: agora.toISOString(), provider_id: providerId, custo_estimado: custo }).eq("id", l.id);
    resultado.enviados++;
    if ((l.grupo === "os_dois" || l.grupo === "teste") && l.passo !== "email_lembrete" && l.client_id) {
      const { count } = await sb
        .from("marketing_queue")
        .update({ agendado_para: followup }, { count: "exact" })
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

/* ═══════════════════ WhatsApp (quem manda é o n8n ou o disparador local) ═══════════════════ */

/**
 * A próxima leva para mandar. Volta vazia, com o motivo, quando mandar agora
 * seria errado: fora da janela da tarde, oferta vencida, número fora de GREEN
 * ou teto de 24 horas cheio. Quem manda não decide nada, só obedece.
 *
 * Antes de sair, a leva passa pela triagem com o Zendesk: follow-up de quem
 * respondeu ao e-mail, e qualquer mensagem de quem comprou ou saiu da lista,
 * vira `pulado`. Se a triagem não conseguir ler, a leva volta para a fila
 * inteira: melhor atrasar dez minutos do que mandar sem conferir.
 */
export async function proximaLevaWhatsApp(opcoes: { campanha?: string; n?: number; forcar?: boolean } = {}) {
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const n = Math.min(opcoes.n ?? 50, 100);
  const sb = createServiceClient();

  if (!opcoes.forcar && !whatsappNaJanela()) return { itens: [], motivo: "fora da janela", pulados: 0 };
  if (!ofertaNoAr()) return { itens: [], motivo: "oferta vencida", pulados: 0 };

  const saude = await saudeDoNumero();
  if (saude.qualidade !== "GREEN") return { itens: [], motivo: `qualidade ${saude.qualidade}`, pulados: 0 };

  const teto = Number(process.env.MARKETING_WA_TETO_24H ?? "1800");
  const { count } = await sb
    .from("marketing_queue")
    .select("id", { count: "exact", head: true })
    .eq("canal", "whatsapp")
    .in("status", ["enviado", "reservado"])
    .gte("reservado_em", new Date(Date.now() - DIA_MS).toISOString());
  const cabem = Math.max(0, teto - (count ?? 0));
  if (!cabem) return { itens: [], motivo: `teto de ${teto}/24h`, pulados: 0 };

  const reservadas = await reservar(campanha, "whatsapp", Math.min(n, cabem));
  if (!reservadas.length) return { itens: [], motivo: null, pulados: 0 };

  let pular: Map<string, string>;
  try {
    pular = await triar(reservadas, { zendesk: true, campanha });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await devolver(sb, reservadas.map((l) => l.id), `triagem: ${motivo}`);
    return { itens: [], motivo: `triagem falhou: ${motivo}`, pulados: 0 };
  }
  const pulados = await marcarPulados(sb, campanha, reservadas, pular);
  const linhas = reservadas.filter((l) => !pular.has(l.id));

  return {
    motivo: null,
    pulados,
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
