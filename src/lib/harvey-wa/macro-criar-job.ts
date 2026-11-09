/**
 * Macro "Harvey: create job in OS" (dono, 09/11/2026): "fechei um trabalho por hora
 * com um lead, aplico a macro, o Harvey lê a conversa e sobe o job, com foto e tudo".
 *
 * A macro só põe a tag `harvey_criar_job` e uma nota interna. O ciclo do Harvey
 * (/api/cron/harvey-wa, a cada 10 min) acha o ticket e:
 *  1. lê a conversa inteira (WhatsApp ou e-mail), a lateral do ticket e a quote do ticket;
 *  2. pede ao modelo a ficha do job (nome, e-mail, endereço, serviço, escopo, preço, data, janela);
 *  3. confere: cliente completo, serviço do catálogo, preço ESCRITO por alguém da equipe
 *     (ou na lateral, ou na quote; o Harvey nunca escolhe o número), data ou "Date TBC";
 *  4. cria o job pela mesma porta da criação manual (POST /api/jobs, no ticket da conversa),
 *     com as fotos do cliente. A quote do ticket vira job sozinha nessa porta.
 *
 * Nada vai ao cliente: nem mensagem, nem link. A nota interna traz o job e o link do sinal,
 * para a equipe mandar quando quiser. Faltou dado: nota dizendo o quê, a lateral fica
 * preenchida com o que o Harvey achou, a tag sai e a macro pode ser aplicada de novo.
 *
 * Lateral > quote > conversa: o que a equipe escreveu no ticket vale mais.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, addTicketTags, removeTicketTags } from "@/lib/zendesk";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { precisaDeAcao } from "@/lib/fila-de-acao";
import { catalogoAtivo } from "@/lib/catalogo-ativo";
import { getFixfyAccountId } from "@/lib/fixfy-account";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import { ehDoHarvey, historico } from "./sunshine";
import { telefoneE164 } from "./primeiro-contato";
import { camposDaFicha, FORM_JOB, type FichaDoJob } from "./ficha-do-job";
import { contaDoLead } from "./reserva-da-equipe";
import { valorEmLibras } from "./preco-da-equipe";
import { guardarFotos } from "./varredura-cotacao-automatica";

export const TAG_CRIAR_JOB = "harvey_criar_job";
export const TAG_JOB_CRIADO = "harvey_job_criado";

/** Régua do handyman (memória preco-nosso-antes-do-parceiro): sem taxa escrita, é £72/h. */
export const TAXA_HORA_PADRAO = 72;

/** Campos da lateral (formulário de Job). Mesmos ids de ficha-do-job.ts. */
const CAMPO = {
  nome: 5693105918623,
  email: 5811705681183,
  telefone: 5811689527071,
  endereco: 5693026186527,
  data: 5693027123999,
  janela: 5737641586335,
  escopo: 5687121072927,
  preco: 5856894119839,
  preco2: 5856821659679,
  tarifa: 5807260876063,
  servico: 5687087915551,
} as const;

export type FalaDoTicket = { papel: "cliente" | "harvey" | "equipe"; quem?: string | null; quando: string; texto: string };

/** O que o job precisa. `tarifa` segue o POST /api/jobs: fixed, hourly, half_day, daily. */
export type FichaParaJob = {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  postcode: string | null;
  servico: string | null;
  catalogServiceId: string | null;
  escopo: string | null;
  tarifa: "fixed" | "hourly" | "half_day" | "daily" | null;
  /** fixed/half_day/daily: total ao cliente. hourly: £ por hora. */
  preco: number | null;
  horas: number | null;
  data: string | null;
  janela: string | null;
  /** De onde veio o preço, para a nota. */
  origemDoPreco: "lateral" | "quote" | "conversa" | "padrao" | null;
};

const limpo = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const ouNulo = (v: unknown): string | null => limpo(v) || null;

function valor(campos: Array<{ id: number; value: unknown }> | undefined, id: number): string | null {
  const v = campos?.find((c) => c.id === id)?.value;
  if (v === null || v === undefined) return null;
  return ouNulo(v);
}

/** A lateral do ticket virando ficha (o que a equipe já preencheu). */
export function fichaDaLateral(campos: Array<{ id: number; value: unknown }> | undefined): Partial<FichaParaJob> {
  const tarifa = valor(campos, CAMPO.tarifa);
  const preco = Number(valor(campos, CAMPO.preco) ?? valor(campos, CAMPO.preco2));
  const servico = valor(campos, CAMPO.servico);
  const endereco = valor(campos, CAMPO.endereco);
  return {
    nome: valor(campos, CAMPO.nome),
    email: valor(campos, CAMPO.email)?.toLowerCase() ?? null,
    telefone: valor(campos, CAMPO.telefone),
    endereco,
    postcode: endereco ? extractUkPostcode(endereco) : null,
    catalogServiceId: servico?.startsWith("os_") ? servico.slice(3) : null,
    escopo: valor(campos, CAMPO.escopo),
    tarifa: tarifa === "job_type_hourly" ? "hourly" : tarifa === "job_type_fixed" ? "fixed" : null,
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    data: valor(campos, CAMPO.data),
    janela: valor(campos, CAMPO.janela),
  };
}

/** Todo £ que alguém do nosso lado (Harvey ou equipe) escreveu na conversa. */
export function precosDoNossoLado(conversa: FalaDoTicket[]): number[] {
  const achados = new Set<number>();
  for (const f of conversa) {
    if (f.papel === "cliente") continue;
    for (const m of f.texto.matchAll(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) {
      const v = valorEmLibras(m[1]!);
      if (v) achados.add(v);
    }
  }
  return [...achados];
}

/**
 * Junta lateral, quote e leitura do modelo. Lateral ganha de tudo; a quote ganha da conversa.
 * O preço do modelo só fica se aparece escrito do nosso lado na conversa.
 */
export function juntarFicha(
  lateral: Partial<FichaParaJob>,
  quote: { preco: number | null; escopo: string | null; servico: string | null; catalogServiceId: string | null; endereco: string | null; postcode: string | null } | null,
  lida: Partial<FichaParaJob>,
  conversa: FalaDoTicket[],
): FichaParaJob {
  const primeiro = <T>(...vs: Array<T | null | undefined>): T | null => vs.find((v) => v !== null && v !== undefined && v !== ("" as unknown)) ?? null;
  const escritos = precosDoNossoLado(conversa);
  const precoLido = lida.preco && escritos.some((p) => Math.abs(p - lida.preco!) < 0.01) ? lida.preco : null;
  const tarifa = primeiro(lateral.tarifa, lida.tarifa, quote?.preco ? ("fixed" as const) : null);

  let preco: number | null = null;
  let origemDoPreco: FichaParaJob["origemDoPreco"] = null;
  if (lateral.preco) [preco, origemDoPreco] = [lateral.preco, "lateral"];
  else if (quote?.preco && tarifa !== "hourly") [preco, origemDoPreco] = [quote.preco, "quote"];
  else if (precoLido) [preco, origemDoPreco] = [precoLido, "conversa"];
  else if (tarifa === "hourly") [preco, origemDoPreco] = [TAXA_HORA_PADRAO, "padrao"];

  const endereco = primeiro(lateral.endereco, quote?.endereco, lida.endereco);
  const postcode = primeiro(lateral.postcode, extractUkPostcode(endereco ?? ""), quote?.postcode, lida.postcode);
  return {
    nome: primeiro(lateral.nome, lida.nome),
    email: primeiro(lateral.email, lida.email),
    telefone: primeiro(lateral.telefone, lida.telefone),
    endereco,
    postcode: postcode ? postcode.toUpperCase() : null,
    servico: primeiro(quote?.servico, lida.servico),
    catalogServiceId: primeiro(lateral.catalogServiceId, quote?.catalogServiceId, lida.catalogServiceId),
    escopo: primeiro(lateral.escopo, quote?.escopo, lida.escopo),
    tarifa,
    preco,
    horas: tarifa === "hourly" ? (lida.horas && lida.horas > 0 ? lida.horas : null) : null,
    data: primeiro(lateral.data, lida.data),
    janela: primeiro(lateral.janela, lida.janela),
    origemDoPreco,
  };
}

/** Endereço com rua: só postcode não é endereço (memória never-create-job-without-full-client). */
function temRua(endereco: string | null, postcode: string | null): boolean {
  const sem = limpo(endereco).toUpperCase().replace(limpo(postcode).toUpperCase(), "").replace(/[,\s]+/g, " ").trim();
  return /\d/.test(sem) && /[A-Z]{3,}/.test(sem);
}

/** O que falta para o job nascer. Vazio = pode criar. */
export function faltandoParaCriarJob(f: FichaParaJob): string[] {
  const falta: string[] = [];
  if (!f.nome) falta.push("customer name");
  if (!f.postcode) falta.push("postcode");
  if (!temRua(f.endereco, f.postcode)) falta.push("full address (house number and street)");
  if (!f.catalogServiceId) falta.push("service type");
  if (!f.escopo || f.escopo.length < 10) falta.push("scope of work");
  if (!f.tarifa) falta.push("rate type (hourly or fixed)");
  if (!f.preco) falta.push(f.tarifa === "hourly" ? "hourly rate" : "agreed price (write it in the conversation or the sidebar)");
  if (f.data && !/^\d{4}-\d{2}-\d{2}$/.test(f.data)) falta.push("date (YYYY-MM-DD)");
  if (f.data && !f.janela) falta.push("arrival window");
  return falta;
}

/** O corpo do POST /api/jobs. Sem mensagem ao cliente: o job só nasce. */
export function corpoDoJob(f: FichaParaJob, a: { accountId: string; ticketId: number; images: string[]; quemAplicou: string | null }): Record<string, unknown> {
  const semData = !f.data;
  const preco = f.preco ?? 0;
  const nota = [
    `Created by Harvey from the conversation (macro "Harvey: create job in OS"${a.quemAplicou ? `, applied by ${a.quemAplicou}` : ""}).`,
    f.origemDoPreco === "padrao" ? `No hourly rate written in the conversation: standard £${TAXA_HORA_PADRAO}/h used.` : f.origemDoPreco ? `Price taken from the ${f.origemDoPreco === "lateral" ? "ticket sidebar" : f.origemDoPreco}.` : "",
    semData ? "Date still to be agreed (Date TBC)." : "",
    "Nothing was sent to the customer. Partner cost still to be confirmed.",
  ].filter(Boolean).join(" ");
  return {
    account_id: a.accountId,
    ...(semData ? { date_tbc: true } : { date: f.data, arrival_time: f.janela }),
    title: f.servico ?? undefined,
    service_type: f.servico ?? undefined,
    catalog_service_id: f.catalogServiceId,
    client_name: f.nome,
    ...(f.email ? { client_email: f.email } : {}),
    ...(f.telefone ? { client_phone: f.telefone } : {}),
    property_address: f.endereco,
    postcode: f.postcode,
    rate_type: f.tarifa,
    ...(f.tarifa === "hourly"
      ? { hourly_client_rate: preco, ...(f.horas ? { billed_hours: f.horas } : {}) }
      : { client_price: preco }),
    ticket_id: a.ticketId,
    description: f.escopo,
    ...(a.images.length ? { images: a.images } : {}),
    internal_notes: nota,
  };
}

// ─── leitura ────────────────────────────────────────────────────────────────

type Ticket = { id: number; subject: string; tags: string[]; requester_id: number; via?: { channel?: string }; custom_fields?: Array<{ id: number; value: unknown }> };
type Usuario = { id: number; name?: string | null; phone?: string | null; email?: string | null; role?: string };
type Comentario = { id: number; public: boolean; author_id: number; created_at: string; body?: string; attachments?: Array<{ content_type?: string; content_url?: string }>; via?: { channel?: string } };

const ehWhatsApp = (t: Ticket) => t.tags.includes("harvey_wa") || t.via?.channel === "whatsapp" || t.via?.channel === "native_messaging";

async function lerTicket(sb: SupabaseClient, t: Ticket): Promise<{ conversa: FalaDoTicket[]; fotos: Array<{ url: string; auth?: boolean }>; cliente: Usuario | null; quemAplicou: string | null }> {
  const { comments, users } = await zendeskApi<{ comments: Comentario[]; users?: Usuario[] }>(`tickets/${t.id}/comments.json?include=users&per_page=100`);
  const pessoas = new Map((users ?? []).map((u) => [u.id, u]));
  const cliente = pessoas.get(t.requester_id) ?? null;
  // Quem aplicou a macro: autor da última nota "Harvey: create job" (a nota da macro).
  const daMacro = [...(comments ?? [])].reverse().find((c) => !c.public && /create job/i.test(c.body ?? ""));
  const quemAplicou = daMacro ? pessoas.get(daMacro.author_id)?.name ?? null : null;

  if (ehWhatsApp(t)) {
    const telefone = telefoneE164(cliente?.phone ?? valor(t.custom_fields, CAMPO.telefone));
    const { data: c } = telefone ? await sb.from("harvey_wa_conversas").select("conversation_id").eq("phone", telefone).maybeSingle() : { data: null };
    const id = (c as { conversation_id?: string } | null)?.conversation_id ?? null;
    if (id) {
      const msgs = await historico(id, 150);
      const conversa: FalaDoTicket[] = msgs
        .map((m) => ({
          papel: m.author.type === "user" ? ("cliente" as const) : ehDoHarvey(m) ? ("harvey" as const) : ("equipe" as const),
          quem: m.author.displayName ?? null,
          quando: m.received,
          texto: m.content.text ?? (m.content.type === "image" ? "[photo]" : m.content.altText ?? ""),
        }))
        .filter((f) => f.texto);
      const fotos = msgs.filter((m) => m.author.type === "user" && m.content.type === "image" && m.content.mediaUrl).map((m) => ({ url: m.content.mediaUrl! }));
      return { conversa, fotos, cliente: cliente ? { ...cliente, phone: telefone ?? cliente.phone } : null, quemAplicou };
    }
  }
  const publicos = (comments ?? []).filter((c) => c.public);
  const conversa: FalaDoTicket[] = publicos.map((c) => {
    const autor = pessoas.get(c.author_id);
    return { papel: autor?.role === "end-user" ? "cliente" : "equipe", quem: autor?.name ?? null, quando: c.created_at, texto: limpo(c.body).slice(0, 2000) };
  });
  const fotos = publicos
    .filter((c) => pessoas.get(c.author_id)?.role === "end-user")
    .flatMap((c) => (c.attachments ?? []).filter((a) => a.content_type?.startsWith("image/") && a.content_url).map((a) => ({ url: a.content_url!, auth: true })));
  return { conversa, fotos, cliente, quemAplicou };
}

async function quoteDoTicket(sb: SupabaseClient, ticketId: number) {
  const { data } = await sb
    .from("quotes")
    .select("reference, status, service_type, catalog_service_id, postcode, property_address, scope, total_value")
    .eq("external_source", "zendesk")
    .eq("external_ref", String(ticketId))
    .is("deleted_at", null)
    .not("status", "in", "(rejected,declined,cancelled,converted_to_job)")
    .order("created_at", { ascending: false })
    .limit(1);
  const q = (data ?? [])[0] as { reference: string; status: string; service_type: string | null; catalog_service_id: string | null; postcode: string | null; property_address: string | null; scope: string | null; total_value: number | null } | undefined;
  return q ?? null;
}

/** O modelo lê a conversa e devolve a ficha. Nunca inventa: o que não está escrito volta null. */
async function lerComOModelo(conversa: FalaDoTicket[], servicos: string[], hoje: string): Promise<Partial<FichaParaJob>> {
  const texto = conversa
    .slice(-80)
    .map((f) => `[${f.quando.slice(0, 16)}] ${f.papel === "cliente" ? "CUSTOMER" : f.papel === "harvey" ? "FIXFY (Harvey)" : `FIXFY TEAM${f.quem ? ` (${f.quem})` : ""}`}: ${f.texto}`)
    .join("\n");
  const pedido = `You read a conversation between Fixfy (UK home services) and a customer who has just agreed to book a job. Extract the booking. Today is ${hoje} (Europe/London).
Return JSON only with:
customer_name (full name as given, or null), email (or null), address (house number + street + town as written, or null), postcode (UK, or null),
service (EXACTLY one of: ${servicos.join(" | ")}; use "General Maintenance" for handyman work that is not painting, cleaning or a certificate),
scope (what the partner must do, 1-4 short lines in English, NEVER any price or £),
rate_type ("hourly", "fixed", "half_day" or "daily", as agreed), price (number: for hourly the £ per hour, otherwise the total agreed; ONLY a value Fixfy wrote and the customer accepted, else null),
hours (minimum hours agreed for hourly work, else null), date (YYYY-MM-DD agreed, else null), window ("HH:MM-HH:MM" arrival window agreed, else null).
Never guess. Anything not in the conversation is null.

CONVERSATION:
${texto}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.HARVEY_WA_MODEL?.trim() || "gpt-5.4",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: pedido }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const r = JSON.parse(j.choices[0]!.message.content) as Record<string, unknown>;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const tarifa = limpo(r.rate_type).toLowerCase();
  return {
    nome: ouNulo(r.customer_name),
    email: ouNulo(r.email)?.toLowerCase() ?? null,
    endereco: ouNulo(r.address),
    postcode: extractUkPostcode(limpo(r.postcode)) ?? extractUkPostcode(limpo(r.address)),
    servico: ouNulo(r.service),
    escopo: ouNulo(r.scope)?.replace(/£\s?\d[\d,.]*/g, "").trim() || null,
    tarifa: tarifa === "hourly" || tarifa === "fixed" || tarifa === "half_day" || tarifa === "daily" ? tarifa : null,
    preco: num(r.price),
    horas: num(r.hours),
    data: /^\d{4}-\d{2}-\d{2}$/.test(limpo(r.date)) ? limpo(r.date) : null,
    janela: /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(limpo(r.window)) ? limpo(r.window).replace(/\s/g, "") : null,
  };
}

// ─── a varredura ────────────────────────────────────────────────────────────

export type ResultadoMacroCriarJob = { ensaio: boolean; olhados: number; acoes: string[]; pulados: string[] };

async function nota(ticketId: number, texto: string) {
  await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: texto } } } });
}

/** Deixa na lateral o que o Harvey achou, só em campo vazio, para a equipe completar e reaplicar. */
async function preencherLateral(t: Ticket, f: FichaParaJob): Promise<void> {
  const ficha: FichaDoJob = {
    nome: f.nome, email: f.email, telefone: f.telefone, endereco: f.endereco, postcode: f.postcode, escopo: f.escopo,
    preco: f.tarifa === "hourly" ? null : f.preco, tarifa: f.tarifa === "hourly" ? "hourly" : f.tarifa ? "fixed" : null, data: f.data, janela: f.janela,
  };
  const campos = camposDaFicha(ficha);
  if (f.catalogServiceId) campos.push({ id: CAMPO.servico, value: `os_${f.catalogServiceId}` });
  const vazio = (id: number) => valor(t.custom_fields, id) === null;
  const novos = campos.filter((c) => vazio(c.id));
  if (novos.length) await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { ticket_form_id: FORM_JOB, custom_fields: novos } } });
}

/** true = o job nasceu (a chave fica "sent" para sempre); false = parou por falta de dado ou ensaio. */
async function criarUm(sb: SupabaseClient, t: Ticket, aplicar: boolean, out: ResultadoMacroCriarJob): Promise<boolean> {
  const { conversa, fotos, cliente, quemAplicou } = await lerTicket(sb, t);
  if (!conversa.length) throw new Error("no conversation found on this ticket");
  const catalogo = await catalogoAtivo(sb);
  const lida = await lerComOModelo(conversa, catalogo.map((c) => c.name), new Date().toISOString().slice(0, 10));
  const doCatalogo = catalogo.find((c) => c.name.trim().toLowerCase() === limpo(lida.servico).toLowerCase());
  const q = await quoteDoTicket(sb, t.id);
  const ficha = juntarFicha(
    fichaDaLateral(t.custom_fields),
    q ? { preco: q.total_value, escopo: q.scope, servico: q.service_type, catalogServiceId: q.catalog_service_id, endereco: q.property_address, postcode: q.postcode } : null,
    { ...lida, catalogServiceId: doCatalogo?.id ?? null, servico: doCatalogo?.name ?? lida.servico ?? null, nome: lida.nome ?? ouNulo(cliente?.name), email: lida.email ?? ouNulo(cliente?.email), telefone: ouNulo(cliente?.phone) },
    conversa,
  );
  if (!ficha.servico && ficha.catalogServiceId) ficha.servico = catalogo.find((c) => c.id === ficha.catalogServiceId)?.name ?? null;

  const falta = faltandoParaCriarJob(ficha);
  const resumo = `${ficha.nome ?? "?"}, ${ficha.postcode ?? "?"}, ${ficha.servico ?? "?"}, ${ficha.tarifa ?? "?"} £${ficha.preco ?? "?"}${ficha.tarifa === "hourly" ? "/h" : ""}, ${ficha.data ?? "Date TBC"} ${ficha.janela ?? ""}`.trim();
  if (!aplicar) {
    out.acoes.push(`#${t.id}: ${falta.length ? `would stop, missing ${falta.join(", ")}` : `would create job (${resumo}, ${fotos.length} photo(s))`}`);
    return false;
  }
  if (falta.length) {
    await preencherLateral(t, ficha).catch(() => undefined);
    await removeTicketTags(t.id, [TAG_CRIAR_JOB]);
    await nota(t.id, `🤖 HARVEY: job NOT created. Missing: ${falta.join("; ")}.\nWhat I found is in the sidebar (empty fields only). Fill the gaps and apply the macro again.\nRead so far: ${resumo}.`);
    await precisaDeAcao(t.id, `Create job: missing ${falta.join(", ")}. Fill the sidebar and apply the macro again`).catch(() => undefined);
    out.acoes.push(`#${t.id}: missing ${falta.join(", ")}`);
    return false;
  }

  const imagens = fotos.length ? await guardarFotos(sb, t.id, fotos).catch(() => [] as string[]) : [];
  const accountId = (await contaDoLead(sb, ficha.telefone, ficha.email)) ?? (await getFixfyAccountId(sb));
  const chave = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (!chave) throw new Error("job key missing (MASTER_OS_JOB_WEBHOOK_API_KEY)");
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.getfixfy.com").replace(/\/$/, "");
  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave },
    body: JSON.stringify(corpoDoJob(ficha, { accountId, ticketId: t.id, images: imagens, quemAplicou })),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; reference?: string; error?: string };
  if (!res.ok || !j.reference) throw new Error(j.error || `POST /api/jobs ${res.status}`);

  await addTicketTags(t.id, [TAG_JOB_CRIADO]);
  await removeTicketTags(t.id, [TAG_CRIAR_JOB]);
  const { data: inv } = await sb.from("invoices").select("reference").eq("job_reference", j.reference).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const fatura = (inv as { reference?: string } | null)?.reference ?? null;
  await nota(
    t.id,
    [
      `🤖 HARVEY: job ${j.reference} created in the OS from this conversation.`,
      `${resumo}. ${imagens.length} photo(s) attached.${q ? ` Quote ${q.reference} linked.` : ""}`,
      ficha.origemDoPreco === "padrao" ? `No hourly rate was written, so the standard £${TAXA_HORA_PADRAO}/h was used. Change it on the job if needed.` : "",
      fatura ? `Deposit link (50%), NOT sent: ${invoicePayLinkUrl(fatura, 50)}` : "",
      `Nothing was sent to the customer. Allocate the partner in the OS: ${base}/jobs?jobId=${j.id}`,
    ].filter(Boolean).join("\n"),
  );
  out.acoes.push(`#${t.id}: job ${j.reference} (${resumo})`);
  return true;
}

export async function varrerMacroCriarJob(sb: SupabaseClient, { aplicar }: { aplicar: boolean }): Promise<ResultadoMacroCriarJob> {
  const out: ResultadoMacroCriarJob = { ensaio: !aplicar, olhados: 0, acoes: [], pulados: [] };
  const r = await zendeskApi<{ results: Ticket[] }>(`search.json?query=${encodeURIComponent(`type:ticket status<solved tags:${TAG_CRIAR_JOB} -tags:${TAG_JOB_CRIADO}`)}&per_page=50`);
  const { reservarEnvio, confirmarEnvio, falhouEnvio } = await import("@/lib/idempotencia/envio");
  for (const t of r.results ?? []) {
    if (out.olhados >= 3) { out.pulados.push(`#${t.id}: cycle limit, next cycle`); continue; }
    out.olhados++;
    const chave = `harvey-criar-job:${t.id}`;
    let reservou = false;
    try {
      if (aplicar) {
        const res = await reservarEnvio(sb, { chave, finalidade: "harvey-criar-job", canal: "zendesk_note", ticketId: t.id, motivo: "Harvey: create job in OS macro" });
        if (!res.reservado) { out.pulados.push(`#${t.id}: already being handled`); continue; }
        reservou = true;
      }
      const criou = await criarUm(sb, t, aplicar, out);
      // Job criado: a chave fica para sempre (nunca dois jobs pela macro no mesmo ticket).
      // Parou por falta de dado: a chave libera, para a macro valer de novo.
      if (reservou) {
        if (criou) await confirmarEnvio(sb, chave).catch(() => undefined);
        else await falhouEnvio(sb, chave, new Error("missing data, macro can be applied again")).catch(() => undefined);
      }
    } catch (e) {
      if (reservou) await falhouEnvio(sb, chave, e).catch(() => undefined);
      const msg = e instanceof Error ? e.message.slice(0, 160) : "failed";
      out.pulados.push(`#${t.id}: ${msg}`);
      if (aplicar) {
        await removeTicketTags(t.id, [TAG_CRIAR_JOB]).catch(() => undefined);
        await nota(t.id, `🤖 HARVEY: could not create the job (${msg}). Create it from the OS or apply the macro again.`).catch(() => undefined);
        await precisaDeAcao(t.id, `Create job failed: ${msg.slice(0, 100)}`).catch(() => undefined);
      }
    }
  }
  return out;
}
