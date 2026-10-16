import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Job confirmado, dito ao cliente na própria conversa do WhatsApp (16/10/2026).
 *
 * Em ticket de WhatsApp o "Job confirmed" vira nota interna (dono, 07/10/2026: o e-mail
 * inteiro não cabe no WhatsApp) e a confirmação por template está desligada. O cliente
 * pagava e não ouvia mais nada. Aqui sai uma linha curta, no tom do Harvey, só com a
 * janela de 24h aberta (sem template não se fala fora dela). Fechada: não manda e diz
 * por quê, para a nota do ticket.
 */
export function textoDaConfirmacao(a: { nome: string | null; dia: string; janela: string | null; referencia: string }): string {
  const oi = a.nome?.trim() ? `Hi ${a.nome.trim().split(/\s+/)[0]}, ` : "";
  const janela = a.janela?.trim() && !/^to be confirmed$/i.test(a.janela.trim()) ? a.janela.trim().replace(/\s*[–—-]\s*|\s+to\s+/, " and ") : null;
  const quando = janela ? `${a.dia}, between ${janela}` : `${a.dia}. We'll confirm the arrival time`;
  return `${oi}you're booked in for ${quando} (${a.referencia}). Your professional is confirmed. Any questions, just reply here.`;
}

export async function confirmarJobNoWhatsApp(
  sb: SupabaseClient,
  a: { ticketId: number; dia: string; janela: string | null; referencia: string },
): Promise<{ enviado: boolean; motivo?: string }> {
  const { conversaDoTicket } = await import("./controle");
  const { historico, enviarTexto, vozDaConversa } = await import("./sunshine");
  const conversa = await conversaDoTicket(sb, a.ticketId).catch(() => null);
  if (!conversa) return { enviado: false, motivo: "no WhatsApp conversation found for this ticket" };
  const msgs = await historico(conversa.conversation_id, 30).catch(() => []);
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
  const aberta = !!ultimaDoCliente && Date.now() - Date.parse(ultimaDoCliente.received) < 23 * 36e5;
  if (!aberta) return { enviado: false, motivo: "WhatsApp 24h window is closed: the customer was not messaged" };
  const texto = textoDaConfirmacao({ nome: conversa.name, dia: a.dia, janela: a.janela, referencia: a.referencia });
  await enviarTexto(conversa.conversation_id, texto, vozDaConversa(msgs));
  return { enviado: true };
}
