/**
 * O código do "Welcome to Fixfy" no WhatsApp (dono, 24/10/2026).
 *
 * Desde 22/10 todo lead novo da conta Fixfy recebe o e-mail de boas-vindas com
 * WELCOME10 (processo/boas-vindas-lead.ts), mas o Harvey não sabia: no ticket
 * 51755 o cliente citou o e-mail, o Harvey chamou check_discount, a margem disse
 * não e ele respondeu "£215 is already our best price". O cliente achou que era IA.
 *
 * Regra do dono: o código vale por cima do preço que o Harvey deu. Ele não oferece
 * numa resposta normal; aplica quando o cliente fala do e-mail, do código ou dos
 * 10%, e pode lembrar uma vez no follow up de um preço que não fechou. O site
 * confere a primeira compra pelo e-mail no checkout (master-website, promo.js).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WELCOME_CODE } from "@/lib/emails/welcome";
import { chaveDasBoasVindas } from "@/lib/processo/boas-vindas-lead";
import { chaveDoTelefone } from "./identidade";

export type WelcomeDoLead = { codigo: string; email: string };

/** O lead deste telefone recebeu o Welcome e ainda não comprou: o código vale. Senão, null. */
export async function welcomeDoTelefone(sb: SupabaseClient, telefone: string | null): Promise<WelcomeDoLead | null> {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return null;
  const fim = chave.slice(-4);
  const { data } = await sb
    .from("clients")
    .select("id, email, phone")
    .ilike("phone", `%${fim.slice(0, 2)}%${fim.slice(2)}`)
    .is("deleted_at", null)
    .limit(200);
  const clientes = ((data ?? []) as Array<{ id: string; email: string | null; phone: string | null }>).filter((c) => chaveDoTelefone(c.phone) === chave);
  if (!clientes.length) return null;
  // Primeira compra: qualquer job vivo deste telefone tira o código (mesma trava do e-mail).
  const { count } = await sb
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("client_id", clientes.map((c) => c.id))
    .is("deleted_at", null)
    .neq("status", "cancelled");
  if ((count ?? 0) > 0) return null;
  for (const c of clientes) {
    const email = c.email?.trim().toLowerCase();
    if (!email) continue;
    const { data: envio } = await sb.from("outbound_messages").select("status").eq("dedupe_key", chaveDasBoasVindas(email)).maybeSingle<{ status: string }>();
    if (envio?.status === "sent") return { codigo: WELCOME_CODE, email };
  }
  return null;
}

/** O parágrafo de "This customer" para o prompt. */
export function contextoDoWelcome(w: WelcomeDoLead): string {
  return (
    `We emailed them our "Welcome to Fixfy" offer: code ${w.codigo}, 10% off their first booking, on top of the price you give. ` +
    `Do not bring it up in a normal reply. If they mention the email, a code or 10% off, say yes, it works, and use it: pass promoCode "${w.codigo}" in get_quote and create_payment_link and give the price with the 10% off. ` +
    `It never adds up with check_discount: it is one or the other, and the code is the better one. Never call it "already our best price".`
  );
}

/** A exceção do follow up: lembrar o código uma vez, num preço do catálogo que não fechou. */
export function instrucaoDoWelcomeNoChase(w: WelcomeDoLead): string {
  return (
    ` Exception: if you gave them a price from the catalogue and they have not booked, and nobody has mentioned the welcome code in this chat yet, ` +
    `this follow up can remind them once that their welcome code ${w.codigo} takes 10% off (say the new price, call get_quote with promoCode "${w.codigo}"). One line, no pressure.`
  );
}
