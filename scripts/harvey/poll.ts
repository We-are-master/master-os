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
const TAG_JOB = "ai_job_created";
const MAX_JOBS_POR_CICLO = 2;
const SEEN_PATH = join(process.cwd(), "scripts/harvey/.seen.json");
const RECON_PATH = join(process.cwd(), "scripts/harvey/.reconciliado.json");
/** A view "Customer Support::🛠️ Jobs" — a fila oficial de jobs no Zendesk. */
const VIEW_JOBS = "5687884937759";

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
  const query = `type:ticket status<solved updated>${desde} -tags:${TAG} -tags:${TAG_JOB}`;
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
async function pedePreco(t: TicketDaBusca, apiKey: string): Promise<{ quote: boolean; booking: boolean }> {
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
            'You classify a helpdesk ticket. Answer strict JSON {"is_quote_request":boolean,"is_confirmed_booking":boolean}. is_quote_request: true ONLY when the ticket asks for a price/quote/estimate for maintenance work not yet priced. is_confirmed_booking: true ONLY when the ticket confirms work agreed to go ahead (partner booking confirmation with a date, or explicit acceptance of a quote). Invoices, complaints, job updates and payment threads are both false.',
        },
        { role: "user", content: `Subject: ${t.subject}\n\nDescription: ${t.description?.slice(0, 1500) ?? ""}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI classify: HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as {
      is_quote_request?: boolean; is_confirmed_booking?: boolean;
    };
    return { quote: j.is_quote_request === true, booking: j.is_confirmed_booking === true };
  } catch {
    return { quote: false, booking: false };
  }
}

async function adicionarTagNomeada(ticketId: number, tag: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/tickets/${ticketId}/tags.json`, {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!res.ok) throw new Error(`tag failed: HTTP ${res.status}`);
}
const adicionarTag = (ticketId: number) => adicionarTagNomeada(ticketId, TAG);

/**
 * Reconciliação (dono, 18/08: "todo job no Zendesk tem que estar no OS e não
 * cancelado — tem que bater todos"). Roda de hora em hora: varre a view Jobs
 * inteira, casa por external_ref e por JOB-#### no assunto, e posta nota ⚠️
 * SÓ em pendência nova (estado em .reconciliado.json — sem spam).
 */
async function reconciliarJobs(postarNota: (id: number, corpo: string) => Promise<void>): Promise<void> {
  const sbBase = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sbKey = process.env.SERVICE_ROLE_KEY!;

  const tickets: Array<{ id: number; subject: string; status: string }> = [];
  let url = `${baseUrl()}/views/${VIEW_JOBS}/tickets.json?per_page=100`;
  while (url) {
    const r = await fetch(url, { headers: { Authorization: authHeader() } });
    if (!r.ok) { console.error(`[harvey] reconciliacao: view HTTP ${r.status}`); return; }
    const j = (await r.json()) as { tickets?: Array<{ id: number; subject?: string; status: string }>; next_page?: string };
    for (const t of j.tickets ?? []) tickets.push({ id: t.id, subject: t.subject ?? "", status: t.status });
    url = j.next_page ?? "";
  }

  const rj = await fetch(
    `${sbBase}/rest/v1/jobs?select=reference,status,external_source,external_ref,deleted_at&limit=3000&order=created_at.desc`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
  );
  if (!rj.ok) { console.error(`[harvey] reconciliacao: jobs HTTP ${rj.status}`); return; }
  const jobs = (await rj.json()) as Array<{ reference: string; status: string; external_source: string | null; external_ref: string | null; deleted_at: string | null }>;
  const porRef = new Map(jobs.map((j) => [String(j.reference).toUpperCase(), j]));
  const porTicket = new Map(jobs.filter((j) => j.external_source === "zendesk" && j.external_ref).map((j) => [String(j.external_ref), j]));

  let alertados: number[] = [];
  try { alertados = JSON.parse(readFileSync(RECON_PATH, "utf8")) as number[]; } catch { /* primeiro uso */ }
  const jaAlertado = new Set(alertados);

  const CANCELADO = new Set(["cancelled", "canceled"]);
  let pendencias = 0, novas = 0;
  for (const t of tickets) {
    const mRef = t.subject.match(/JOB-(\d+)/i);
    const job = porTicket.get(String(t.id)) ?? (mRef ? porRef.get(`JOB-${mRef[1]}`) : undefined);
    let problema: string | null = null;
    if (!job) problema = "this job ticket has NO matching job in the OS.";
    else if (job.deleted_at) problema = `${job.reference} was DELETED in the OS but this ticket is still ${t.status}.`;
    else if (CANCELADO.has(String(job.status).toLowerCase()) && t.status !== "closed" && t.status !== "solved")
      problema = `${job.reference} is CANCELLED in the OS but this ticket is still ${t.status}.`;
    if (!problema) continue;
    pendencias++;
    if (jaAlertado.has(t.id)) continue;
    novas++;
    try {
      await postarNota(t.id, `⚠️ HARVEY — reconciliation: ${problema}\n\nEvery Zendesk job must exist and be alive in the OS (owner rule). Create/relink the job or close this ticket; I re-check hourly.`);
      jaAlertado.add(t.id);
    } catch (err) {
      console.error(`[harvey] reconciliacao: nota falhou no ${t.id}: ${err}`);
    }
  }
  writeFileSync(RECON_PATH, JSON.stringify([...jaAlertado]));
  console.log(`[harvey] reconciliacao: ${tickets.length} tickets, ${pendencias} pendencia(s), ${novas} alerta(s) novo(s)`);
}

async function ciclo(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const { cotarTicket, subirJobBooked } = await import("../../src/lib/zendesk-quoter/quoter");

  const vistos = lerVistos();
  const candidatos = (await buscarCandidatos()).filter(
    (t) =>
      !vistos.has(t.id) &&
      !t.tags.includes(TAG) &&
      !/^\s*JOB-/i.test(t.subject) &&
      // "You have N job(s) on Tue 18 Aug" da Housekeep é LEMBRETE diário dos
      // jobs do dia seguinte (dono, 18/08) — não é booking nem pedido de
      // quote. Fica no Action Required pro humano; o Harvey nem gasta
      // classificador nele.
      !/you have \d+ jobs? on /i.test(t.subject),
  );
  console.log(`[harvey] ${new Date().toISOString()} candidatos apos filtros: ${candidatos.length}`);

  let cotados = 0, criados = 0;
  for (const t of candidatos.slice(0, MAX_CLASSIFICADOS_POR_CICLO)) {
    if (cotados >= MAX_QUOTES_POR_CICLO && criados >= MAX_JOBS_POR_CICLO) break;
    let quer = { quote: false, booking: false };
    try {
      quer = await pedePreco(t, apiKey);
    } catch (err) {
      console.error(`[harvey] classificacao falhou no ${t.id}: ${err}`);
      continue;
    }
    // Booking confirmado tem prioridade sobre quote: job agendado esperando
    // no OS vale mais que um rascunho de preço.
    if (quer.booking && criados < MAX_JOBS_POR_CICLO) {
      console.log(`[harvey] #${t.id} "${t.subject.slice(0, 70)}" parece BOOKING — subindo pro OS...`);
      try {
        const r = await subirJobBooked(t.id, true);
        if (r.status === "criado") {
          vistos.add(t.id); gravarVistos(vistos);
          try { await adicionarTagNomeada(t.id, TAG_JOB); } catch (err) { console.error(`[harvey] tag job falhou no ${t.id}: ${err}`); }
          criados++;
          console.log(`[harvey] ✔ job ${r.reference} criado no OS a partir do #${t.id}`);
          continue;
        }
        if (r.status === "faltando") {
          vistos.add(t.id); gravarVistos(vistos);
          try { await adicionarTagNomeada(t.id, TAG_JOB); } catch (err) { console.error(`[harvey] tag falhou no ${t.id}: ${err}`); }
          criados++;
          console.log(`[harvey] ◐ booking no #${t.id} com dado faltando — nota interna pedindo`);
          continue;
        }
        // nao_e_booking: o extrator discordou do classificador; cai pro fluxo de quote.
      } catch (err) {
        console.error(`[harvey] booking falhou no ${t.id}: ${err}`);
        continue;
      }
    }
    if (!quer.quote || cotados >= MAX_QUOTES_POR_CICLO) {
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
  console.log(`[harvey] ciclo fechado: ${cotados} rascunho(s), ${criados} booking(s) processado(s)`);

  // De hora em hora (primeiro ciclo de cada hora): a view Jobs tem que bater
  // com o OS, job por job.
  if (new Date().getMinutes() < 5 || process.env.HARVEY_RECONCILIAR === "1") {
    const { postarNotaInterna } = await import("../../src/lib/zendesk-quoter/quoter");
    await reconciliarJobs(postarNotaInterna).catch((err) => console.error(`[harvey] reconciliacao morreu: ${err}`));
  }
}

ciclo().catch((err) => {
  console.error(`[harvey] ciclo morreu: ${err}`);
  process.exit(1);
});
