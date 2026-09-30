/**
 * O cérebro do Harvey no WhatsApp: recebe a conversa, consulta o site quando
 * precisa (preço, datas, link) e devolve a próxima mensagem. Não fala com o
 * WhatsApp nem com o banco: quem faz isso é o motor. Assim a bateria de testes
 * roda o mesmo cérebro com a conversa simulada.
 */

import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { promptDoHarvey, promptDoParceiro } from "./prompt";
import type { ChamadaAoSite } from "./site";

export type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string; /** foto ou PDF que o cliente mandou */ midia?: string };

/** O que o Harvey consulta e grava no OS. O motor liga no banco; a bateria usa de mentira. */
export type Contas = {
  reservas: (email?: string | null) => Promise<unknown>;
  situacaoDoParceiro?: () => Promise<unknown>;
  salvarDocumento?: (tipo: string, mediaUrl: string) => Promise<unknown>;
};

export type Contexto = {
  telefone: string | null;
  nomeNoWhatsApp: string | null;
  campanha?: string;
  /** Preenchido pelo pensar(): o que o cliente escolheu para o sinal (vale a conversa toda). */
  pagamento?: "card" | "bank" | null;
  /** Quem escreve: parceiro fala com o Harvey dos parceiros (documentos, jobs). */
  quem?: "parceiro" | "cliente" | "novo";
  /** Uma linha sobre a pessoa, do OS (nome, status do parceiro). */
  sobreQuem?: string;
  contas?: Contas;
  /** Chase: a pessoa parou de responder; este é o lembrete n (1 a 3). */
  chase?: number;
  /** Horas desde a última mensagem da pessoa (para o chase). */
  horasSemResposta?: number;
  /** Preenchido pelo pensar(): a última foto/PDF que a pessoa mandou nesta conversa. */
  ultimaMidia?: string | null;
};

export type Resultado = {
  resposta: string | null;
  passarParaEquipe: string | null;
  checkout: {
    ref: string;
    /** Link do Stripe (cartão); vazio na transferência. */
    url: string;
    metodo: "card" | "bank";
    total: number;
    deposit: boolean;
    /** Os 50% que seguram a vaga. */
    sinal: number;
    /** Jobs que nasceram no OS (só na transferência: no cartão nascem quando paga). */
    jobIds: string[];
    email: string;
    nome: string;
    servico: string;
    postcode: string;
  } | null;
  cotacao: { servico: string; total: number; postcode: string | null } | null;
  ferramentas: string[];
  /** Documentos de parceiro gravados nesta resposta (para o log). */
  documentos: unknown[];
};

const MODELO = () => process.env.HARVEY_WA_MODEL?.trim() || "gpt-5.4";

/** O formato que o site entende. Tipado para o modelo não mandar `services: "clean"` (virava total £0). */
const SELECAO = {
  type: "object",
  properties: {
    services: { type: "array", items: { type: "string", enum: ["clean", "paint", "fix", "cert"] } },
    size: { type: "string", enum: ["studio", "1", "2", "3", "4", "5"] },
    bathrooms: { type: "integer", minimum: 1, maximum: 4 },
    clean: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["eot", "deep", "after"] },
        extras: { type: "object", properties: { carpet: { type: "integer", description: "rooms" }, fridge: { type: "integer" }, windows: { type: "integer" }, balcony: { type: "integer" } } },
      },
    },
    paint: { type: "object", properties: { option: { type: "string", enum: ["touchup", "rooms"] }, rooms: { type: "integer" }, materials: { type: "boolean" } } },
    fix: { type: "object", properties: { tasks: { type: "array", items: { type: "string" } }, package: { type: "string", enum: ["half", "day"] } } },
    cert: { type: "object", properties: { items: { type: "array", items: { type: "string", enum: ["gas", "eicr", "epc"] } } } },
  },
  required: ["services"],
} as const;

const FERRAMENTAS_CLIENTE = [
  {
    type: "function",
    function: {
      name: "get_quote",
      description: "Exact fixed price (VAT included) for a selection of services, straight from the website price table. Also checks the postcode is covered. Call it every time before saying a price.",
      parameters: {
        type: "object",
        properties: {
          selection: SELECAO,
          postcode: { type: "string" },
          promoCode: { type: "string" },
        },
        required: ["selection"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_dates",
      description: "The days and arrival windows that can be booked for these services (Monday to Saturday, never same day, fully booked days left out).",
      parameters: {
        type: "object",
        properties: { services: { type: "array", items: { type: "string", enum: ["clean", "paint", "fix", "cert"] }, description: "what they are booking" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_payment_link",
      description:
        "Takes the 50% deposit that secures the booking. method=card creates the secure Stripe link for the deposit (paying it creates the booking). method=bank books the slot as awaiting a bank transfer and returns the bank details, the amount and the reference; the slot is held for 24 hours. Only when every field is agreed, including card or bank. Never call it before they chose.",
      parameters: {
        type: "object",
        properties: {
          selection: SELECAO,
          postcode: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD from get_available_dates" },
          window: { type: "string", enum: ["morning", "early_afternoon", "afternoon", "all_day"], description: "morning = 9am to 12pm, early_afternoon = 12pm to 3pm, afternoon = 3pm to 6pm, all_day = 9am to 6pm" },
          access: { type: "string", enum: ["meet", "agent", "keysafe", "concierge"] },
          accessNote: { type: "string" },
          parking: { type: "string", enum: ["free", "paid", "none"] },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          addressLine1: { type: "string", description: "house number and street" },
          addressLine2: { type: "string", description: "flat or unit, if any" },
          notes: { type: "string", description: "anything the team should know, in English" },
          promoCode: { type: "string" },
          method: { type: "string", enum: ["card", "bank"], description: "card = Stripe link, bank = bank transfer" },
        },
        required: ["selection", "postcode", "date", "window", "access", "parking", "firstName", "lastName", "email", "addressLine1", "method"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hand_off_to_team",
      description: "Pass the conversation to a person from the team. Use it for complaints, existing bookings, requests for a person, anything outside the catalogue or anything you do not know.",
      parameters: { type: "object", properties: { reason: { type: "string", description: "one line in English: what is needed and why" } }, required: ["reason"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_bookings",
      description: "Their existing bookings with Fixfy (found by their WhatsApp number, or by the email they booked with): day, arrival window, status, who is going, and any balance to pay with its link. Use it whenever they ask about a booking they already have.",
      parameters: { type: "object", properties: { email: { type: "string", description: "only if they gave the email they booked with" } } },
    },
  },
] as const;

const FERRAMENTAS_PARCEIRO = [
  {
    type: "function",
    function: {
      name: "get_my_account",
      description: "The partner's account: status, which documents are missing to be activated, documents waiting for review or expired, and their upcoming jobs.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_document",
      description: "Saves the photo or PDF the partner just sent as one of their documents and checks it. Call it right after they send the file, with what the document is. If it is approved and the essentials are complete, their account is activated.",
      parameters: {
        type: "object",
        properties: { doc_type: { type: "string", enum: ["id_proof", "right_to_work", "insurance", "proof_of_address", "dbs", "certification"] } },
        required: ["doc_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hand_off_to_team",
      description: "Pass the conversation to a person from the team: payments and self-bills, disputes, cancelling or moving a job, anything you cannot answer.",
      parameters: { type: "object", properties: { reason: { type: "string", description: "one line in English: what is needed and why" } }, required: ["reason"] },
    },
  },
] as const;

type MensagemOpenAi =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

async function openai(mensagens: MensagemOpenAi[], ferramentas: readonly unknown[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO(), messages: mensagens, tools: ferramentas, reasoning_effort: "none" }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { choices: Array<{ message: MensagemOpenAi & { role: "assistant" } }> };
  return j.choices[0].message;
}

/** A conversa vira mensagens do modelo: o cliente é "user", o Harvey e a equipe são "assistant". */
function paraOpenAi(conversa: Fala[]): MensagemOpenAi[] {
  return conversa.map((f) =>
    f.papel === "cliente"
      ? { role: "user" as const, content: f.texto }
      : { role: "assistant" as const, content: f.papel === "equipe" ? `[team member wrote] ${f.texto}` : f.texto },
  );
}

function limparTexto(t: string): string {
  // Regra do dono: travessão nunca. O modelo às vezes escapa, então a vírgula entra no lugar.
  return t.replace(/\s*[—–]\s*/g, ", ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function pensar(conversa: Fala[], ctx: Contexto, site: ChamadaAoSite, catalogo: unknown): Promise<Resultado> {
  const r: Resultado = { resposta: null, passarParaEquipe: null, checkout: null, cotacao: null, ferramentas: [], documentos: [] };
  const parceiro = ctx.quem === "parceiro";
  const midias = conversa.filter((f) => f.papel === "cliente" && f.midia);
  ctx = { ...ctx, pagamento: escolhaDePagamento(conversa), ultimaMidia: midias[midias.length - 1]?.midia ?? null };
  const sobre = [
    ctx.nomeNoWhatsApp ? `Their WhatsApp name is "${ctx.nomeNoWhatsApp}" (may not be their real name).` : null,
    ctx.telefone ? `Their phone (from WhatsApp): ${ctx.telefone}.` : null,
    ctx.sobreQuem ?? null,
    ctx.pagamento ? `They already chose to pay the deposit by ${ctx.pagamento === "card" ? "card payment link" : "bank transfer"}: never ask again, use method ${ctx.pagamento}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const msgs: MensagemOpenAi[] = [{ role: "system", content: (parceiro ? promptDoParceiro() : promptDoHarvey(catalogo)) + (sobre ? `\n\n# ${parceiro ? "This partner" : "This customer"}\n\n${sobre}` : "") + (ctx.chase ? instrucaoDeChase(ctx.chase, ctx.horasSemResposta ?? 1) : "") }, ...paraOpenAi(conversa)];

  for (let volta = 0; volta < 6; volta++) {
    const m = await openai(msgs, parceiro ? FERRAMENTAS_PARCEIRO : FERRAMENTAS_CLIENTE);
    msgs.push(m);
    const chamadas = m.tool_calls ?? [];
    if (!chamadas.length) {
      r.resposta = m.content ? limparTexto(m.content) : null;
      if (ctx.chase && (!r.resposta || /\bNO_CHASE\b/.test(r.resposta))) {
        r.resposta = null;
        return r;
      }
      // Primeira resposta da conversa sempre se apresenta (dono, 29/09/2026):
      // não fica só na instrução, que o modelo às vezes esquece.
      const jaFalou = conversa.some((f) => f.papel !== "cliente");
      if (r.resposta && !jaFalou && !/\bI['’]m Harvey\b/i.test(r.resposta)) {
        r.resposta = `Hi there, I'm Harvey and I'll be looking after you. ${r.resposta.replace(/^(hi|hey|hello)( there)?[,!.]?\s*/i, "")}`;
      }
      // Disse que vai chamar alguém sem chamar a ferramenta: a passagem acontece do mesmo jeito.
      if (r.resposta && !r.passarParaEquipe && /\b(grab|get|getting|bring in)\b[^.]{0,20}\b(someone|a person|the team)\b/i.test(r.resposta)) {
        r.passarParaEquipe = "Harvey said he would get the team (no tool call): check the conversation";
      }
      // Já se apresentou nesta conversa: nunca de novo.
      if (r.resposta && jaFalou) {
        const sem = r.resposta.replace(/^(hi|hey|hello)( there)?[,!.]?\s*I['’]m Harvey[^.!?]*[.!?]\s*/i, "").trim();
        if (sem) r.resposta = sem.charAt(0).toUpperCase() + sem.slice(1);
      }
      return r;
    }
    for (const c of chamadas) {
      r.ferramentas.push(c.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        /* argumento quebrado vira objeto vazio e o site responde o erro */
      }
      let saida: unknown;
      try {
        saida = await executar(c.function.name, args, ctx, site, r);
      } catch (err) {
        saida = { error: err instanceof Error ? err.message : String(err) };
      }
      // Erro de ferramenta sempre no log: é onde o Harvey "viaja" (teste de 29/09).
      if (saida && typeof saida === "object" && "error" in saida) console.warn("[harvey-wa] ferramenta com erro", c.function.name, c.function.arguments.slice(0, 400), JSON.stringify(saida).slice(0, 300));
      msgs.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(saida).slice(0, 12_000) });
    }
  }
  r.passarParaEquipe = r.passarParaEquipe ?? "Harvey could not finish his reply (too many tool calls)";
  return r;
}

/**
 * O lembrete para quem parou de responder: curto, do que ficou pendente, sem
 * repetir a conversa. Sem nada pendente (já pagou, disse tchau, passou para a
 * equipe), o modelo responde NO_CHASE e nada sai.
 */
function instrucaoDeChase(n: number, horas: number): string {
  return `

# Follow up (this is not a reply)

They have not replied for about ${Math.max(1, Math.round(horas))} hour${horas >= 1.5 ? "s" : ""}. Write follow up ${n} of 3: one short, friendly line about what is still pending, the way a person would nudge a mate. Pick up exactly where the conversation stopped (the question you asked, the price, the day you are holding, the payment link) and make it easy to answer. If a payment link was sent, it expires after an hour: offer a fresh one, or create it if you have everything. Do not restate the price or anything already said, and do not quote again: ask the pending question again in fresh words ("Still keen on Thursday or Friday morning?"). Never pressure, never invent urgency.${n === 3 ? " This is the last one: say you'll leave it with them and they can message any time." : ""}
If nothing is pending (they said thanks or goodbye, already paid, said no, asked to stop, or it was handed to the team), reply exactly NO_CHASE.`;
}

/** Mesmo com o esquema, o modelo às vezes manda um serviço solto: vira lista. */
function selecaoLimpa(sel: unknown): Record<string, unknown> {
  const s = (sel && typeof sel === "object" ? { ...(sel as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (typeof s.services === "string") s.services = [s.services];
  if (s.size != null) s.size = String(s.size);
  return s;
}

async function executar(nome: string, a: Record<string, unknown>, ctx: Contexto, site: ChamadaAoSite, r: Resultado): Promise<unknown> {
  if ("selection" in a) a.selection = selecaoLimpa(a.selection);
  if (nome === "get_quote") {
    const { data } = await site({ action: "quote", selection: a.selection, postcode: a.postcode, promoCode: a.promoCode });
    const linhas = (data.lines as Array<{ label: string }> | undefined) ?? [];
    if (typeof data.total === "number") r.cotacao = { servico: linhas.map((l) => l.label).join(" + "), total: data.total, postcode: (data.postcode as string) ?? null };
    return data;
  }
  if (nome === "get_my_bookings") return ctx.contas ? ctx.contas.reservas(typeof a.email === "string" ? a.email : null) : { error: "not available" };
  if (nome === "get_my_account") return ctx.contas?.situacaoDoParceiro ? ctx.contas.situacaoDoParceiro() : { error: "not available" };
  if (nome === "save_document") {
    if (!ctx.ultimaMidia) return { error: "No file received yet. Ask them to send a clear photo or a PDF of the document here." };
    if (!ctx.contas?.salvarDocumento) return { error: "not available" };
    const d = await ctx.contas.salvarDocumento(String(a.doc_type), ctx.ultimaMidia);
    r.documentos.push(d);
    return d;
  }
  if (nome === "get_available_dates") return (await site({ action: "slots", services: Array.isArray(a.services) ? a.services : [] })).data;
  if (nome === "hand_off_to_team") {
    r.passarParaEquipe = String(a.reason || "Harvey asked for a person");
    return { ok: true, note: "The team has been told. Send one short line saying you are getting someone, then stop." };
  }
  if (nome === "create_payment_link") {
    // O modelo às vezes pula a pergunta e manda o link direto: sem escolha, não sai.
    if (!ctx.pagamento) return { error: "They have not chosen yet. Do not send a link or bank details: ask whether they want to pay the 50% deposit by card payment link or bank transfer." };
    const nomeDaPessoa = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
    const booking = {
      selection: a.selection,
      postcode: a.postcode,
      date: a.date,
      window: janelaDoSite(a.window),
      access: a.access,
      accessNote: a.accessNote ?? "",
      parking: a.parking,
      notes: [a.notes, "Booked on WhatsApp with Harvey."].filter(Boolean).join(" "),
      contact: { firstName: a.firstName, lastName: a.lastName, email: a.email, phone: ukPhone(ctx.telefone) },
      address: { line1: a.addressLine1, line2: a.addressLine2 ?? "" },
      promoCode: a.promoCode || undefined,
    };
    const comum = { email: String(a.email), nome: nomeDaPessoa, servico: r.cotacao?.servico ?? "", postcode: String(a.postcode ?? ""), deposit: true };
    // Sempre 50% adiantado (dono, 29/09/2026): no cartão ou na transferência.
    if (ctx.pagamento) a.method = ctx.pagamento;
    if (a.method === "bank") {
      // Os mesmos dados das faturas; HARVEY_BANK_DETAILS só se um dia quiser outra conta.
      const banco = process.env.HARVEY_BANK_DETAILS?.trim() || FIXFY_CLIENT_BANK_DETAIL_ROWS.filter((l) => l.label !== "IBAN").map((l) => `${l.label}: ${l.value}`).join("\n");
      const { status, data } = await site({ action: "bank", booking, campaign: ctx.campanha || "wa_v1" });
      if (status !== 200 || typeof data.ref !== "string") return { error: data.error || `could not book it (${status})`, errors: data.errors };
      const total = Number(data.total);
      const sinal = Number(data.deposit);
      const jobs = (data.jobs as Array<{ id: string }> | undefined) ?? [];
      r.checkout = { ...comum, ref: data.ref, url: "", metodo: "bank", total, sinal, jobIds: jobs.map((j) => j.id) };
      return {
        ref: data.ref,
        total,
        payNow: sinal,
        payLater: Math.round((total - sinal) * 100) / 100,
        bankDetails: banco,
        note: "The booking is recorded and waiting for the deposit. In this reply: the booking in one line, then Fixfy's bank details exactly as given (they are ours and safe to share), the amount to send now (payNow) and the reference (ref) to put on the transfer. Say you are holding the slot for 24 hours and it is confirmed as soon as the deposit lands; the rest is paid after the job. Nothing else is needed from them.",
      };
    }
    const { status, data } = await site({ action: "checkout", booking, deposit: true, campaign: ctx.campanha || "wa_v1" });
    if (status !== 200 || typeof data.url !== "string") return { error: data.error || `could not create the link (${status})`, errors: data.errors };
    const total = Number(data.total);
    const sinal = Number(data.payNow ?? total);
    r.checkout = { ...comum, ref: String(data.ref), url: data.url, metodo: "card", total, sinal, jobIds: [] };
    return { url: data.url, ref: data.ref, total, payNow: sinal, payLater: data.payLater ?? 0, note: "Send this exact link. It expires in 1 hour; if they need longer, create a new one." };
  }
  return { error: `unknown tool ${nome}` };
}

/**
 * O cliente escolheu como pagar o sinal? Vale se a última mensagem dele fala
 * de cartão/transferência, ou se responde à pergunta do Harvey sobre isso.
 */
function escolhaDePagamento(conversa: Fala[]): "card" | "bank" | null {
  // A escolha vale para a conversa toda (a mais recente manda): antes a trava
  // só olhava a última mensagem e o Harvey perguntava "card or bank?" de novo
  // a cada resposta (teste do dono, 29/09/2026).
  let escolha: "card" | "bank" | null = null;
  conversa.forEach((f, i) => {
    if (f.papel !== "cliente") return;
    if (/\b(bank|transfer|bacs)\b/i.test(f.texto)) escolha = "bank";
    else if (/\b(card|link|stripe|apple pay|google pay)\b/i.test(f.texto)) escolha = "card";
    else {
      // Resposta curta logo depois da pergunta ("the first one", "yes"): vale a primeira opção citada.
      const antes = conversa.slice(0, i).reverse().find((x) => x.papel !== "cliente");
      if (antes && /\bcard\b[\s\S]*\bbank\b/i.test(antes.texto) && /^(the )?(first|1|link|yes|yeah|ok)\b/i.test(f.texto.trim())) escolha = "card";
    }
  });
  return escolha;
}

/**
 * A janela no formato do site. O modelo não tem mais a lista da vez em que
 * olhou as datas e chutava "am", "9-12", "09:00-12:00": o site recusava
 * ("Choose an arrival time") e o Harvey inventava resposta (teste de 29/09).
 */
export function janelaDoSite(w: unknown): string {
  const t = String(w ?? "").toLowerCase().replace(/\s+/g, "");
  if (["morning", "early_afternoon", "afternoon", "all_day"].includes(t)) return t;
  if (/all|day|9.*6|09.*18/.test(t)) return "all_day";
  if (/early|^12|noon|12.*3|12.*15/.test(t)) return "early_afternoon";
  if (/^(pm|afternoon)$|^3|^15|3.*6|15.*18/.test(t)) return "afternoon";
  if (/am|morn|^9|^09|9.*12/.test(t)) return "morning";
  return t;
}

/** O checkout do site exige telefone do Reino Unido: +447… vira 07…. */
function ukPhone(telefone: string | null): string {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) return `0${d.slice(2)}`;
  if (d.startsWith("0")) return d;
  return d ? `+${d}` : "";
}
