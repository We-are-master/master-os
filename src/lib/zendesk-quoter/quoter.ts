/**
 * O quoter do Zendesk B2B — FASE 1, e a fase é lei (Victor, 17/08/2026):
 *
 *   "as primeiras quotes vai fazer em forma de comentario interno pra make
 *    sure... as primeiras 10 eu fico de olho 100% mando manual, depois
 *    autorizamos."
 *
 * Por isso este módulo NÃO TEM caminho de resposta pública. A única saída é
 * `postarNotaInterna` (publicComment: false) — o cliente nunca vê. O envio
 * direto só nasce noutra fase, com ordem explícita do dono, depois das 10
 * quotes revisadas e enviadas manualmente por ele.
 *
 * B2B não pode errar, então o quoter lê TUDO antes de cotar: o thread
 * inteiro do ticket e as IMAGENS anexadas (baixadas com auth e passadas ao
 * modelo com visão). O que faltar para cotar vira "missing info" declarada
 * na nota — pergunta pro humano fazer, nunca chute.
 */
import { executarPriceCheck, type ResultadoPriceCheck } from "@/lib/orcamentista/price-check";
import { updateTicket } from "@/lib/zendesk";
import { createServiceClient } from "@/lib/supabase/service";

const MAX_IMAGENS = 6;
const MAX_BYTES_IMAGEM = 4 * 1024 * 1024;

function baseUrl(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}
function authHeader(): string {
  const raw = `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

export type TicketLido = {
  id: number;
  subject: string;
  requesterName: string | null;
  organizationId: number | null;
  /** O thread em texto, na ordem, com quem falou. */
  thread: string;
  /** Imagens baixadas como data URL, prontas para o modelo com visão. */
  imagens: Array<{ filename: string; dataUrl: string }>;
  totalAnexos: number;
  /** Links housekeep.com achados no HTML dos comentários — o card do job
   * ("Link") mora aí, e é nele que o endereço vive. */
  linksHousekeep: string[];
};

export async function lerTicketCompleto(ticketId: number): Promise<TicketLido> {
  const headers = { Authorization: authHeader() };

  const tRes = await fetch(`${baseUrl()}/tickets/${ticketId}.json`, { headers });
  if (!tRes.ok) throw new Error(`Zendesk ticket ${ticketId}: HTTP ${tRes.status}`);
  const tJson = (await tRes.json()) as {
    ticket: { id: number; subject: string; organization_id: number | null; requester_id: number };
  };

  const cRes = await fetch(`${baseUrl()}/tickets/${ticketId}/comments.json?include=users`, { headers });
  if (!cRes.ok) throw new Error(`Zendesk comments ${ticketId}: HTTP ${cRes.status}`);
  const cJson = (await cRes.json()) as {
    comments: Array<{
      author_id: number;
      public: boolean;
      body: string;
      html_body?: string;
      attachments?: Array<{ file_name: string; content_url: string; content_type: string; size: number }>;
    }>;
    users?: Array<{ id: number; name: string; role: string }>;
  };

  const quem = new Map((cJson.users ?? []).map((u) => [u.id, `${u.name} (${u.role})`]));
  const partes: string[] = [];
  const linksHousekeep: string[] = [];
  const anexosDeImagem: Array<{ file_name: string; content_url: string; content_type: string; size: number }> = [];
  let totalAnexos = 0;

  for (const c of cJson.comments) {
    // O Harvey não se lê: as PRÓPRIAS notas (🤖/✅/⚠️, AI QUOTE DRAFT) fora do
    // thread — senão a segunda passada consolida em cima da primeira e o
    // matcher deriva (visto ao vivo: £282.98 → £0 na reposta do #48833).
    const corpo = c.body.trim();
    if (!c.public && /^(🤖|✅|⚠️)|AI QUOTE DRAFT|HARVEY —/.test(corpo)) continue;
    const autor = quem.get(c.author_id) ?? `user ${c.author_id}`;
    partes.push(`[${autor}${c.public ? "" : " — internal note"}]\n${corpo}`);
    for (const m of (c.html_body ?? "").matchAll(/href="(https?:\/\/[^"]*housekeep\.com[^"]*)"/g)) {
      const url = m[1]!.replace(/&amp;/g, "&");
      if (podeSerCard(url) && !linksHousekeep.includes(url)) linksHousekeep.push(url);
    }
    for (const a of c.attachments ?? []) {
      totalAnexos++;
      if (a.content_type?.startsWith("image/") && a.size <= MAX_BYTES_IMAGEM) {
        anexosDeImagem.push(a);
      }
    }
  }

  // As imagens do Zendesk podem exigir auth (anexo privado): baixa com token
  // e entrega em data URL — o modelo recebe os bytes, não um link que expira.
  const imagens: TicketLido["imagens"] = [];
  for (const a of anexosDeImagem.slice(-MAX_IMAGENS)) {
    const iRes = await fetch(a.content_url, { headers, redirect: "follow" });
    if (!iRes.ok) continue;
    const buf = Buffer.from(await iRes.arrayBuffer());
    imagens.push({
      filename: a.file_name,
      dataUrl: `data:${a.content_type};base64,${buf.toString("base64")}`,
    });
  }

  const requester = (cJson.users ?? []).find((u) => u.id === tJson.ticket.requester_id);
  return {
    id: tJson.ticket.id,
    subject: tJson.ticket.subject,
    requesterName: requester?.name ?? null,
    organizationId: tJson.ticket.organization_id,
    thread: partes.join("\n\n---\n\n"),
    imagens,
    totalAnexos,
    linksHousekeep,
  };
}

export type PedidoConsolidado = {
  quoteRequest: string;
  /** O mesmo trabalho na voz de quem executa — é ISSO que vira o Scope. */
  scopeOfWork: string;
  facts: string[];
  missingInfo: string[];
};

/**
 * Consolida thread + imagens num pedido cotável. Visão entra aqui: a foto da
 * porta quebrada, do vazamento, da parede — tudo vira fato descrito. O que o
 * modelo não conseguir afirmar entra em missing_info, para o humano perguntar.
 */
export async function consolidarPedido(ticket: TicketLido, apiKey: string): Promise<PedidoConsolidado> {
  const conteudoUsuario: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Ticket #${ticket.id} — "${ticket.subject}"\n\nFull thread:\n${ticket.thread}\n\n${
        ticket.imagens.length > 0
          ? `${ticket.imagens.length} image(s) attached below. Read them carefully — they often carry the sizes, quantities and damage the text omits.`
          : "No readable images attached."
      }`,
    },
    ...ticket.imagens.map((img) => ({
      type: "image_url",
      image_url: { url: img.dataUrl, detail: "high" },
    })),
  ];

  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You read a B2B maintenance ticket (text thread + photos) and consolidate ONE quoting request. Reply with strict JSON only.

Rules:
- Only state what the thread or the photos actually show. Every fact you extract from a photo must say so ("photo shows...").
- quote_request: one plain-English paragraph describing exactly what needs pricing (trades, items, quantities, sizes when known).
- scope_of_work: the SAME work written as OUR statement of what we will carry out — the voice of the company executing, not the customer asking (e.g. "Fill and caulk approximately 1m of cracks around the bedroom window ledge and wardrobe, plaster and make good the affected areas. No painting included."). Never start with "Please provide a quote" or echo the request.
- facts: bullet facts that support the quote (from text or photos).
- missing_info: what a surveyor would still need to ask before committing a price. Be strict — B2B quotes cannot be wrong.

JSON shape: {"quote_request":"...","scope_of_work":"...","facts":["..."],"missing_info":["..."]}`,
        },
        { role: "user", content: conteudoUsuario },
      ],
    }),
  });
  if (!resposta.ok) {
    throw new Error(`OpenAI vision ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }
  const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const bruto = corpo.choices?.[0]?.message?.content;
  if (!bruto) throw new Error("OpenAI returned an empty consolidation");
  const json = JSON.parse(bruto) as { quote_request?: string; scope_of_work?: string; facts?: string[]; missing_info?: string[] };
  if (!json.quote_request?.trim()) throw new Error("consolidation produced no quote_request");
  return {
    quoteRequest: json.quote_request.trim(),
    scopeOfWork: (json.scope_of_work ?? json.quote_request).trim(),
    facts: json.facts ?? [],
    missingInfo: json.missing_info ?? [],
  };
}

/** A nota interna: o rascunho pro Victor revisar, com o bloco do cliente pronto. */
export function montarNotaInterna(
  ticket: TicketLido,
  pedido: PedidoConsolidado,
  resultado: ResultadoPriceCheck,
): string {
  const linhas: string[] = [
    "🤖 AI QUOTE DRAFT — internal only (phase 1: review and send manually)",
    "",
    "── Ready to send to the customer (copy from here) ──",
    resultado.presentable,
    "── end of customer block ──",
    "",
    `What I read: ${pedido.quoteRequest}`,
  ];
  if (pedido.facts.length > 0) {
    linhas.push("", "Facts (from thread and photos):");
    for (const f of pedido.facts) linhas.push(`• ${f}`);
  }
  if (pedido.missingInfo.length > 0) {
    linhas.push("", "⚠️ Ask before committing (missing info):");
    for (const m of pedido.missingInfo) linhas.push(`• ${m}`);
  }
  if (resultado.quote.gaps.length > 0) {
    linhas.push("", "Not priced (needs a human):");
    for (const g of resultado.quote.gaps) linhas.push(`• ${g}`);
  }
  if (resultado.quote.materialsMarginPct != null) {
    linhas.push(
      "",
      `Internal: materials margin £${resultado.quote.materialsMarginGbp.toFixed(2)} (${Math.round(
        resultado.quote.materialsMarginPct,
      )}%). Supplier names and links stay internal — customer only ever sees "our internal supplier".`,
    );
  }
  linhas.push(
    "",
    `Read: ${ticket.imagens.length} image(s) of ${ticket.totalAnexos} attachment(s) · thread in full.`,
  );
  return linhas.join("\n");
}

/** A ÚNICA saída do quoter na fase 1: nota interna. Não existe envio público. */
export async function postarNotaInterna(ticketId: number, corpo: string): Promise<void> {
  await updateTicket({ ticketId, commentBody: corpo, publicComment: false });
}

export type ResultadoDoQuoter = {
  ticketId: number;
  nota: string;
  pedido: PedidoConsolidado;
  resultado: ResultadoPriceCheck;
};

export async function cotarTicket(ticketId: number, postar: boolean): Promise<ResultadoDoQuoter> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const ticket = await lerTicketCompleto(ticketId);
  const pedido = await consolidarPedido(ticket, apiKey);
  const resultado = await executarPriceCheck(pedido.quoteRequest, pedido.scopeOfWork);
  const nota = montarNotaInterna(ticket, pedido, resultado);
  if (postar) await postarNotaInterna(ticketId, nota);
  return { ticketId, nota, pedido, resultado };
}


/* ==================== o braço de BOOKING do Harvey ==================== */
/**
 * Ordem do dono (18/08): "o Harvey também tem que pegar os jobs já booked e
 * os de quote que ele ganhou e subir no OS". A regra de ouro da casa vale
 * dobrado aqui ([[never-create-job-without-full-client]]): sem nome, endereço
 * E data explícitos no ticket, o job NÃO nasce — nasce uma nota interna
 * dizendo exatamente o que falta. Extração é evidência, nunca invenção.
 *
 * A criação usa o /api/jobs com `ticket_id`, que é IDEMPOTENTE: repostar o
 * mesmo ticket devolve o job existente — dedupe de graça, além da tag.
 */
export type ExtracaoBooking = {
  isConfirmedBooking: boolean;
  clientName: string | null;
  propertyAddress: string | null;
  postcode: string | null;
  date: string | null;
  arrivalWindow: string | null;
  priceGbp: number | null;
  serviceSummary: string | null;
  company: string | null;
  missing: string[];
  /** Nome do serviço como a plataforma escreve (ex. "End-of-tenancy clean"). */
  jobNome: string | null;
  /** Bloco "Job details" inteiro do card, pronto pro scope (dono, 18/08). */
  detalhesJob: string | null;
  /**
   * Telefone do morador, como o card escreve.
   *
   * O e-mail da plataforma não traz nem o nome nem o telefone: os dados do
   * cliente moram atrás do link do card, que é justamente o que já lemos
   * aqui. Sem este campo o job nascia sem telefone nenhum, e em 22/08/2026
   * eram 10 dos 26 jobs de Housekeep de agosto assim. Sem telefone não há
   * confirmação por WhatsApp nem como avisar o morador de um atraso.
   *
   * Pode ser fixo, e vale mesmo assim: quem atende no escritório liga. Quem
   * decide se dá para mandar WhatsApp é o `normalizarMobileUk`, depois.
   */
  contato: string | null;
  /** O link tokenizado do card — vira jobs.report_link. */
  cardUrl: string | null;
};

export async function extrairBooking(ticket: TicketLido, apiKey: string): Promise<ExtracaoBooking> {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You read a B2B maintenance ticket thread and decide if it is a CONFIRMED booking (a job that is agreed/booked to be carried out — a booking confirmation from a partner, or an explicit acceptance of a quote we sent). Reply strict JSON only.

Rules:
- ONLY values written explicitly in the thread. Never guess, never infer an address from a postcode, never invent a date. A value you cannot quote from the thread is null and goes in "missing".
- is_confirmed_booking is true ONLY when the work is agreed to go ahead (booked date, "please proceed", "quote approved", partner booking confirmation). A request for a quote or availability is false.
- date is YYYY-MM-DD. arrival_window like "09:00 - 12:00" or null. price_gbp is the agreed job value or null.
- company: which partner/company sent this (e.g. Housekeep) if stated.

JSON: {"is_confirmed_booking":bool,"client_name":str|null,"property_address":str|null,"postcode":str|null,"date":str|null,"arrival_window":str|null,"price_gbp":num|null,"service_summary":str|null,"company":str|null,"missing":["..."]}`,
        },
        { role: "user", content: `Ticket #${ticket.id} — "${ticket.subject}"\n\n${ticket.thread}` },
      ],
    }),
  });
  if (!resposta.ok) throw new Error(`OpenAI booking ${resposta.status}`);
  const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const j = JSON.parse(corpo.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  return {
    isConfirmedBooking: j.is_confirmed_booking === true,
    clientName: (j.client_name as string) || null,
    propertyAddress: (j.property_address as string) || null,
    postcode: (j.postcode as string) || null,
    date: (j.date as string) || null,
    arrivalWindow: (j.arrival_window as string) || null,
    priceGbp: typeof j.price_gbp === "number" ? j.price_gbp : null,
    serviceSummary: (j.service_summary as string) || null,
    company: (j.company as string) || null,
    missing: Array.isArray(j.missing) ? (j.missing as string[]) : [],
    // Detalhes ricos moram no card da plataforma, não no e-mail.
    jobNome: null,
    detalhesJob: null,
    contato: null,
    cardUrl: null,
  };
}

/** Conta B2B pelo nome citado no ticket (ou pelo assunto "[Housekeep]"). */
async function acharConta(pistas: Array<string | null>): Promise<{ id: string; nome: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("accounts").select("id, company_name").is("deleted_at", null);
  const contas = (data ?? []) as Array<{ id: string; company_name: string }>;
  for (const pista of pistas) {
    if (!pista) continue;
    const p = pista.toLowerCase();
    const hit = contas.find(
      (c) => p.includes(c.company_name.toLowerCase()) || c.company_name.toLowerCase().includes(p),
    );
    if (hit) return { id: hit.id, nome: hit.company_name };
  }
  return null;
}

/**
 * O card da Housekeep ("Link" no e-mail deles) abre SEM login — página
 * tokenizada, a mesma porta que a Stefane usa. O e-mail nunca traz o
 * endereço; o card sempre. Playwright porque a página é app renderizado no
 * cliente: fetch puro devolve casca vazia.
 */
/**
 * O que pode ser o card do job, e o que é só assinatura de e-mail.
 *
 * O e-mail da plataforma termina com logo, redes e links de marketing, todos
 * no mesmo domínio do card. Pegar "qualquer link housekeep.com" fez o JOB-9493
 * nascer com `report_link: https://housekeep.com` em 22/08/2026: o parceiro
 * clicou para abrir o relatório e caiu no site deles.
 *
 * Card é uma de duas formas: o endereço direto `/job-reports/<id>`, ou o link
 * rastreado da newsletter, que só se sabe para onde vai depois de seguir. As
 * duas entram; o resto do domínio não.
 */
export function podeSerCard(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\/job-reports\//i.test(u.pathname)) return true;
    return u.hostname.toLowerCase().startsWith("links.") && /\/ls\/click/i.test(u.pathname);
  } catch {
    return false;
  }
}

export async function pescarCardHousekeep(url: string, apiKey: string): Promise<Partial<ExtracaoBooking>> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    /**
     * Onde o link foi parar decide se é card, e não o que a página escreve.
     *
     * O link rastreado da newsletter pode levar a qualquer lugar, e uma página
     * de marketing tem texto de sobra para o modelo "extrair" um job inteiro de
     * nada. `/job-reports/` no endereço final é a única prova barata, e sai
     * antes da chamada ao modelo: página que não é card não custa nem um token.
     */
    const urlFinal = page.url();
    if (!/\/job-reports\//i.test(urlFinal)) return {};

    const texto = (await page.evaluate("document.body.innerText")) as string;
    if (!texto || texto.trim().length < 40) return {};

    const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You extract job details from a Housekeep partner job page text. ONLY values written explicitly on the page; anything absent is null. Reply strict JSON: {"client_name":str|null,"contact":str|null,"property_address":str|null,"postcode":str|null,"date":"YYYY-MM-DD"|null,"visit_date_label":str|null,"arrival_window":"HH:MM - HH:MM"|null,"length":str|null,"price_gbp":num|null,"service_summary":str|null,"job":str|null,"property_type":str|null,"bedrooms":num|null,"bathrooms":num|null,"additional_rooms":num|null,"tasks":[str]|null}. "contact" is the customer\'s phone number as written on the page (the "Contact" line under customer details), digits and spaces exactly as shown, null if absent. "job" is the service name as the page writes it (e.g. "End-of-tenancy clean"); "visit_date_label" the date as written (e.g. "Thursday, 20 August 2026"); "length" the booked duration if shown; "tasks" the extra/additional tasks booked for the job (e.g. "Balcony cleaning") — NEVER workflow checklist steps like "Start job", "Before photos", "Finish job", "After photos".',
          },
          { role: "user", content: texto.slice(0, 6000) },
        ],
      }),
    });
    if (!resposta.ok) return {};
    const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const j = JSON.parse(corpo.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;

    // O bloco "Job details" do card, linha a linha, só com o que existe —
    // é ele que o dono quer ver inteiro no scope do job (18/08/2026).
    const linha = (rotulo: string, v: unknown): string | null =>
      v === null || v === undefined || v === "" ? null : `${rotulo}: ${Array.isArray(v) ? v.join(", ") : String(v)}`;
    const detalhes = [
      linha("Job", j.job),
      linha("Visit date", j.visit_date_label ?? j.date),
      linha("Booked arrival time", j.arrival_window),
      linha("Length", j.length),
      linha("Property type", j.property_type),
      linha("Bedrooms", j.bedrooms),
      linha("Bathrooms", j.bathrooms),
      linha("Additional rooms", j.additional_rooms),
      linha("Tasks", j.tasks),
    ].filter(Boolean) as string[];

    return {
      clientName: (j.client_name as string) || null,
      contato: (j.contact as string) || null,
      propertyAddress: (j.property_address as string) || null,
      postcode: (j.postcode as string) || null,
      date: (j.date as string) || null,
      arrivalWindow: (j.arrival_window as string) || null,
      priceGbp: typeof j.price_gbp === "number" ? j.price_gbp : null,
      serviceSummary: (j.service_summary as string) || null,
      jobNome: (j.job as string) || null,
      detalhesJob: detalhes.length > 0 ? ["Job details", "", ...detalhes].join("\n") : null,
      // O endereço resolvido, não o rastreado: o token da newsletter expira, e
      // no backfill de 22/08 vários links antigos já não resolviam mais.
      cardUrl: urlFinal,
    };
  } finally {
    await browser.close();
  }
}

export type ResultadoBooking =
  | { status: "criado"; reference: string; nota: string }
  | { status: "faltando"; nota: string }
  | { status: "nao_e_booking" };

/**
 * Título de job NUNCA inventado (dono, 19/08/2026: "só os que já tem de type
 * of work"): o chip no OS é o título e só pode vir da lista canônica. O nome
 * específico do serviço (ex. "End-of-tenancy clean") vive no scope.
 */
function tituloCanonico(nomeServico: string | null): string {
  const nome = (nomeServico ?? "").toLowerCase();
  if (/eicr|electrical installation/.test(nome)) return "Electrical Installation Condition Report (EICR)";
  if (/gas safety|cp12/.test(nome)) return "Gas Safety Certificate (GSC)";
  if (/epc|energy performance/.test(nome)) return "General Maintenance";
  if (/clean/.test(nome)) return "Cleaning";
  if (/paint/.test(nome)) return "Painter";
  return "General Maintenance";
}

/**
 * Confirmação de PARCEIRO: ele avisa que agendou, e o job já existe.
 *
 * Regra do dono (19/08), olhando um e-mail da Landlord Certification: "esse é
 * system que manda pra nós confirmação quando eles book o job; pode ler,
 * confirmar que o job foi booked e dar solved — eles são partners". Sem isto o
 * Harvey lia a palavra "booking", tentava CRIAR job novo e parava na nota de
 * "missing info": confirmação de quem vai executar não é pedido de serviço.
 *
 * O casamento não pode ser pelo remetente: o e-mail sai do sistema deles
 * (`…@n.servicem8.com`), não do domínio da empresa. Então procura o parceiro
 * pelo NOME e pelo domínio do e-mail CADASTRADO dele dentro do texto do
 * ticket — "Landlord Certification" no assunto acha o parceiro cadastrado como
 * "LandLord Certificate", porque o domínio bate.
 */
type ResultadoConfirmacao =
  | { status: "nao_e_parceiro" }
  | { status: "confirmado"; reference: string; parceiro: string }
  | { status: "sem_job"; parceiro: string; nota: string };

const soLetras = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function acharParceiroNoTexto(
  texto: string,
): Promise<{ id: string; nome: string } | null> {
  const supabase = createServiceClient();
  // `partners` não tem deleted_at (conferido na base, 19/08): pedir a coluna
  // derruba a query inteira e o parceiro nunca é achado.
  const { data } = await supabase.from("partners").select("id, company_name, email");
  const alvo = soLetras(texto);
  for (const p of (data ?? []) as Array<{ id: string; company_name: string; email: string | null }>) {
    const nome = soLetras(p.company_name ?? "");
    // Domínio do e-mail sem o TLD: "info@landlordcertification.co.uk" vira
    // "landlordcertification", que é como a empresa assina no e-mail.
    const dominio = soLetras((p.email ?? "").split("@")[1]?.split(".")[0] ?? "");
    if (nome.length >= 6 && alvo.includes(nome)) return { id: p.id, nome: p.company_name };
    if (dominio.length >= 6 && alvo.includes(dominio)) return { id: p.id, nome: p.company_name };
  }
  return null;
}

export async function confirmarBookingDeParceiro(
  ticketId: number,
  postar: boolean,
): Promise<ResultadoConfirmacao> {
  const headers = { Authorization: authHeader() };
  const tRes = await fetch(`${baseUrl()}/tickets/${ticketId}.json`, { headers });
  if (!tRes.ok) return { status: "nao_e_parceiro" };
  const { ticket } = (await tRes.json()) as { ticket: { subject: string; description?: string } };
  const texto = `${ticket.subject ?? ""} ${ticket.description ?? ""}`;

  const parceiro = await acharParceiroNoTexto(texto);
  if (!parceiro) return { status: "nao_e_parceiro" };

  const supabase = createServiceClient();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, reference, client_name, scheduled_date, partner_confirmed_at")
    .eq("partner_id", parceiro.id)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .in("status", ["unassigned", "scheduled", "in_progress"])
    .order("scheduled_date", { ascending: true })
    .limit(50);

  /**
   * O nome do cliente no assunto é o que aponta o job: o mesmo parceiro tem
   * vários jobs abertos ao mesmo tempo. Sem o nome no texto, confirmar seria
   * chutar qual deles — e confirmação errada faz a operação achar que tem
   * eletricista a caminho de um endereço onde ninguém vai.
   */
  // "21st" vira "21" antes de normalizar: sem isso "21staugust2026" não contém
  // "21august2026" e a data do e-mail nunca casa com a do job.
  const alvo = soLetras(texto.replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1"));
  const porNome = (jobs ?? []).filter(
    (j) => j.client_name && soLetras(j.client_name).length >= 5 && alvo.includes(soLetras(j.client_name)),
  );

  /**
   * Mesmo cliente, mesma casa, dois serviços: a Chloe Christian tinha CP12 no
   * dia 20 e EICR no dia 21, os dois com este parceiro. Nome não resolve; a
   * DATA resolve, e ela está escrita no e-mail em inglês por extenso. Só entra
   * como desempate — quando o nome já deu um só, não se mexe.
   */
  const MESES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const dataNoTexto = (ymd: string | null): boolean => {
    if (!ymd) return false;
    const [a, m, d] = ymd.split("-");
    const dia = String(Number(d));
    const mes = MESES[Number(m) - 1] ?? "";
    return [`${dia}${mes}${a}`, `${mes}${dia}${a}`, `${d}${m}${a}`, `${a}${m}${d}`].some((v) => alvo.includes(v));
  };
  const candidatos =
    porNome.length > 1 && porNome.some((j) => dataNoTexto(j.scheduled_date))
      ? porNome.filter((j) => dataNoTexto(j.scheduled_date))
      : porNome;

  if (candidatos.length !== 1) {
    const nota = [
      `🤖 HARVEY — ${parceiro.nome} confirmou um agendamento, mas eu não soube qual job é.`,
      "",
      candidatos.length === 0
        ? "Nenhum job aberto deste parceiro tem o nome do cliente que aparece neste ticket."
        : `${candidatos.length} jobs abertos deste parceiro casam com o texto: ${candidatos.map((c) => c.reference).join(", ")}.`,
      "",
      "Confirme o parceiro na mão no job certo.",
    ].join("\n");
    if (postar) await postarNotaInterna(ticketId, nota);
    return { status: "sem_job", parceiro: parceiro.nome, nota };
  }

  const job = candidatos[0]!;
  // Dry-run não escreve NADA, nem no OS: `postar=false` é para conferir o
  // casamento antes de soltar o agente, e um "teste" que carimba o job no
  // banco não é teste.
  if (postar && !job.partner_confirmed_at) {
    await supabase
      .from("jobs")
      .update({ partner_confirmed_at: new Date().toISOString() })
      .eq("id", job.id);
  }

  if (postar) {
    // Nota interna E solved na MESMA chamada: dois PUTs deixavam o ticket
    // aberto quando o segundo falhava, e um ticket confirmado que continua na
    // fila é ruído que ninguém sabe de onde veio.
    await fetch(`${baseUrl()}/tickets/${ticketId}.json`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        ticket: {
          status: "solved",
          comment: {
            public: false,
            body: `🤖 HARVEY — ${parceiro.nome} confirmou o agendamento de ${job.reference} (${job.client_name}${job.scheduled_date ? `, ${job.scheduled_date}` : ""}). Marquei o parceiro como confirmado no OS e fechei este ticket.`,
          },
        },
      }),
    });
  }
  return { status: "confirmado", reference: job.reference, parceiro: parceiro.nome };
}

export async function subirJobBooked(ticketId: number, postar: boolean): Promise<ResultadoBooking> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  // Ticket que JÁ tem job no OS (subido por humano ou por outro agente) não
  // precisa de nota nenhuma — visto ao vivo em 19/08: imports manuais do dono
  // com ticket_id linkado ganhavam nota de "missing info" à toa.
  {
    const { data: existente } = await createServiceClient()
      .from("jobs")
      .select("reference")
      .eq("external_source", "zendesk")
      .eq("external_ref", String(ticketId))
      .is("deleted_at", null)
      .limit(1);
    if (existente && existente.length > 0) {
      return { status: "criado", reference: existente[0]!.reference as string, nota: "(job já existia — nada a fazer)" };
    }
  }

  const ticket = await lerTicketCompleto(ticketId);
  const ex = await extrairBooking(ticket, apiKey);
  if (!ex.isConfirmedBooking) return { status: "nao_e_booking" };

  // O e-mail da Housekeep nunca traz endereço nem os Job details; o card do
  // "Link" traz tudo. Tem link? Pesca SEMPRE (dono, 18/08: o job nasce com
  // report link, janela de chegada, length e o Job details inteiro no scope)
  // e completa só os nulos.
  if (ticket.linksHousekeep.length > 0) {
    for (const link of ticket.linksHousekeep.slice(0, 2)) {
      try {
        const card = await pescarCardHousekeep(link, apiKey);
        ex.clientName ||= card.clientName ?? null;
        ex.contato ||= card.contato ?? null;
        ex.propertyAddress ||= card.propertyAddress ?? null;
        ex.postcode ||= card.postcode ?? null;
        ex.date ||= card.date ?? null;
        ex.arrivalWindow ||= card.arrivalWindow ?? null;
        ex.priceGbp ??= card.priceGbp ?? null;
        ex.serviceSummary ||= card.serviceSummary ?? null;
        ex.jobNome ||= card.jobNome ?? null;
        ex.detalhesJob ||= card.detalhesJob ?? null;
        ex.cardUrl ||= card.cardUrl ?? null;
        if (ex.clientName && ex.contato && ex.propertyAddress && ex.date && ex.detalhesJob) break;
      } catch {
        /* card fora do ar não derruba o fluxo: os portões decidem */
      }
    }
    ex.missing = [];
  }

  // O palpite "housekeep" só vale com link deles no ticket — senão um booking
  // da Homyze sem empresa citada cairia na conta errada.
  const conta = await acharConta([ex.company, ticket.subject, ticket.linksHousekeep.length > 0 ? "housekeep" : null]);
  const faltas = [...ex.missing];
  if (!ex.clientName) faltas.push("client name");
  if (!ex.propertyAddress) faltas.push("property address");
  if (!ex.date) faltas.push("booked date");
  if (!conta) faltas.push("which B2B account this belongs to");

  if (faltas.length > 0) {
    const nota = [
      "🤖 HARVEY — booking detected, but NOT created in the OS.",
      "",
      `What I read: ${ex.serviceSummary ?? ticket.subject}`,
      "",
      "Missing before the job can exist (owner rule: no full client, no job):",
      ...[...new Set(faltas.map((f) => f.toLowerCase().replace(/_/g, " ")))].map((f) => `- ${f}`),
      "",
      "When the info lands in this ticket, REMOVE the ai_job_created tag and I will retry on my next pass — or create the job manually in the OS.",
    ].join("\n");
    if (postar) await postarNotaInterna(ticketId, nota);
    return { status: "faltando", nota };
  }

  if (!postar) {
    // Dry-run NÃO cria: mostra o que criaria. Efeito real só com postar=true.
    return {
      status: "criado",
      reference: "(dry-run, nada criado)",
      nota: `DRY-RUN — criaria: ${ex.clientName} · ${ex.propertyAddress} · ${ex.postcode ?? "s/ postcode"} · ${ex.date} · conta ${conta!.nome} · £${ex.priceGbp ?? "?"}`,
    };
  }

  // Janela completa "HH:MM - HH:MM" quando o card dá (o OS deriva início E
  // fim = length); só o início se foi só isso que veio; 09:00 como último
  // recurso. Texto solto ("Morning") não passa — o parser do OS rejeitaria.
  const janelaCrua = (ex.arrivalWindow ?? "").replace(/[‐-―−–—]/g, "-").trim();
  const arrivalTime = /^\d{1,2}:\d{2}(\s*-\s*\d{1,2}:\d{2})?$/.test(janelaCrua)
    ? janelaCrua
    : janelaCrua.match(/\d{1,2}:\d{2}/)?.[0] ?? "09:00";

  const base = process.env.MASTER_OS_BASE_URL?.trim() || "http://localhost:3000";
  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.MASTER_OS_JOB_WEBHOOK_API_KEY ?? "",
    },
    body: JSON.stringify({
      account_id: conta!.id,
      date: ex.date,
      arrival_time: arrivalTime,
      client_name: ex.clientName,
      // Sem isto o morador nasce sem telefone e nunca recebe confirmação nem
      // aviso de atraso. O card tem o número; o e-mail que abre o ticket não.
      client_phone: ex.contato ?? undefined,
      property_address: ex.propertyAddress,
      postcode: ex.postcode ?? undefined,
      title: tituloCanonico(ex.jobNome ?? ex.serviceSummary ?? ticket.subject),
      service_type: tituloCanonico(ex.jobNome ?? ex.serviceSummary ?? ticket.subject),
      // → jobs.scope: o bloco Job details INTEIRO do card (dono, 18/08).
      description: [ex.serviceSummary, ex.detalhesJob].filter(Boolean).join("\n\n") || undefined,
      client_price: ex.priceGbp ?? undefined,
      // O link tokenizado do card é onde a Stefane submete o report.
      // Só card confirmado. Cair para "qualquer link da plataforma" é como o
      // JOB-9493 saiu apontando para a home deles.
      report_link: ex.cardUrl ?? undefined,
      /**
       * Booking sem card no e-mail nasce INCOMPLETO, e isso fica escrito no
       * job em vez de virar surpresa: o e-mail da Express não traz link do
       * card (só redirects rastreados), então não há report link para a
       * Stefane nem o brief que o cliente escreveu. O Ruben preenche os dois
       * na próxima varredura completa, casando por postcode + valor.
       */
      internal_notes: [
        `Created by Harvey from Zendesk booking #${ticketId}.`,
        ex.cardUrl
          ? null
          : "No card link in this email: report link and the customer's brief are still missing. Ruben fills them from the board on his next full sweep.",
      ]
        .filter(Boolean)
        .join("\n"),
      auto_assign: false,
      // O ticket JÁ existe: linka por external_source/external_ref e ganha
      // idempotência — repostar o mesmo ticket devolve o job existente.
      ticket_id: String(ticketId),
    }),
  });
  const corpo = (await res.json().catch(() => ({}))) as { reference?: string; error?: string };
  if (!res.ok) throw new Error(`OS /api/jobs ${res.status}: ${corpo.error ?? "?"}`);

  const nota = [
    `✅ HARVEY — job ${corpo.reference ?? "?"} created in the OS from this booking.`,
    "",
    `Account: ${conta!.nome}`,
    `Client: ${ex.clientName} · ${ex.propertyAddress}${ex.postcode ? ` · ${ex.postcode}` : ""}`,
    `Date: ${ex.date}${ex.arrivalWindow ? ` · ${ex.arrivalWindow}` : ""}`,
    ex.priceGbp != null ? `Value: £${ex.priceGbp.toFixed(2)}` : "Value: not stated in ticket",
    ...(ex.cardUrl ? [`Report link: ${ex.cardUrl}`] : []),
    "",
    "Unassigned — office picks the partner in the OS.",
  ].join("\n");
  if (postar) await postarNotaInterna(ticketId, nota);
  return { status: "criado", reference: corpo.reference ?? "?", nota };
}
