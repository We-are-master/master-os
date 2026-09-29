/**
 * O cérebro do Harvey no WhatsApp: recebe a conversa, consulta o site quando
 * precisa (preço, datas, link) e devolve a próxima mensagem. Não fala com o
 * WhatsApp nem com o banco: quem faz isso é o motor. Assim a bateria de testes
 * roda o mesmo cérebro com a conversa simulada.
 */

import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { promptDoHarvey } from "./prompt";
import type { ChamadaAoSite } from "./site";

export type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string };

export type Contexto = {
  telefone: string | null;
  nomeNoWhatsApp: string | null;
  campanha?: string;
  /** Preenchido pelo pensar(): o cliente já escolheu cartão ou transferência? */
  escolheuPagamento?: boolean;
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

const FERRAMENTAS = [
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
          window: { type: "string", description: "window id from get_available_dates" },
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
] as const;

type MensagemOpenAi =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

async function openai(mensagens: MensagemOpenAi[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO(), messages: mensagens, tools: FERRAMENTAS, reasoning_effort: "none" }),
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
  const r: Resultado = { resposta: null, passarParaEquipe: null, checkout: null, cotacao: null, ferramentas: [] };
  ctx = { ...ctx, escolheuPagamento: escolheuPagamento(conversa) };
  const sobre = [
    ctx.nomeNoWhatsApp ? `Their WhatsApp name is "${ctx.nomeNoWhatsApp}" (may not be their real name).` : null,
    ctx.telefone ? `Their phone (from WhatsApp): ${ctx.telefone}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const msgs: MensagemOpenAi[] = [{ role: "system", content: promptDoHarvey(catalogo) + (sobre ? `\n\n# This customer\n\n${sobre}` : "") }, ...paraOpenAi(conversa)];

  for (let volta = 0; volta < 6; volta++) {
    const m = await openai(msgs);
    msgs.push(m);
    const chamadas = m.tool_calls ?? [];
    if (!chamadas.length) {
      r.resposta = m.content ? limparTexto(m.content) : null;
      // Primeira resposta da conversa sempre se apresenta (dono, 29/09/2026):
      // não fica só na instrução, que o modelo às vezes esquece.
      const jaFalou = conversa.some((f) => f.papel !== "cliente");
      if (r.resposta && !jaFalou && !/\bI['’]m Harvey\b/i.test(r.resposta)) {
        r.resposta = `Hi there, I'm Harvey and I'll be looking after you. ${r.resposta.replace(/^(hi|hey|hello)( there)?[,!.]?\s*/i, "")}`;
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
      msgs.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(saida).slice(0, 12_000) });
    }
  }
  r.passarParaEquipe = r.passarParaEquipe ?? "Harvey could not finish his reply (too many tool calls)";
  return r;
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
  if (nome === "get_available_dates") return (await site({ action: "slots", services: Array.isArray(a.services) ? a.services : [] })).data;
  if (nome === "hand_off_to_team") {
    r.passarParaEquipe = String(a.reason || "Harvey asked for a person");
    return { ok: true, note: "The team has been told. Send one short line saying you are getting someone, then stop." };
  }
  if (nome === "create_payment_link") {
    // O modelo às vezes pula a pergunta e manda o link direto: sem escolha, não sai.
    if (!ctx.escolheuPagamento) return { error: "They have not chosen yet. Do not send a link or bank details: ask whether they want to pay the 50% deposit by card payment link or bank transfer." };
    const nomeDaPessoa = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
    const booking = {
      selection: a.selection,
      postcode: a.postcode,
      date: a.date,
      window: a.window,
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
function escolheuPagamento(conversa: Fala[]): boolean {
  const i = conversa.map((f) => f.papel).lastIndexOf("cliente");
  if (i < 0) return false;
  if (/\b(card|bank|transfer|link|stripe|bacs|apple pay|google pay)\b/i.test(conversa[i].texto)) return true;
  const antes = conversa.slice(0, i).reverse().find((f) => f.papel !== "cliente");
  return !!antes && /\bcard\b[\s\S]*\bbank\b|\bbank\b[\s\S]*\bcard\b/i.test(antes.texto);
}

/** O checkout do site exige telefone do Reino Unido: +447… vira 07…. */
function ukPhone(telefone: string | null): string {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.startsWith("44") && d.length >= 12) return `0${d.slice(2)}`;
  if (d.startsWith("0")) return d;
  return d ? `+${d}` : "";
}
