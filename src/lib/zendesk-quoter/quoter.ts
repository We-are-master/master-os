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
      if (!linksHousekeep.includes(url)) linksHousekeep.push(url);
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
async function pescarCardHousekeep(url: string, apiKey: string): Promise<Partial<ExtracaoBooking>> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
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
              'You extract job details from a Housekeep partner job page text. ONLY values written explicitly on the page; anything absent is null. Reply strict JSON: {"client_name":str|null,"property_address":str|null,"postcode":str|null,"date":"YYYY-MM-DD"|null,"arrival_window":str|null,"price_gbp":num|null,"service_summary":str|null}',
          },
          { role: "user", content: texto.slice(0, 6000) },
        ],
      }),
    });
    if (!resposta.ok) return {};
    const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const j = JSON.parse(corpo.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    return {
      clientName: (j.client_name as string) || null,
      propertyAddress: (j.property_address as string) || null,
      postcode: (j.postcode as string) || null,
      date: (j.date as string) || null,
      arrivalWindow: (j.arrival_window as string) || null,
      priceGbp: typeof j.price_gbp === "number" ? j.price_gbp : null,
      serviceSummary: (j.service_summary as string) || null,
    };
  } finally {
    await browser.close();
  }
}

export type ResultadoBooking =
  | { status: "criado"; reference: string; nota: string }
  | { status: "faltando"; nota: string }
  | { status: "nao_e_booking" };

export async function subirJobBooked(ticketId: number, postar: boolean): Promise<ResultadoBooking> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const ticket = await lerTicketCompleto(ticketId);
  const ex = await extrairBooking(ticket, apiKey);
  if (!ex.isConfirmedBooking) return { status: "nao_e_booking" };

  // O e-mail da Housekeep nunca traz o endereço; o card do "Link" sempre.
  // Faltou dado essencial E tem link? Pesca no card e completa só os nulos.
  if ((!ex.clientName || !ex.propertyAddress || !ex.date) && ticket.linksHousekeep.length > 0) {
    for (const link of ticket.linksHousekeep.slice(0, 2)) {
      try {
        const card = await pescarCardHousekeep(link, apiKey);
        ex.clientName ||= card.clientName ?? null;
        ex.propertyAddress ||= card.propertyAddress ?? null;
        ex.postcode ||= card.postcode ?? null;
        ex.date ||= card.date ?? null;
        ex.arrivalWindow ||= card.arrivalWindow ?? null;
        ex.priceGbp ??= card.priceGbp ?? null;
        ex.serviceSummary ||= card.serviceSummary ?? null;
        if (ex.clientName && ex.propertyAddress && ex.date) break;
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
      arrival_time: ex.arrivalWindow?.split("-")[0]?.trim() || "09:00",
      client_name: ex.clientName,
      property_address: ex.propertyAddress,
      postcode: ex.postcode ?? undefined,
      title: ex.serviceSummary?.slice(0, 120) ?? ticket.subject,
      service_type: "General Maintenance",
      description: ex.serviceSummary ?? undefined,
      client_price: ex.priceGbp ?? undefined,
      internal_notes: `Created by Harvey from Zendesk booking #${ticketId} (${conta!.nome}).`,
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
    "",
    "Unassigned — office picks the partner in the OS.",
  ].join("\n");
  if (postar) await postarNotaInterna(ticketId, nota);
  return { status: "criado", reference: corpo.reference ?? "?", nota };
}
