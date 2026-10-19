/**
 * O cérebro do Harvey no WhatsApp: recebe a conversa, consulta o site quando
 * precisa (preço, datas, link) e devolve a próxima mensagem. Não fala com o
 * WhatsApp nem com o banco: quem faz isso é o motor. Assim a bateria de testes
 * roda o mesmo cérebro com a conversa simulada.
 */

import { blocoDasRegras } from "@/lib/harvey/regras-do-negocio";
import { janelaParaOJob, precoConfere, precosDaEquipe } from "./preco-da-equipe";
import { fichaDaFerramenta, type FichaDoJob } from "./ficha-do-job";
import { ajustesDoHarvey, catalogoComAjustes, ferramentaLiberada, instrucoesDosAjustes, type AjustesDoHarvey } from "./ajustes";
import { textoDasRegras } from "./regras";
import { edicoesDoHarvey } from "./conhecimento";
import { promptDoHarvey, promptDoParceiro } from "./prompt";
import type { ChamadaAoSite } from "./site";
import { decidirDesconto } from "./desconto";
import { faltandoParaCotar, postcodeDaCotacao } from "./pedido-de-cotacao";

export type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string; /** foto ou PDF que o cliente mandou */ midia?: string };

/** O que o Harvey consulta e grava no OS. O motor liga no banco; a bateria usa de mentira. */
export type Contas = {
  reservas: (email?: string | null) => Promise<unknown>;
  /** Pedido de cotação no OS (com as fotos da conversa), ligado ao ticket do WhatsApp. */
  pedirCotacao?: (pedido: { serviceType: string; description: string; postcode: string; address?: string; name?: string; email?: string }) => Promise<unknown>;
  /** Custo do parceiro para as linhas de uma cotação, pelos Services do OS (desconto com trava de margem). */
  custoDoParceiro?: (linhas: Array<{ label?: string; amount?: number }>) => Promise<number | null>;
  /** Empresa (imobiliária, gestora, carteira): conta pendente para o dono aprovar + link da tabela de parceiro. */
  registrarEmpresa?: (dados: import("./empresa").DadosDaEmpresa) => Promise<unknown>;
  situacaoDoParceiro?: () => Promise<unknown>;
  salvarDocumento?: (tipo: string, mediaUrl: string) => Promise<unknown>;
  /** Job com o preço que a equipe deu no chat + link do sinal de 50% (ver `reserva-da-equipe.ts`). */
  reservarPrecoDaEquipe?: (r: Omit<import("./reserva-da-equipe").ReservaDaEquipe, "telefone" | "ticketId">) => Promise<import("./reserva-da-equipe").ResultadoDaReserva>;
  /** Em que pé estão as cotações do cliente (get_quote_status, ver contas.ts). */
  statusDasCotacoes?: () => Promise<unknown>;
  /** Pergunta do cliente ao profissional que cotou, na side conversation dele (ask_partner). */
  perguntarAoParceiro?: (pergunta: string) => Promise<unknown>;
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
  /** Chase: a pessoa parou de responder; este é o lembrete n (1 até maxChases()). */
  chase?: number;
  /** Horas desde a última mensagem da pessoa (para o chase). */
  horasSemResposta?: number;
  /** Preenchido pelo pensar(): tudo que o cliente escreveu (para conferir dado que o modelo diz ter recebido). */
  textoDoCliente?: string;
  /** Preenchido pelo pensar(): a conversa inteira, para conferir o preço que a equipe deu. */
  conversa?: Fala[];
  /** As fotos que o cliente mandou nesta conversa (data URLs, as mais recentes), para o Harvey ver. */
  fotos?: string[];
  /** Preenchido pelo pensar(): a última foto/PDF que a pessoa mandou nesta conversa. */
  ultimaMidia?: string | null;
  /** Preenchido pelo pensar(): os ajustes da tela /agents/harvey. */
  ajustes?: AjustesDoHarvey;
  /** O ticket do Zendesk desta conversa: o job pago nasce nele (dono, 07/10/2026). */
  ticketDaConversa?: () => Promise<number | null>;
  /** Quem da equipe estava falando com o cliente: o Harvey continua no nome dessa pessoa (dono, 08/10/2026). */
  falaComo?: string | null;
  /** Postcodes que o OS já tem desta pessoa (lead do Checkatrade, site, cliente): valem no request_quote. */
  postcodesConhecidos?: string[];
  /**
   * O que veio antes do corte de sessão (pausa de 6h), só como contexto (dono, 16/10/2026):
   * a Justine voltou 14h depois com "cancel for today", o Harvey não sabia que ela tinha
   * recusado o preço na véspera, se apresentou de novo e passou para a equipe.
   */
  conversaAnterior?: Fala[];
};

/** A conversa de antes do corte, em linhas, para o Harvey saber o que já aconteceu. */
export function instrucaoDaConversaAnterior(anterior: Fala[]): string {
  if (!anterior.length) return "";
  const linhas = anterior.map((f) => `${f.papel === "cliente" ? "Customer" : f.papel === "harvey" ? "You" : "Team"}: ${f.texto.replace(/\s+/g, " ").slice(0, 400)}`);
  return `\n\n# Earlier conversation with this customer (context only)\n\nYou have already spoken with this customer. Do not greet them as if it were the first time and do not introduce yourself or say your name again. Use this only to understand what they mean now (for example, whether they have a booking or turned down a price):\n\n${linhas.join("\n")}`;
}

/** Continuar a conversa no nome de quem da equipe falava, sem se apresentar. */
export function instrucaoDeVoz(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return `\n\n# Who you are in this chat (this overrides everything above about your name)\n\n${nome} from the team has been talking to this customer. You carry on as ${primeiro}: write in the first person as ${primeiro}, in the same tone, and pick up exactly where they left off. Never introduce yourself, never say "I'm Harvey" or mention Harvey, and never say a colleague is taking over. If the customer asks whether they are talking to ${primeiro}, to a real person or to a bot, never say what you are (no "assistant", "AI", "bot", "virtual") and never say you are ${primeiro}: answer in one line "I'm Harvey, from ${primeiro}'s team at Fixfy, and I can help you with this." and carry on. If they want ${primeiro} personally, say you'll get them and call hand_off_to_team.`;
}

export type Resultado = {
  resposta: string | null;
  passarParaEquipe: string | null;
  /** O que a equipe faz a seguir, dito pelo Harvey: "call", "quote" ou "other". Decide a etapa do ticket. */
  precisaDe?: string | null;
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
  /** O que o Harvey já sabe, para a nota interna do ticket quando passa para a equipe. */
  notaParaEquipe?: string | null;
  /** O mesmo, em campos: vai para o formulário de Job do ticket, para a equipe não digitar de novo. */
  fichaDoJob?: FichaDoJob | null;
  /** Documentos de parceiro gravados nesta resposta (para o log). */
  documentos: unknown[];
  /** Cotação pedida com o Harvey ficando na conversa: o motor põe o ticket em Bidding e a nota para a equipe. */
  cotacaoPedida?: { referencia: string; nota: string } | null;
};

const MODELO = () => process.env.HARVEY_WA_MODEL?.trim() || "gpt-5.4";

/**
 * Economia de crédito (dono, 10/10/2026): cada lembrete e cada foto é uma chamada cheia
 * ao modelo caro. Um lembrete por conversa (eram 3) e as 2 fotos mais recentes por
 * resposta (eram 4). A quote que vai para a equipe continua levando todas as fotos.
 */
export const maxChases = () => Math.min(3, Math.max(0, Math.floor(Number(process.env.HARVEY_WA_MAX_CHASES ?? "1")) || 0));
const maxFotosPorResposta = () => Math.min(4, Math.max(0, Math.floor(Number(process.env.HARVEY_WA_MAX_FOTOS ?? "2")) || 0));

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
        // Ids e quantidades vêm do catálogo (cleaning.kinds[].extras): a lista cresce pelo OS sem mexer aqui.
        extras: { type: "object", additionalProperties: { type: "integer" }, description: "add-on id from the catalog → quantity (rooms, items) or 1" },
      },
    },
    paint: { type: "object", properties: { option: { type: "string", description: "painting.options id: touchup, rooms or day" }, rooms: { type: "integer" }, materials: { type: "boolean" } } },
    fix: {
      type: "object",
      properties: {
        trade: { type: "string", description: "handyman.trades id: handyman (default), plumber or carpenter" },
        tasks: { type: "array", items: { type: "string" }, description: "handyman only" },
        package: { type: "string", description: "package id of the trade: half, day or hour" },
        hours: { type: "integer", minimum: 1, maximum: 8, description: "only for the hour package" },
      },
    },
    cert: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" }, description: "certificates[].id from the catalog" },
        options: { type: "object", additionalProperties: { type: "string" }, description: "certificate id → option id, for certificates with options (gas appliances, fire risk property type, PAT items)" },
        extra: { type: "object", additionalProperties: { type: "integer" }, description: "certificate id → extra units (extra fire doors, extra asbestos samples)" },
      },
    },
  },
  required: ["services"],
} as const;

const FERRAMENTAS_CLIENTE = [
  {
    type: "function",
    function: {
      name: "get_quote",
      description: "Exact fixed price (the professional's total price, nothing added on top) for a selection of services, straight from the website price table. Also checks the postcode is covered. Call it every time before saying a price.",
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
      name: "check_discount",
      description:
        "Only when the customer ASKS for a discount on a catalogue price. Checks how much we can take off (never more than 5%) for the same selection. If it says no, kindly explain the price is already our best; if it allows a percent, tell them the new price and pass that discount_percent when you create the payment link. Never offer a discount they did not ask for, and only once per conversation.",
      parameters: {
        type: "object",
        properties: { selection: SELECAO, postcode: { type: "string" } },
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
        "Creates the secure Stripe card link for the 50% deposit that secures the booking. Paying it creates the booking and they get the confirmation straight away. Only when every field is agreed.",
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
          discount_percent: { type: "integer", minimum: 1, maximum: 5, description: "only the percent check_discount allowed in this conversation" },
          pay_in_full: { type: "boolean", description: "true only if the payment settings let the customer choose and they asked to pay the full price now" },
        },
        required: ["selection", "postcode", "date", "window", "access", "parking", "firstName", "lastName", "email", "addressLine1"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hand_off_to_team",
      description:
        "Pass the conversation to a person from the team. Use it only for complaints, changes to existing bookings, an explicit request to speak to a person, paying by bank transfer, business terms (credit, payment terms, contracts), or something you really do not know. Not for pricing work outside the catalogue (use request_quote) and not for electrical, gas or appliance repairs (we do not do them: decline politely). What you write goes into an internal note on the ticket.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "one line in English: what is needed and why" },
          need: { type: "string", enum: ["call", "quote", "complaint", "booking", "other"], description: "what the team has to do next. call: the customer asked to be called or to speak to a person. quote: only when request_quote failed and a person has to price the job. complaint: they are unhappy with a job, want a refund, or something went wrong. booking: about an existing booking (reschedule, cancel, who is coming, timing) or paying by bank transfer. other: anything else" },
          details: { type: "string", description: "everything already agreed or known, in English, one per line: service, price, day and window, address and postcode, access, parking, name, email, anything else useful" },
          job: {
            type: "object",
            description: "what you already know about the job, so the team does not type it again. Fill in only what the customer actually told you; leave out anything you do not know. Never guess.",
            properties: {
              customer_name: { type: "string", description: "full name as they gave it" },
              email: { type: "string" },
              address: { type: "string", description: "house or flat number and street" },
              postcode: { type: "string" },
              service: { type: "string", description: "the trade or service, e.g. General Maintenance, Carpenter, Painter, Plumber, Deep Clean" },
              scope: { type: "string", description: "what needs doing, in English, in plain sentences" },
              price: { type: "number", description: "the price in pounds already given to the customer, if any" },
              rate: { type: "string", enum: ["fixed", "hourly"] },
              date: { type: "string", description: "the agreed day as YYYY-MM-DD, only if a day was agreed" },
              window: { type: "string", description: "the agreed arrival window, e.g. 9am to 12pm" },
            },
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_team_price",
      description:
        "Books a job at the price a PERSON FROM THE TEAM already gave in this chat (a price outside the catalogue), and returns the secure card link for the 50% deposit. Use it only after the customer agreed to that price and you have the day, the arrival window, their full name and the full address with postcode. Never use it for a price you worked out yourself: for catalogue prices use create_payment_link.",
      parameters: {
        type: "object",
        properties: {
          price: { type: "number", description: "the exact price in pounds the team member wrote in this chat" },
          service: { type: "string", description: "the trade, e.g. General Maintenance, Carpenter, Painter, Plumber" },
          scope: { type: "string", description: "what was agreed, in English, in plain sentences: what needs doing, what the customer supplies, access notes" },
          date: { type: "string", description: "the agreed day as YYYY-MM-DD" },
          window: { type: "string", description: "the agreed arrival window, e.g. 9am to 12pm" },
          fullName: { type: "string", description: "the customer's full name as they gave it" },
          email: { type: "string", description: "only if they gave one" },
          addressLine1: { type: "string", description: "flat or house number and street" },
          postcode: { type: "string" },
        },
        required: ["price", "scope", "date", "window", "fullName", "addressLine1", "postcode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_quote",
      description:
        "Asks our professionals for a fixed price, with the photos they sent. Use it for work that is not in the catalogue, or where the photos, a video or the details decide the price (repairs outside the price list, bespoke work, projects), once they want a price. The minimum: what needs doing (clear, with what the photos show), the postcode, and photos or a short video (or why they cannot send any). The full address, whether the property is empty or lived in, and when they want it done help the professionals: include them if you have them, but never hold the request for them (ask for the address later, before booking). The right professionals are asked straight away and you stay in the chat. Never quote bespoke work yourself, and decline work at height (gutters, roofs, high ladders).",
      parameters: {
        type: "object",
        properties: {
          service_type: { type: "string", description: "the trade, e.g. Plumbing, Carpentry, Painting, Cleaning" },
          description: { type: "string", description: "the job in English: what needs doing, which rooms/areas, and what you saw in the photos" },
          postcode: { type: "string", description: "the postcode they gave, or the one already on their request" },
          address: { type: "string", description: "house number and street, only if you have it" },
          occupancy: { type: "string", description: "empty, furnished, or lived in, only if you know" },
          timing: { type: "string", description: "when they want it done, only if you know" },
          no_photos_reason: { type: "string", description: "only if they cannot send photos: why" },
          name: { type: "string" },
          email: { type: "string" },
        },
        required: ["service_type", "description", "postcode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_quote_status",
      description:
        "Where their quote is now (inviting professionals, waiting for prices, priced, sent) with the total and the accept link once it was sent, and the professional's answer to any question they asked. Use it whenever they ask for news on a quote, instead of handing off.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_partner",
      description:
        "Sends the customer's question about the work being quoted (materials, finish, what is included, how long it takes) to the professional who priced it, by email. Use it when you cannot answer from the quote yourself. The answer comes back later: never guess it.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "the customer's question in plain English, as the professional should read it" } },
        required: ["question"],
      },
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
  {
    type: "function",
    function: {
      name: "register_business",
      description:
        "When the person writes for a BUSINESS (letting or estate agent, property manager, block manager, landlord with several properties, short lets or serviced apartments, student housing) and wants ongoing work or an account. Collect first, one question per message: company name, their name and role, work email, roughly how many properties and where, and which services they need. It sets up their business account for the team to approve and returns the link to our partner price list (5% below our standard prices), which you send them. Never promise payment terms or more discount: the team agrees those.",
      parameters: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          contact_name: { type: "string" },
          role: { type: "string" },
          email: { type: "string", description: "their work email" },
          properties: { type: "string", description: "how many properties and what kind" },
          area: { type: "string", description: "where the properties are" },
          services: { type: "string", description: "which services they need, in English" },
          finance_email: { type: "string", description: "only if they gave one for invoices" },
          company_number: { type: "string", description: "Companies House number, only if they gave it" },
        },
        required: ["company_name", "contact_name", "email", "services"],
      },
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
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "one line in English: what is needed and why" },
          details: { type: "string", description: "what you know that helps the team, in English" },
        },
        required: ["reason"],
      },
    },
  },
] as const;

/** As palavras de uma frase, sem pontuação nem maiúscula (para comparar frases). */
function palavras(frase: string): Set<string> {
  return new Set(frase.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9£.]+/).map((w) => w.replace(/\.$/, "")).filter(Boolean));
}

/** Duas frases dizem a mesma coisa (≥ 60% das palavras em comum, frase de 5+ palavras)? */
export function quaseIgual(a: string, b: string): boolean {
  const x = palavras(a);
  const y = palavras(b);
  if (x.size < 5 || y.size < 5) return false;
  let comum = 0;
  for (const w of x) if (y.has(w)) comum++;
  return comum / (x.size + y.size - comum) >= 0.6;
}

export function frasesDe(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
}

/**
 * Tira da resposta a frase que o Harvey já disse nesta conversa (dono, 07/10/2026:
 * "ninguém compra de IA"; repetir o pacote inteiro a cada pergunta soa robô).
 * Se sobraria nada, devolve a resposta como veio.
 */
export function semRepetir(resposta: string, jaDito: string[]): string {
  const antes = jaDito.flatMap(frasesDe);
  const valoresDitos = new Set(jaDito.join(" ").match(/£\d[\d,]*(?:\.\d+)?/g) ?? []);
  // Link (um novo da Stripe) e valor que ainda não saiu (total novo) ficam sempre.
  const fica = (f: string) => /https?:\/\//.test(f) || (f.match(/£\d[\d,]*(?:\.\d+)?/g) ?? []).some((v) => !valoresDitos.has(v));
  const linhas = resposta.split(/\n+/).map((l) => frasesDe(l).filter((f) => fica(f) || !antes.some((d) => quaseIgual(f, d))).join(" ")).filter(Boolean);
  return linhas.length ? linhas.join("\n\n") : resposta;
}

/** A resposta oferece um dia ("Friday is free", "I have Thursday or Friday available")? */
export function ofereceDia(t: string): boolean {
  const dia = "(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|tomorrow|this week|next week";
  const livre = "free|available|open|slots?|space|could do|can do|works for us";
  return new RegExp(`\\b(?:${dia})\\b[^.?!\\n]{0,60}\\b(?:${livre})\\b|\\b(?:${livre})\\b[^.?!\\n]{0,40}\\b(?:${dia})\\b`, "i").test(t);
}

type MensagemOpenAi =
  | { role: "system" | "user" | "assistant"; content: string | null | Array<Record<string, unknown>>; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

async function openai(mensagens: MensagemOpenAi[], ferramentas: readonly unknown[]) {
  // 429 de limite por minuto passa em segundos: espera e tenta de novo (até 3 vezes).
  for (let tentativa = 0; ; tentativa++) {
    const r = await openaiUmaVez(mensagens, ferramentas);
    if (r !== "429") return r;
    if (tentativa >= 2) throw new Error("OpenAI 429: rate limit");
    await new Promise((ok) => setTimeout(ok, 4000 * (tentativa + 1)));
  }
}

async function openaiUmaVez(mensagens: MensagemOpenAi[], ferramentas: readonly unknown[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO(), messages: mensagens, tools: ferramentas, reasoning_effort: "none" }),
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 429 && !/insufficient_quota/.test(await res.clone().text())) return "429" as const;
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
  const ajustes = await ajustesDoHarvey();
  // Acesso desligado na tela = ferramenta fora da lista: ele não tem como usar.
  const ferramentas = (parceiro ? FERRAMENTAS_PARCEIRO : FERRAMENTAS_CLIENTE).filter((f) => ferramentaLiberada(f.function.name, ajustes));
  // As regras do OS (/rules): o que vale para este público, lido a cada 30 s.
  const regrasDoOs = await textoDasRegras(parceiro ? "parceiro" : "cliente");
  ctx = { ...ctx, ajustes, conversa, textoDoCliente: conversa.filter((f) => f.papel === "cliente").map((f) => f.texto).join(" "), pagamento: escolhaDePagamento(conversa), ultimaMidia: midias[midias.length - 1]?.midia ?? null };
  const sobre = [
    ctx.nomeNoWhatsApp ? `Their WhatsApp name is "${ctx.nomeNoWhatsApp}" (may not be their real name).` : null,
    ctx.telefone ? `Their phone (from WhatsApp): ${ctx.telefone}.` : null,
    ctx.sobreQuem ?? null,
    ctx.pagamento === "bank"
      ? ajustes.transferencia === "so_cartao"
        ? "They asked to pay by bank transfer: we only take the secure card link. Tell them kindly and carry on with the card link."
        : "They asked to pay by bank transfer: we only take card online, so hand off to the team with every booking detail."
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const n = maxFotosPorResposta();
  const fotos = parceiro || n === 0 ? [] : (ctx.fotos ?? []).slice(-n);
  // O que a equipe editou na tela /agents/harvey (cache de 30 s).
  const edicoes = await edicoesDoHarvey(parceiro ? "parceiro" : "cliente");
  const regras = parceiro ? "" : [await blocoDasRegras(), instrucoesDosAjustes(ajustes)].filter(Boolean).join("\n\n");
  const msgs: MensagemOpenAi[] = [{ role: "system", content: (parceiro ? promptDoParceiro(new Date(), edicoes) : promptDoHarvey(catalogoComAjustes(catalogo, ajustes), new Date(), edicoes)) + (regrasDoOs ? `\n\n${regrasDoOs}` : "") + (regras ? `\n\n${regras}` : "") + (sobre ? `\n\n# ${parceiro ? "This partner" : "This customer"}\n\n${sobre}` : "") + (ctx.falaComo && !parceiro ? instrucaoDeVoz(ctx.falaComo) : "") + (ctx.chase ? instrucaoDeChase(ctx.chase, ctx.horasSemResposta ?? 1) : "") + (ctx.conversaAnterior?.length && !parceiro ? instrucaoDaConversaAnterior(ctx.conversaAnterior) : "") }, ...paraOpenAi(conversa)];
  // As fotos da conversa entram por último, para o Harvey olhar de verdade.
  if (fotos.length) msgs.push({ role: "user", content: [{ type: "text", text: `[the photos they sent in this conversation, most recent last]` }, ...fotos.map((url) => ({ type: "image_url", image_url: { url } }))] });

  let cobrouAgenda = false;
  for (let volta = 0; volta < 6; volta++) {
    const m = await openai(msgs, ferramentas);
    msgs.push(m);
    const chamadas = m.tool_calls ?? [];
    if (!chamadas.length) {
      r.resposta = typeof m.content === "string" && m.content ? limparTexto(m.content) : null;
      // Dia livre só sai da agenda (07/10/2026: handyman, pintura e ad_handyman
      // ofereciam dia de cabeça). A instrução não bastou: volta uma vez e cobra.
      if (r.resposta && !parceiro && !ctx.chase && !cobrouAgenda && ofereceDia(r.resposta) && !r.ferramentas.includes("get_available_dates") && !r.ferramentas.includes("get_my_bookings")) {
        cobrouAgenda = true;
        msgs.push({ role: "user", content: "[system] You named a day without calling get_available_dates. Do not send that. If they have the price and are ready for a day, call get_available_dates now and offer only days it returns. If not, rewrite your reply without naming any day." });
        continue;
      }
      if (ctx.chase && (!r.resposta || /\bNO_CHASE\b/.test(r.resposta))) {
        r.resposta = null;
        return r;
      }
      // Lembrete não repete preço já dito: tira a frase que traz um valor que já saiu.
      if (ctx.chase && r.resposta) {
        const ditos = new Set(conversa.filter((f) => f.papel !== "cliente").flatMap((f) => f.texto.match(/£\d+(?:\.\d+)?/g) ?? []));
        const frases = r.resposta.split(/(?<=[.!?])\s+/).filter((fr) => !(fr.match(/£\d+(?:\.\d+)?/g) ?? []).some((v) => ditos.has(v)));
        if (frases.length) r.resposta = frases.join(" ");
      }
      // Primeira resposta da conversa sempre se apresenta (dono, 29/09/2026):
      // não fica só na instrução, que o modelo às vezes esquece.
      // Já falou com a pessoa antes do corte de sessão também conta: nada de se apresentar de novo.
      const jaFalou = conversa.some((f) => f.papel !== "cliente") || (ctx.conversaAnterior ?? []).some((f) => f.papel !== "cliente");
      if (r.resposta && !jaFalou && !/\bI['’]m Harvey\b/i.test(r.resposta)) {
        r.resposta = `Hi there, I'm Harvey and I'll be looking after you. ${r.resposta.replace(/^(hi|hey|hello)( there)?[,!.]?\s*/i, "")}`;
      }
      // Disse que vai chamar alguém sem chamar a ferramenta: a passagem acontece do mesmo jeito.
      if (r.resposta && !r.passarParaEquipe && !/\?\s*$/.test(r.resposta) && /\b(I['’]ll|I will|let me|I['’]m (going to|getting))\s+(grab|get|bring in)\s+(someone|a person|the team|someone from the team)\b/i.test(r.resposta)) {
        r.passarParaEquipe = "Harvey said he would get the team (no tool call): check the conversation";
      }
      // O que já foi dito não se diz de novo (o "tools included, no call out fee" a cada resposta).
      if (r.resposta && jaFalou && !ctx.chase) r.resposta = semRepetir(r.resposta, conversa.filter((f) => f.papel === "harvey").map((f) => f.texto));
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

They have not replied for about ${Math.max(1, Math.round(horas))} hour${horas >= 1.5 ? "s" : ""}. Write follow up ${n} of ${Math.max(n, maxChases())}${n >= maxChases() ? " (the last one: leave the door open, no pressure)" : ""}: one short, friendly line about what is still pending, the way a person would nudge a mate. Pick up exactly where the conversation stopped (the question you asked, the price, the day you are holding, the payment link) and make it easy to answer. If a payment link was sent, it expires after an hour: offer a fresh one, or create it if you have everything. Do not restate the price or anything already said, and do not quote again: ask the pending question again in fresh words ("Still keen on Thursday or Friday morning?"). Never pressure, never invent urgency.${n === 3 ? " This is the last one: say you'll leave it with them and they can message any time." : ""}
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
    const { data } = await site({ action: "quote", selection: a.selection, postcode: a.postcode, promoCode: ctx.ajustes?.pagamento.cupons === false ? undefined : a.promoCode });
    const linhas = (data.lines as Array<{ label: string }> | undefined) ?? [];
    if (typeof data.total === "number") r.cotacao = { servico: linhas.map((l) => l.label).join(" + "), total: data.total, postcode: (data.postcode as string) ?? null };
    return data;
  }
  if (nome === "check_discount") {
    const { data } = await site({ action: "quote", selection: a.selection, postcode: a.postcode });
    const linhas = ((data.lines as Array<{ label?: string; amount?: number }> | undefined) ?? []);
    const total = typeof data.total === "number" ? data.total : 0;
    const custo = ctx.contas?.custoDoParceiro ? await ctx.contas.custoDoParceiro(linhas) : null;
    const d = decidirDesconto(total, custo);
    if (!d.ok) return { discount: 0, note: "No discount possible on this price: tell them kindly it is already our best price for this job." };
    // Sem cupom (dono, 10/10/2026): o link já nasce com o preço descontado.
    return {
      discount: d.percent,
      newTotal: d.novoTotal,
      note: `Tell them you can take ${d.percent}% off: £${d.novoTotal.toFixed(2)} instead of £${total.toFixed(2)}. When you create the payment link, pass discount_percent: ${d.percent}.`,
    };
  }
  if (nome === "book_team_price") {
    if (!ctx.contas?.reservarPrecoDaEquipe) return { error: "not available here: hand off to the team" };
    // O Harvey nunca escolhe o número: tem que ser um valor que alguém da equipe escreveu nesta conversa.
    if (!precoConfere(a.price, ctx.conversa ?? [])) {
      const dados = precosDaEquipe(ctx.conversa ?? []);
      return { error: dados.length ? `That is not a price the team gave in this chat. The team gave: ${dados.map((p) => `£${p}`).join(", ")}.` : "Nobody from the team has given a price in this chat. Use the catalogue (get_quote, create_payment_link) or hand off to the team." };
    }
    const data = String(a.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)) || Date.parse(`${data}T23:59:59Z`) < Date.now()) return { error: "date must be a future day as YYYY-MM-DD. Confirm the day with the customer." };
    const janela = janelaParaOJob(a.window);
    if (!janela) return { error: "window must be a clear arrival window, e.g. 9am to 12pm. Confirm it with the customer." };
    const disse = ctx.textoDoCliente?.replace(/\s+/g, "").toUpperCase() ?? "";
    const postcode = String(a.postcode ?? "").trim().toUpperCase();
    if (!postcode || !disse.includes(postcode.replace(/\s+/g, ""))) return { error: "Ask the customer for the full postcode first (they have not written it in this chat)." };
    const nomeCompleto = String(a.fullName ?? "").trim();
    const endereco = String(a.addressLine1 ?? "").trim();
    if (nomeCompleto.split(/\s+/).length < 2) return { error: "Ask for their full name (first and last) first." };
    if (endereco.length < 4) return { error: "Ask for the flat or house number and street first." };
    const email = typeof a.email === "string" && a.email.includes("@") ? a.email.trim() : null;
    const feito = await ctx.contas.reservarPrecoDaEquipe({ preco: Math.round(Number(a.price) * 100) / 100, servico: String(a.service || "General Maintenance").trim(), escopo: String(a.scope ?? "").trim(), data, janela, nome: nomeCompleto, email, endereco, postcode });
    if ("error" in feito) return feito;
    /**
     * Grava como checkout da conversa, igual ao link do site (16/10/2026): a referência é a do
     * job, e quando a entrada cai pelo /pay do OS o webhook acha a conversa por ela e o Harvey
     * diz "payment received". Antes este caminho ficava mudo depois do pagamento.
     */
    r.checkout = {
      ref: feito.reference,
      url: feito.payUrl,
      metodo: "card",
      total: Math.round(Number(a.price) * 100) / 100,
      deposit: true,
      sinal: feito.deposit,
      jobIds: [feito.jobId],
      email: email ?? "",
      nome: nomeCompleto,
      servico: String(a.service || "General Maintenance").trim(),
      postcode,
    };
    return { ...feito, note: "Send this exact link. Say in one line: half now by card on a secure page to hold the slot, the other half after the job. Then stop: the team will confirm the professional." };
  }
  if (nome === "request_quote") {
    if (!ctx.contas?.pedirCotacao) return { error: "not available" };
    // O postcode vem do cliente (chat) ou do cadastro do lead, nunca da imaginação do modelo.
    const postcode = postcodeDaCotacao(a.postcode, ctx.textoDoCliente, ctx.postcodesConhecidos ?? []);
    // O mínimo para chamar parceiro (dono, 15/10/2026): descrição + postcode + fotos (ou o motivo).
    const faltando = faltandoParaCotar({ descricao: a.description, postcode, fotos: ctx.fotos?.length ?? 0, semFotos: a.no_photos_reason });
    if (faltando.length) return { error: `Before asking the professionals, get ${faltando.join(", ")}. Ask one thing at a time.` };
    const endereco = typeof a.address === "string" && /\d/.test(a.address) ? a.address.trim() : undefined;
    const q = (await ctx.contas.pedirCotacao({
      serviceType: String(a.service_type ?? "General Maintenance"),
      description: [
        String(a.description ?? ""),
        a.occupancy ? `Property: ${a.occupancy}.` : "",
        a.timing ? `When: ${a.timing}.` : "",
        a.no_photos_reason ? `No photos: ${a.no_photos_reason}.` : "",
      ].filter(Boolean).join("\n"),
      postcode: postcode!,
      address: endereco,
      name: typeof a.name === "string" ? a.name : undefined,
      email: typeof a.email === "string" ? a.email : undefined,
    })) as { reference?: string; invited?: number; error?: string };
    if (!q.reference) return q;
    const nota = [
      `Quote ${q.reference} created in the OS with the photos.`,
      `Job: ${a.description}`,
      `Postcode: ${postcode}${endereco ? `\nAddress: ${endereco}` : "\nAddress: not yet (Harvey asks before booking)"}`,
      a.occupancy ? `Property: ${a.occupancy}` : null,
      a.timing ? `When: ${a.timing}` : null,
    ].filter(Boolean).join("\n");
    if (!q.invited) {
      // Ninguém convidado (porta desligada ou nenhum parceiro do ofício na área): exceção, vai para a equipe como antes.
      r.passarParaEquipe = `quote requested on WhatsApp: ${q.reference} (no professional invited automatically)`;
      r.notaParaEquipe = `${nota}\nNo partner was invited automatically: invite partners or price it in-house.`;
      r.fichaDoJob = fichaDaFerramenta({ customer_name: a.name, email: a.email, address: endereco, postcode, service: a.service_type, scope: a.description });
      return { reference: q.reference, note: "Tell them in one line the team is putting the quote together and will send it here. Do not promise a time or a price." };
    }
    // Fase 1: o Harvey fica na conversa. A equipe só recebe a nota no ticket.
    r.cotacaoPedida = { referencia: q.reference, nota: `${nota}\n${q.invited} professional(s) invited to bid. Harvey stays in the chat and sends the price when it is in.` };
    return {
      reference: q.reference,
      professionalsAsked: q.invited,
      note: `Tell them in one line that our professionals are pricing it now and the fixed price usually comes by tomorrow, here on WhatsApp. Never promise an exact time or a price.${endereco ? "" : " You do not have the full address yet: ask for it later, before booking, not now."}`,
    };
  }
  if (nome === "get_quote_status") return ctx.contas?.statusDasCotacoes ? ctx.contas.statusDasCotacoes() : { error: "not available" };
  if (nome === "ask_partner") {
    if (!ctx.contas?.perguntarAoParceiro) return { error: "not available" };
    return ctx.contas.perguntarAoParceiro(String(a.question ?? ""));
  }
  if (nome === "register_business") {
    if (!ctx.contas?.registrarEmpresa) return { error: "not available" };
    const email = String(a.email ?? "").trim();
    // O e-mail tem que ter vindo do cliente.
    if (!email || !(ctx.textoDoCliente ?? "").toLowerCase().includes(email.toLowerCase())) return { error: "Ask for their work email first (they have not given it)." };
    const res = (await ctx.contas.registrarEmpresa({
      companyName: String(a.company_name ?? ""),
      contactName: String(a.contact_name ?? ""),
      email,
      role: typeof a.role === "string" ? a.role : undefined,
      properties: typeof a.properties === "string" ? a.properties : undefined,
      area: typeof a.area === "string" ? a.area : undefined,
      services: typeof a.services === "string" ? a.services : undefined,
      financeEmail: typeof a.finance_email === "string" ? a.finance_email : undefined,
      companyNumber: typeof a.company_number === "string" ? a.company_number : undefined,
    })) as { ok: boolean; jaExistia?: boolean; link?: string; erro?: string };
    if (!res.ok) return { error: res.erro ?? "could not register" };
    return res.jaExistia
      ? { existing_account: true, price_list: res.link, note: "They already have an account with us: carry on helping them and the team will pick it up." }
      : { pending_account: true, price_list: res.link, note: "Send them the partner price list link and say the team will be in touch to agree terms (usually same day). Meanwhile you can still quote and book single jobs from the catalogue." };
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
    r.precisaDe = typeof a.need === "string" ? a.need : null;
    r.notaParaEquipe = typeof a.details === "string" ? a.details : null;
    r.fichaDoJob = fichaDaFerramenta(a.job);
    return { ok: true, note: "The team has been told. Send one short line saying you are getting someone, then stop." };
  }
  if (nome === "create_payment_link") {
    // Um preço por conversa, de verdade (dono, 13/10/2026): se alguém da equipe já deu preço neste chat,
    // o link do catálogo só sai quando o total do catálogo é esse mesmo número. Foi assim que uma cliente
    // recebeu £90 e £240 pela mesma porta e fechou com outro.
    const daEquipe = precosDaEquipe(ctx.conversa ?? []);
    if (daEquipe.length) {
      const q = await site({ action: "quote", selection: a.selection, postcode: a.postcode });
      const total = typeof q.data.total === "number" ? Math.round(q.data.total * 100) / 100 : null;
      if (total === null || !daEquipe.some((p) => Math.abs(p - total) < 0.005)) {
        return { error: `The team already gave a price in this chat (${daEquipe.map((p) => `£${p}`).join(", ")}). Do not send a different price. If the customer agreed to the team's price, use book_team_price with it; otherwise hand off to the team.` };
      }
    }
    // O modelo às vezes pula a pergunta e manda o link direto: sem escolha, não sai.
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
      promoCode: ctx.ajustes?.pagamento.cupons === false ? undefined : a.promoCode || undefined,
    };
    // Quanto cobra agora: ajuste da tela (50%, total, ou o cliente escolhe).
    const modo = ctx.ajustes?.pagamento.modo ?? "deposito";
    const deposito = !(modo === "total" || (modo === "cliente" && a.pay_in_full === true));
    const comum = { email: String(a.email), nome: nomeDaPessoa, servico: r.cotacao?.servico ?? "", postcode: String(a.postcode ?? ""), deposit: deposito };
    // Sempre 50% adiantado (dono, 29/09/2026): no cartão ou na transferência.
    // O ticket da conversa vai junto (Stripe → job): o job pago nasce nele, sem ticket novo.
    const zendeskTicketId = await ctx.ticketDaConversa?.().catch(() => null);
    // Desconto pedido: confere de novo a margem aqui, o modelo não decide o número.
    let descontoPct = 0;
    if (Number(a.discount_percent) > 0) {
      const q = await site({ action: "quote", selection: a.selection, postcode: a.postcode });
      const linhas = (q.data.lines as Array<{ label?: string; amount?: number }> | undefined) ?? [];
      const custo = ctx.contas?.custoDoParceiro ? await ctx.contas.custoDoParceiro(linhas) : null;
      const d = decidirDesconto(typeof q.data.total === "number" ? q.data.total : 0, custo);
      descontoPct = d.ok ? Math.min(d.percent, Math.floor(Number(a.discount_percent))) : 0;
    }
    if (descontoPct > 0) booking.promoCode = undefined;
    const { status, data } = await site({ action: "checkout", booking, deposit: deposito, campaign: ctx.campanha || "wa_v1", ...(descontoPct > 0 ? { discountPercent: descontoPct } : {}), ...(zendeskTicketId ? { zendeskTicketId } : {}) });
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
