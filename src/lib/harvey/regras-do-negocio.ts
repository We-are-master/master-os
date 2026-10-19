/**
 * Como a Fixfy vende e precifica, num lugar só (dono, 19/10/2026: "ele tem que
 * entender muito do nosso modelo de negócio e precificação"). Entra no prompt do
 * Harvey do WhatsApp, no quoter do e-mail e no casador da tabela, para os três
 * decidirem pela mesma regra.
 *
 * O texto padrão mora aqui; a equipe edita na tela /agents/harvey e a edição mora
 * em harvey_wa_config, chave "secao:comum:regras" ({ texto }), vencendo o padrão.
 * Cache de 30 s. Preço não mora aqui: vem do catálogo (Services) e da tabela de
 * cada conta (account_service_prices); este texto diz QUAL fonte vale quando.
 */

import { createServiceClient } from "@/lib/supabase/service";

export const CHAVE_DAS_REGRAS = "secao:comum:regras";

export const REGRAS_PADRAO = `How Fixfy sells and prices (these are facts, never contradict them):
- Every job has exactly one type of work from our services catalogue. Never invent a type: if it is not painting, cleaning or a certificate and no other catalogue trade fits, it is General Maintenance.
- Prices come from the services catalogue. Cleaning and certificates have fixed prices; handyman work is sold by time (hour, half day or full day).
- Business accounts (letting agents, property managers, platforms) have their own agreed rates. When an account asks for work by the hour, use that account's own hourly rate, never the public price list.
- Anything bigger than a day of handyman work, or any project (renovation, plastering a ceiling, laying floors, kitchens, bathrooms, insurance work), is priced by our partners: we invite every partner who covers the trade and the postcode, and the customer gets one price from us. Never guess a price for this kind of work.
- Never tell a customer what a partner charges, our margin, or how the price was built. The customer only ever sees Fixfy's price.
- A job needs the customer's full name and the full address before it is booked.
- Hand to the team when it is about money owed, a refund, a complaint, a discount request, or a price above the limit for sending on our own.`;

let cache: { em: number; texto: string } | null = null;

/** O texto que vale agora (edição da tela ou o padrão). Falhou a leitura, o último lido. */
export async function regrasDoNegocio(): Promise<string> {
  if (cache && Date.now() - cache.em < 30_000) return cache.texto;
  try {
    const { data } = await createServiceClient().from("harvey_wa_config").select("valor").eq("chave", CHAVE_DAS_REGRAS).maybeSingle();
    const editado = (data?.valor as { texto?: unknown } | null)?.texto;
    const texto = typeof editado === "string" && editado.trim() ? editado.trim() : REGRAS_PADRAO;
    cache = { em: Date.now(), texto };
    return texto;
  } catch (e) {
    console.error("[harvey] regras do negócio", e);
    return cache?.texto ?? REGRAS_PADRAO;
  }
}

/** O bloco pronto para o fim de um prompt de sistema. */
export async function blocoDasRegras(): Promise<string> {
  return `# How Fixfy works\n\n${await regrasDoNegocio()}`;
}
