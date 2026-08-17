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
      attachments?: Array<{ file_name: string; content_url: string; content_type: string; size: number }>;
    }>;
    users?: Array<{ id: number; name: string; role: string }>;
  };

  const quem = new Map((cJson.users ?? []).map((u) => [u.id, `${u.name} (${u.role})`]));
  const partes: string[] = [];
  const anexosDeImagem: Array<{ file_name: string; content_url: string; content_type: string; size: number }> = [];
  let totalAnexos = 0;

  for (const c of cJson.comments) {
    const autor = quem.get(c.author_id) ?? `user ${c.author_id}`;
    partes.push(`[${autor}${c.public ? "" : " — internal note"}]\n${c.body.trim()}`);
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
  };
}

export type PedidoConsolidado = {
  quoteRequest: string;
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
- facts: bullet facts that support the quote (from text or photos).
- missing_info: what a surveyor would still need to ask before committing a price. Be strict — B2B quotes cannot be wrong.

JSON shape: {"quote_request":"...","facts":["..."],"missing_info":["..."]}`,
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
  const json = JSON.parse(bruto) as { quote_request?: string; facts?: string[]; missing_info?: string[] };
  if (!json.quote_request?.trim()) throw new Error("consolidation produced no quote_request");
  return {
    quoteRequest: json.quote_request.trim(),
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
  const resultado = await executarPriceCheck(pedido.quoteRequest);
  const nota = montarNotaInterna(ticket, pedido, resultado);
  if (postar) await postarNotaInterna(ticketId, nota);
  return { ticketId, nota, pedido, resultado };
}
