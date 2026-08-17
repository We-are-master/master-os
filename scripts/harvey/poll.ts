/**
 * HARVEY — o quoter B2B do Zendesk. Fase 1: reconhece e rascunha, nunca fala.
 *
 * A cada ciclo: procura tickets abertos recentes que PEDEM preço, lê cada um
 * inteiro (thread + fotos, com visão), cota pelo núcleo do orçamentista e
 * grava o rascunho como NOTA INTERNA — o cliente não recebe nada. É a regra
 * do dono (17/08/2026): as primeiras 10 ele revisa 100% e envia manualmente;
 * envio direto só existe noutra fase, com ordem explícita.
 *
 * Segurança em camadas: só nota interna existe no código; ticket processado
 * ganha a tag `ai_quote_draft` E entra no .seen.json local (se a tag falhar,
 * o arquivo segura); teto de quotes por ciclo; assunto "JOB-..." é ticket de
 * job do OS, não pedido de quote — pula.
 *
 *   cd ~/master-os && npx tsx scripts/harvey/poll.ts        # um ciclo
 *   launchd com.fixfy.harvey roda isto a cada 5 minutos
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ── env: scripts standalone não têm o Next para carregar .env ───────────────
// .env.local PRIMEIRO: no Next ele ganha do .env, e aqui o primeiro a setar
// vence — o .env guarda um token velho de Zendesk que dá 401 (visto na prática).
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(join(process.cwd(), arquivo), "utf8").split("\n")) {
      const m = linha.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
    }
  } catch {
    /* arquivo pode não existir */
  }
}

// Import DINÂMICO de propósito (dentro do ciclo): o zendesk.ts captura o env
// em const de módulo, e import estático é içado para antes do loader acima —
// o client nasceria "not configured". Dinâmico roda depois do env estar de pé.

const MAX_CLASSIFICADOS_POR_CICLO = 15;
const MAX_QUOTES_POR_CICLO = 3;
const JANELA_DIAS = 3;
const TAG = "ai_quote_draft";
const SEEN_PATH = join(process.cwd(), "scripts/harvey/.seen.json");

function baseUrl(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}
function authHeader(): string {
  const raw = `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function lerVistos(): Set<number> {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_PATH, "utf8")) as number[]);
  } catch {
    return new Set();
  }
}
function gravarVistos(vistos: Set<number>): void {
  if (!existsSync(dirname(SEEN_PATH))) mkdirSync(dirname(SEEN_PATH), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify([...vistos]));
}

type TicketDaBusca = { id: number; subject: string; description: string; tags: string[] };

async function buscarCandidatos(): Promise<TicketDaBusca[]> {
  const desde = new Date(Date.now() - JANELA_DIAS * 864e5).toISOString().slice(0, 10);
  const query = `type:ticket status<solved updated>${desde} -tags:${TAG}`;
  const res = await fetch(
    `${baseUrl()}/search.json?query=${encodeURIComponent(query)}&sort_by=updated_at&sort_order=desc&per_page=50`,
    { headers: { Authorization: authHeader() } },
  );
  if (!res.ok) throw new Error(`Zendesk search: HTTP ${res.status}`);
  const json = (await res.json()) as { results: TicketDaBusca[] };
  return json.results ?? [];
}

/**
 * "Isto pede preço?" — gpt-4o-mini decide pelo assunto + descrição. Barato o
 * bastante para rodar em todo candidato, estrito o bastante para não cotar
 * fatura, confirmação de agendamento ou reclamação.
 */
async function pedePreco(t: TicketDaBusca, apiKey: string): Promise<boolean> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
            'You classify a helpdesk ticket. Answer strict JSON {"is_quote_request":boolean}. true ONLY when the ticket asks for a price, quote, quotation or estimate for property maintenance/trade work that has not been priced yet. Booking confirmations, invoices, complaints, job updates and payment threads are false.',
        },
        { role: "user", content: `Subject: ${t.subject}\n\nDescription: ${t.description?.slice(0, 1500) ?? ""}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI classify: HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  try {
    return (JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as { is_quote_request?: boolean })
      .is_quote_request === true;
  } catch {
    return false;
  }
}

async function adicionarTag(ticketId: number): Promise<void> {
  const res = await fetch(`${baseUrl()}/tickets/${ticketId}/tags.json`, {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ tags: [TAG] }),
  });
  if (!res.ok) throw new Error(`tag failed: HTTP ${res.status}`);
}

async function ciclo(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const { cotarTicket } = await import("../../src/lib/zendesk-quoter/quoter");

  const vistos = lerVistos();
  const candidatos = (await buscarCandidatos()).filter(
    (t) => !vistos.has(t.id) && !t.tags.includes(TAG) && !/^\s*JOB-/i.test(t.subject),
  );
  console.log(`[harvey] ${new Date().toISOString()} candidatos apos filtros: ${candidatos.length}`);

  let cotados = 0;
  for (const t of candidatos.slice(0, MAX_CLASSIFICADOS_POR_CICLO)) {
    if (cotados >= MAX_QUOTES_POR_CICLO) break;
    let quer = false;
    try {
      quer = await pedePreco(t, apiKey);
    } catch (err) {
      console.error(`[harvey] classificacao falhou no ${t.id}: ${err}`);
      continue;
    }
    if (!quer) {
      // Não marca visto: um ticket pode virar pedido de quote num comentário
      // futuro, e a janela de busca é curta o bastante para reavaliar barato.
      continue;
    }

    console.log(`[harvey] #${t.id} "${t.subject.slice(0, 70)}" pede preco — cotando...`);
    try {
      const r = await cotarTicket(t.id, true); // true = POSTA a nota INTERNA
      vistos.add(t.id);
      gravarVistos(vistos);
      try {
        await adicionarTag(t.id);
      } catch (err) {
        console.error(`[harvey] nota postada mas a tag falhou no ${t.id} (o .seen segura): ${err}`);
      }
      cotados++;
      console.log(
        `[harvey] ✔ rascunho interno no #${t.id}: £${r.resultado.quote.total.toFixed(2)} · ` +
          `${r.pedido.missingInfo.length} pergunta(s) pendente(s) · ${r.resultado.quote.gaps.length} gap(s)`,
      );
    } catch (err) {
      console.error(`[harvey] cotacao falhou no ${t.id}: ${err}`);
    }
  }
  console.log(`[harvey] ciclo fechado: ${cotados} rascunho(s) interno(s)`);
}

ciclo().catch((err) => {
  console.error(`[harvey] ciclo morreu: ${err}`);
  process.exit(1);
});
