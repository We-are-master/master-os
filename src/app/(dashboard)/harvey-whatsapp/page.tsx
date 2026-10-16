/**
 * Harvey no WhatsApp, pela equipe: quem ele está atendendo agora, e o botão de
 * assumir. O Zendesk trava o ticket enquanto o Harvey está com a conversa
 * ("AI agent ticket, can't be edited"); assumir aqui passa para o Agent
 * Workspace e o ticket destrava. O interruptor pausa o Harvey inteiro.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { ControleHarvey, type ConversaDaTela } from "./controle-harvey";

export const dynamic = "force-dynamic";

export default async function HarveyWhatsappPage() {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: conversas }, { data: pausa }] = await Promise.all([
    sb
      .from("harvey_wa_conversas")
      .select("conversation_id, name, phone, estado, tipo, atualizado_em, cliente_em, checkout_ref, checkout_total, motivo_passagem, chases")
      .gte("atualizado_em", desde)
      .order("atualizado_em", { ascending: false })
      .limit(200),
    sb.from("harvey_wa_config").select("valor, atualizado_em, atualizado_por").eq("chave", "pausado").maybeSingle(),
  ]);
  return (
    <ControleHarvey
      conversas={(conversas ?? []) as ConversaDaTela[]}
      pausado={pausa?.valor === true}
      pausaInfo={pausa?.atualizado_por ? `${pausa.atualizado_por}, ${new Date(pausa.atualizado_em as string).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : null}
    />
  );
}
