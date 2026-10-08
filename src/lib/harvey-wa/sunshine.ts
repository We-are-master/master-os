/**
 * Sunshine Conversations, o motor de mensagens do Zendesk (WhatsApp incluso).
 *
 * O Harvey é uma integração própria no switchboard: recebe cada mensagem na
 * hora (webhook), responde como a empresa e passa a conversa para o Agent
 * Workspace quando precisa de gente. A API mora no próprio Zendesk
 * (https://<sub>.zendesk.com/sc/v2), com a chave criada em Admin Center →
 * Apps e integrações → APIs → Conversations API.
 */

const NOME_DO_HARVEY = "Harvey";
// Teste antes do merge: o servidor local responde por uma integração própria ("harvey-teste").
export const INTEGRACAO_HARVEY = process.env.HARVEY_WA_INTEGRACAO?.trim() || "harvey";
export const INTEGRACAO_EQUIPE = "zd-agentWorkspace";

function config() {
  const app = process.env.SUNSHINE_APP_ID?.trim();
  const id = process.env.SUNSHINE_KEY_ID?.trim();
  const segredo = process.env.SUNSHINE_KEY_SECRET?.trim();
  const sub = process.env.ZENDESK_SUBDOMAIN?.trim() || "fixfy";
  if (!app || !id || !segredo) throw new Error("SUNSHINE_APP_ID/KEY_ID/KEY_SECRET não configurados");
  return { base: `https://${sub}.zendesk.com/sc/v2/apps/${app}`, auth: `Basic ${Buffer.from(`${id}:${segredo}`).toString("base64")}` };
}

async function sc<T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { base, auth } = config();
  const res = await fetch(`${base}${caminho}`, {
    method: init.method ?? "GET",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sunshine ${init.method ?? "GET"} ${caminho.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

/** A chamada crua, para quem precisa de um endpoint que não tem função aqui. */
export const scApi = sc;

/**
 * Template de WhatsApp para quem ainda não falou com a gente: só a v1.1 tem
 * `/notifications` (a v2 devolve 404 route_not_found; primeiro envio real,
 * 07/10/2026). Mesmo app e mesma chave; muda só a versão na rota.
 */
export async function scNotificacao<T>(body: unknown): Promise<T> {
  const { base, auth } = config();
  const res = await fetch(`${base.replace("/sc/v2/", "/sc/v1.1/")}/notifications`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sunshine v1.1 POST /notifications ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * `comoNome`: quando a equipe já falou na conversa, o Harvey segue no nome de
 * quem estava falando (dono, 08/10/2026). A metadata `harvey` marca a mensagem
 * como dele mesmo assim, para o motor não achar que a equipe assumiu.
 */
export async function enviarTexto(conversationId: string, texto: string, comoNome?: string | null) {
  return sc(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { author: { type: "business", displayName: comoNome || NOME_DO_HARVEY }, content: { type: "text", text: texto }, metadata: { harvey: true } },
  });
}

/** A mensagem é do Harvey (no nome dele ou no de quem da equipe ele continua)? */
export function ehDoHarvey(m: MensagemSc): boolean {
  return m.author.type === "business" && (m.metadata?.harvey === true || m.author.displayName === NOME_DO_HARVEY);
}

/**
 * Em nome de quem o Harvey fala: a última pessoa da equipe que escreveu na
 * conversa (por ela mesma ou pelo Harvey no nome dela). Sem ninguém, ele mesmo.
 */
export function vozDaConversa(msgs: MensagemSc[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.author.type !== "business" || !m.author.displayName) continue;
    if (m.author.displayName === NOME_DO_HARVEY) return null;
    return m.author.displayName;
  }
  return null;
}

export async function digitando(conversationId: string) {
  try {
    await sc(`/conversations/${conversationId}/activity`, { method: "POST", body: { author: { type: "business" }, type: "typing:start" } });
  } catch {
    /* "digitando" é enfeite: nunca atrasa a resposta */
  }
}

/** Passa a conversa para a equipe (Agent Workspace), com o motivo como etiqueta do ticket. */
export async function passarParaEquipe(conversationId: string, motivo: string) {
  return sc(`/conversations/${conversationId}/passControl`, {
    method: "POST",
    body: {
      switchboardIntegration: INTEGRACAO_EQUIPE,
      metadata: {
        "dataCapture.systemField.tags": "harvey_passou harvey_wa",
        harvey_motivo: motivo.slice(0, 200),
      },
    },
  });
}

/** Para quem ainda não pode falar com o Harvey (fora da lista de teste): segue o fluxo de sempre, calado. */
export async function seguirFluxoPadrao(conversationId: string) {
  return sc(`/conversations/${conversationId}/passControl`, { method: "POST", body: { switchboardIntegration: "next" } });
}

export type MensagemSc = {
  id: string;
  received: string;
  author: { type: "user" | "business"; displayName?: string; userId?: string };
  /** `payload`: botão de resposta rápida do template que o cliente tocou. */
  content: { type: string; text?: string; mediaUrl?: string; altText?: string; payload?: string };
  metadata?: Record<string, unknown>;
  source?: { type?: string };
};

/** O cliente da conversa (quem não é o negócio): para achar o telefone quando a mensagem é nossa. */
export async function usuarioDaConversa(conversationId: string): Promise<string | null> {
  const r = await sc<{ participants?: Array<{ userId?: string }> }>(`/conversations/${conversationId}/participants`);
  return r.participants?.find((p) => p.userId)?.userId ?? null;
}

/** As últimas mensagens da conversa (cliente, Harvey e equipe), da mais velha para a mais nova. */
export async function historico(conversationId: string, limite = 40): Promise<MensagemSc[]> {
  const r = await sc<{ messages: MensagemSc[] }>(`/conversations/${conversationId}/messages`);
  return (r.messages ?? []).slice(-limite);
}

/**
 * O telefone do WhatsApp da pessoa. Desde 2026 a Meta manda um id próprio no
 * `externalId` ("GB.1234…", o BSUID), e o número de verdade fica em
 * `additionalIdentifiers` (phoneNumber) ou em `raw.from`.
 */
export async function telefoneDoUsuario(userId: string): Promise<string | null> {
  try {
    const r = await sc<{
      clients: Array<{ type: string; externalId?: string; raw?: { from?: string }; additionalIdentifiers?: Array<{ key: string; value: string }> }>;
    }>(`/users/${userId}/clients`);
    const wa = (r.clients ?? []).find((c) => c.type === "whatsapp");
    if (!wa) return null;
    const candidatos = [
      wa.additionalIdentifiers?.find((i) => i.key === "phoneNumber")?.value,
      wa.raw?.from,
      /^\+?\d{10,15}$/.test(wa.externalId ?? "") ? wa.externalId : null,
    ];
    const digitos = (candidatos.find((c) => c && /\d{10,15}/.test(c.replace(/\D/g, ""))) ?? "").replace(/\D/g, "");
    return digitos ? `+${digitos}` : null;
  } catch {
    return null;
  }
}

/** Baixa a foto/PDF que a pessoa mandou. A mídia da Sunshine pode pedir a mesma chave da API. */
export async function baixarMidia(url: string): Promise<{ dados: Buffer; tipo: string }> {
  let res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) res = await fetch(url, { headers: { Authorization: config().auth }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`mídia ${res.status}`);
  return { dados: Buffer.from(await res.arrayBuffer()), tipo: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
}

/** Devolve a conversa ao Harvey (a equipe terminou e quer que ele volte a atender). */
export async function devolverAoHarvey(conversationId: string) {
  return sc(`/conversations/${conversationId}/passControl`, { method: "POST", body: { switchboardIntegration: INTEGRACAO_HARVEY } });
}
