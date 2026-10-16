/**
 * WhatsApp pela API oficial da Meta (Cloud API).
 *
 * Entrou em 22/09/2026 no lugar do respond.io, que saiu do ar: toda chamada
 * passou a voltar 401 e, desde 09/09, nenhum lembrete de véspera e nenhum
 * pedido de feedback chegou a cliente nenhum, calado, num log que ninguém abre.
 *
 * Aqui não há CRM: é só o canal. Contato, tag e funil ficaram no respond.io e
 * não voltam por este caminho.
 *
 * Ambiente (no .env.local da máquina que roda os agentes e, para a confirmação
 * nascer junto com o job, também na Vercel do master-os):
 *   WHATSAPP_TOKEN            token do system user com whatsapp_business_messaging
 *   WHATSAPP_PHONE_NUMBER_ID  o id do número que envia (não é o telefone)
 *   WHATSAPP_WABA_ID          a conta do WhatsApp Business (só para ler templates)
 *   WHATSAPP_API_VERSION      opcional, padrão v21.0
 *
 * Os templates vivem na nossa WABA e foram criados em 22/09/2026 (os antigos
 * eram da WABA do respond.io e não vieram junto): booking_confirmation,
 * booking_reminder, booking_rescheduled e job_feedback, todos em en_GB. Pedir
 * um nome que não existe, ou o idioma errado, a Meta recusa com 132001.
 *
 * Fora da janela de 24 horas o WhatsApp só aceita template aprovado, e é
 * sempre o nosso caso: confirmação, véspera e feedback saem sem o cliente ter
 * escrito antes. Por isso aqui só existe envio de template.
 */

const GRAPH = "https://graph.facebook.com";

export class WhatsAppError extends Error {
  readonly code: number | null;
  readonly details: string;

  constructor(message: string, code: number | null = null, details = "") {
    super(message);
    this.name = "WhatsAppError";
    this.code = code;
    this.details = details;
  }
}

const version = () => process.env.WHATSAPP_API_VERSION?.trim() || "v21.0";
const token = () => process.env.WHATSAPP_TOKEN?.trim() || "";
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
const wabaId = () => process.env.WHATSAPP_WABA_ID?.trim() || "";

/** Sem token ou sem número que envia, nada sai: quem chama trata como pulo, não como falha. */
export function whatsappConfigured(): boolean {
  return Boolean(token() && phoneNumberId());
}

/**
 * O número como a Meta quer: só dígitos, com país, sem `+`. Aceita o que o
 * banco tem hoje (+44…, 07…, 447…) e devolve null quando não dá para confiar.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  const semMais = digits.startsWith("+") ? digits.slice(1) : digits;
  if (semMais.startsWith("44") && semMais.length >= 12) return semMais;
  if (semMais.startsWith("0") && semMais.length >= 10) return `44${semMais.slice(1)}`;
  // Outro país só passa se já vier com código internacional plausível.
  return semMais.length >= 11 ? semMais : null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!token()) throw new WhatsAppError("WHATSAPP_TOKEN is not set");
  const res = await fetch(`${GRAPH}/${version()}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (body.error ?? {}) as { message?: string; code?: number; error_data?: { details?: string } };
    throw new WhatsAppError(err.message ?? `WhatsApp ${res.status}`, err.code ?? null, err.error_data?.details ?? "");
  }
  return body as T;
}

export type TemplateParam = { type: "text"; text: string };

/**
 * Manda um template aprovado. Devolve o id da mensagem, que é o que a Meta dá
 * para rastrear depois: a entrega em si chega por webhook, não por resposta.
 */
export async function sendTemplate(input: {
  to: string;
  name: string;
  language?: string;
  bodyParams?: string[];
  /**
   * A parte variável de um botão de link (`https://site/{{1}}`), pela posição
   * do botão no template (0 = o primeiro). Botão de resposta rápida não leva nada.
   */
  urlButtons?: Array<{ index: number; suffix: string }>;
}): Promise<{ messageId: string; to: string }> {
  const to = toWhatsAppNumber(input.to);
  if (!to) throw new WhatsAppError(`número inválido para WhatsApp: ${input.to}`);
  if (!phoneNumberId()) throw new WhatsAppError("WHATSAPP_PHONE_NUMBER_ID is not set");

  const partes: Record<string, unknown>[] = [];
  if (input.bodyParams?.length) {
    partes.push({ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) });
  }
  for (const b of input.urlButtons ?? []) {
    partes.push({ type: "button", sub_type: "url", index: String(b.index), parameters: [{ type: "text", text: b.suffix }] });
  }
  const components = partes.length ? partes : undefined;

  const data = await call<{ messages?: { id: string }[] }>(`${phoneNumberId()}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language || "en_GB" },
        ...(components ? { components } : {}),
      },
    }),
  });

  const messageId = data.messages?.[0]?.id;
  if (!messageId) throw new WhatsAppError("WhatsApp accepted the call but gave no message id");
  return { messageId, to };
}

export type TemplateInfo = {
  name: string;
  language: string;
  status: string;
  category: string;
  /** Quantas variáveis o corpo pede ({{1}}, {{2}}…), para o envio não errar a conta. */
  bodyVariables: number;
  body: string;
  /** Os botões na ordem do template: o `index` do envio é a posição aqui. */
  buttons: Array<{ type: string; text: string; url?: string }>;
};

type TemplateDaMeta = {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: { type: string; text?: string; buttons?: { type: string; text?: string; url?: string }[] }[];
};

function paraTemplateInfo(t: TemplateDaMeta): TemplateInfo {
  const body = t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
  const vars = new Set((body.match(/\{\{\d+\}\}/g) ?? []).map((v) => v));
  const botoes = t.components?.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  return {
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
    bodyVariables: vars.size,
    body,
    buttons: botoes.map((b) => ({ type: String(b.type ?? "").toUpperCase(), text: b.text ?? "", ...(b.url ? { url: b.url } : {}) })),
  };
}

/** Os templates da conta, do jeito que a Meta aprovou. Só leitura. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  if (!wabaId()) throw new WhatsAppError("WHATSAPP_WABA_ID is not set");
  const data = await call<{ data?: TemplateDaMeta[] }>(`${wabaId()}/message_templates?limit=100`);
  return (data.data ?? []).map(paraTemplateInfo);
}

/**
 * Um template pelo nome e idioma, com o status de agora (APPROVED, PENDING,
 * PAUSED, DISABLED, REJECTED). Null quando não existe nesse idioma. Só leitura.
 */
export async function buscarTemplate(nome: string, idioma: string): Promise<TemplateInfo | null> {
  if (!wabaId()) throw new WhatsAppError("WHATSAPP_WABA_ID is not set");
  const data = await call<{ data?: TemplateDaMeta[] }>(
    `${wabaId()}/message_templates?name=${encodeURIComponent(nome)}&fields=name,language,status,category,components`,
  );
  const t = (data.data ?? []).find((x) => x.name === nome && x.language === idioma);
  return t ? paraTemplateInfo(t) : null;
}

export type SaudeDoNumero = {
  /** GREEN, YELLOW, RED ou UNKNOWN. Abaixo de GREEN a Meta está avisando. */
  qualidade: string;
  /** TIER_250, TIER_2K, TIER_10K…: conversas iniciadas por nós a cada 24h. */
  limite: string | null;
};

/**
 * Como a Meta está vendo o número agora. Campanha lê isto antes de cada lote:
 * o número que manda promoção é o mesmo que manda a confirmação da visita, e
 * a qualidade cai por denúncia de quem recebeu promoção sem querer.
 */
export async function saudeDoNumero(): Promise<SaudeDoNumero> {
  if (!phoneNumberId()) throw new WhatsAppError("WHATSAPP_PHONE_NUMBER_ID is not set");
  const data = await call<{ quality_rating?: string; whatsapp_business_manager_messaging_limit?: string }>(
    `${phoneNumberId()}?fields=quality_rating,whatsapp_business_manager_messaging_limit`,
  );
  return {
    qualidade: data.quality_rating ?? "UNKNOWN",
    limite: data.whatsapp_business_manager_messaging_limit ?? null,
  };
}
