/**
 * Reserva abandonada no site → WhatsApp de retomada → o cliente responde → o
 * Harvey continua (dono, 07/10/2026: "a resposta da recuperação no Harvey").
 *
 * O passo 4 da sequência (site-leads/motor.ts) manda o template
 * fixfy_booking_recovery_v1 pela linha do Zendesk e registra o telefone em
 * harvey_wa_leads com origem "site" (lead_externo = id do site_leads, ticket_id
 * = ticket do lead). Quando a pessoa responde, o Harvey assume a conversa (#706),
 * junta o ticket do lead do site nela e lê daqui o que ela estava reservando.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveDoTelefone } from "./identidade";

/** Registra quem recebeu a retomada, para o Harvey reconhecer a resposta. */
export async function registrarRetomadaNoHarvey(
  sb: SupabaseClient,
  l: { id: string; phone: string; client_id?: string | null; service_label?: string | null; zendesk_ticket_id?: number | string | null },
): Promise<void> {
  const digitos = l.phone.replace(/\D/g, "");
  if (!digitos) return;
  await sb.from("harvey_wa_leads").upsert(
    {
      chave: chaveDoTelefone(digitos),
      telefone: `+${digitos}`,
      cliente_id: l.client_id ?? null,
      servico: l.service_label ?? null,
      enviado_em: new Date().toISOString(),
      origem: "site",
      lead_externo: l.id,
      ticket_id: l.zendesk_ticket_id ? Number(l.zendesk_ticket_id) : null,
      job_id: null,
    },
    { onConflict: "chave" },
  );
}

const gbp = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `£${Number(n)}` : null);

/**
 * Uma passagem para o Harvey sobre a reserva que ficou pela metade: serviço,
 * preço, onde parou e o código de 10%. Sem retomada para este telefone, null.
 */
export async function contextoDaRetomada(sb: SupabaseClient, telefone: string): Promise<string | null> {
  const { data: w } = await sb.from("harvey_wa_leads").select("origem, lead_externo").eq("chave", chaveDoTelefone(telefone)).maybeSingle();
  if (w?.origem !== "site" || !w.lead_externo) return null;
  const { data: l } = await sb
    .from("site_leads")
    .select("full_name, email, postcode, service_label, price, step_reached, promo_code, promo_expires_at, won_at, status, selection")
    .eq("id", w.lead_externo)
    .maybeSingle();
  if (!l) return null;
  if (l.won_at) return "This person already paid for the booking they started on the website: help with any question about it (get_my_bookings) and never send another payment link for it.";
  // O que ela escolheu no site (tamanho, banheiros, extras), para não perguntar de novo.
  const sel = (l.selection ?? {}) as { size?: string; bathrooms?: number; services?: string[]; clean?: { kind?: string; extras?: Record<string, number> } };
  const escolha = [
    sel.size ? (sel.size === "studio" ? "studio" : `${sel.size} bedroom${sel.size === "1" ? "" : "s"}`) : null,
    sel.bathrooms ? `${sel.bathrooms} bathroom${sel.bathrooms === 1 ? "" : "s"}` : null,
    sel.clean?.extras && Object.keys(sel.clean.extras).length ? `extras: ${Object.entries(sel.clean.extras).map(([k, q]) => `${k} x${q}`).join(", ")}` : null,
  ].filter(Boolean);
  const codigoValido = l.promo_code && (!l.promo_expires_at || new Date(l.promo_expires_at as string).getTime() > Date.now());
  const partes = [
    `This person started booking on our website and did not finish: ${l.service_label ?? "a booking"}${gbp(l.price) ? ` at ${gbp(l.price)}` : ""}${l.postcode ? `, postcode ${l.postcode}` : ""}, stopped at step ${l.step_reached ?? 1} of 4.`,
    escolha.length ? `What they chose: ${escolha.join(", ")}.` : null,
    l.full_name ? `Name: ${l.full_name}.` : null,
    l.email ? `Email: ${l.email} (use it for the payment link, do not ask again unless they want another).` : null,
    "Our WhatsApp reminder was the first message in this chat (you have not introduced yourself yet: do it once, briefly, in your first reply).",
    codigoValido
      ? `Their 10% code ${l.promo_code} is valid: always pass it as promoCode in get_quote and create_payment_link, and say the price with the 10% off.`
      : "Their 10% code has expired: quote the normal price.",
    "Pick up exactly where they stopped: confirm the service and size in one line, then the day, then the rest, and close with the card link. Never start over from scratch.",
  ];
  return partes.filter(Boolean).join(" ");
}
