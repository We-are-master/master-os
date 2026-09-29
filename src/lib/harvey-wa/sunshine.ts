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
export const INTEGRACAO_HARVEY = "harvey";
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

export async function enviarTexto(conversationId: string, texto: string) {
  return sc(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { author: { type: "business", displayName: NOME_DO_HARVEY }, content: { type: "text", text: texto } },
  });
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
  content: { type: string; text?: string; mediaUrl?: string; altText?: string };
  source?: { type?: string };
};

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
