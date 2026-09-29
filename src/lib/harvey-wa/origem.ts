/**
 * De qual anúncio veio a conversa do WhatsApp.
 *
 * O anúncio de WhatsApp da Meta abre a conversa com uma mensagem pronta, uma
 * por criativo (teste de 30/09/2026: um conjunto de limpeza e um de
 * manutenção). É ela que diz o conjunto: a Sunshine não repassa o id do
 * anúncio. Quem apagar a mensagem pronta e escrever outra coisa cai no padrão.
 *
 * `campanha` vai para o utm_campaign do lead e do job pago (o site grava),
 * `conteudo` fica no utm_content do lead.
 */

export type Origem = { campanha: string; conteudo: string | null };

export const ORIGEM_PADRAO: Origem = { campanha: "wa_v1", conteudo: null };

/** A frase de cada mensagem pronta. Mudou o texto no anúncio, muda aqui. */
const ANUNCIOS: Array<{ frase: RegExp; origem: Origem }> = [
  { frase: /\bdeep clean offer\b/i, origem: { campanha: "wa_cleaning", conteudo: "cl_deep" } },
  { frase: /\bend of tenancy (clean )?offer\b/i, origem: { campanha: "wa_cleaning", conteudo: "cl_eot" } },
  { frase: /\bhandyman offer\b/i, origem: { campanha: "wa_maintenance", conteudo: "mt_handyman" } },
  { frase: /\bpainter offer\b/i, origem: { campanha: "wa_maintenance", conteudo: "mt_paint" } },
];

/** Olha só a primeira mensagem do cliente: é a que o anúncio escreveu. */
export function origemDaConversa(primeiraDoCliente: string | null | undefined): Origem | null {
  const texto = (primeiraDoCliente ?? "").trim();
  if (!texto) return null;
  return ANUNCIOS.find((a) => a.frase.test(texto))?.origem ?? null;
}

/** A origem já gravada no lead (para conversa longa, quando a 1ª mensagem saiu do histórico). */
export function origemDoLead(source: unknown): Origem | null {
  const s = (source ?? {}) as { utm_campaign?: unknown; utm_content?: unknown };
  if (typeof s.utm_campaign !== "string" || !s.utm_campaign) return null;
  return { campanha: s.utm_campaign, conteudo: typeof s.utm_content === "string" && s.utm_content ? s.utm_content : null };
}
