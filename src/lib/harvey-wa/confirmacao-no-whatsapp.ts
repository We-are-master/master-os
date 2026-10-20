import type { SupabaseClient } from "@supabase/supabase-js";
import { saudacao } from "@/lib/emails/fixfy-shell";
import { janelaDoAviso, lerLinhaDaAgenda } from "@/lib/zendesk-job-confirmation";

/**
 * Job confirmado, dito ao cliente na própria conversa do WhatsApp (16/10/2026).
 *
 * Em ticket de WhatsApp o "Job confirmed" vira nota interna (dono, 07/10/2026: o e-mail
 * inteiro não cabe no WhatsApp) e a confirmação por template está desligada. O cliente
 * pagava e não ouvia mais nada. Aqui sai uma linha curta, no tom do Harvey, só com a
 * janela de 24h aberta (sem template não se fala fora dela). Fechada: não manda e diz
 * por quê, para a nota do ticket.
 */
export function textoDaConfirmacao(a: {
  nome: string | null;
  dia: string;
  janela: string | null;
  referencia: string;
  servico?: string | null;
  endereco?: string | null;
}): string {
  // Copy aprovada 20/10/2026 (id 1, "Open conversation"). Conversa de WhatsApp é de pessoa: B2C.
  const oi = saudacao({ tipo: "b2c", primeiroNome: a.nome });
  const dia = lerLinhaDaAgenda(a.dia).data ?? a.dia.trim();
  const janela = janelaDoAviso(a.janela);
  const quando = janela
    ? `Your Fixfy booking is confirmed for ${dia}, arriving ${janela}.`
    : `Your Fixfy booking is confirmed for ${dia}. We’ll confirm the arrival time before the visit.`;
  const servico = a.servico?.trim();
  const endereco = a.endereco?.replace(/\s+/g, " ").trim();
  const pro = servico && endereco
    ? `Your professional is confirmed for ${servico} at ${endereco}.`
    : servico
      ? `Your professional is confirmed for ${servico}.`
      : "Your professional is confirmed.";
  // Saudação na linha dela, como nos e-mails: "Hi Sarah," e o texto embaixo.
  const corpo = [quando, pro, "If anything changes, just reply here.", a.referencia.trim() ? `Reference: ${a.referencia.trim()}.` : ""]
    .filter(Boolean)
    .join(" ");
  return `${oi}\n\n${corpo}`;
}

/**
 * "Payment received" no WhatsApp (copy aprovada 20/10/2026, id 8). Texto livre
 * na conversa aberta, nunca template. Os valores saem do checkout gravado; sem
 * o sinal gravado o texto não inventa valor. Pagamento não quer dizer
 * profissional alocado, então não diz "booked in" nem "confirmed".
 */
export function textoDePagamentoRecebido(a: {
  nome: string | null | undefined;
  referencia: string | null;
  deposito: boolean;
  total: number | null | undefined;
  sinal: number | null | undefined;
}): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const libras = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const oi = saudacao({ tipo: "b2c", primeiroNome: a.nome });
  const booking = a.referencia ? ` for booking ${a.referencia}` : "";
  const total = Number(a.total);
  const sinal = Number(a.sinal);
  if (a.deposito) {
    const temSinal = Number.isFinite(sinal) && sinal > 0.02;
    const saldo = temSinal && Number.isFinite(total) ? r2(total - sinal) : 0;
    return `${oi}\n\n${[
      `Thank you, we’ve received your ${temSinal ? `${libras(r2(sinal))} ` : ""}deposit${booking}.`,
      saldo > 0.02 ? `The remaining ${libras(saldo)} is due after the work is complete.` : "",
      "We’ll keep you updated on the booking arrangements here.",
    ].filter(Boolean).join(" ")}`;
  }
  // Pagamento total: o que se cobrou (payNow gravado como sinal), senão o total.
  const valor = Number.isFinite(sinal) && sinal > 0.02 ? sinal : total;
  const pago = Number.isFinite(valor) && valor > 0.02 ? ` of ${libras(r2(valor))}` : "";
  return `${oi}\n\nThank you, we’ve received your payment${pago}${booking}. We’ll keep you updated on the booking arrangements here. If you have a question, just reply.`;
}

export async function confirmarJobNoWhatsApp(
  sb: SupabaseClient,
  a: { ticketId: number; dia: string; janela: string | null; referencia: string; servico?: string | null; endereco?: string | null },
): Promise<{ enviado: boolean; motivo?: string }> {
  const { conversaDoTicket } = await import("./controle");
  const { historico, enviarTexto, vozDaConversa } = await import("./sunshine");
  const conversa = await conversaDoTicket(sb, a.ticketId).catch(() => null);
  if (!conversa) return { enviado: false, motivo: "no WhatsApp conversation found for this ticket" };
  const msgs = await historico(conversa.conversation_id, 30).catch(() => []);
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
  const aberta = !!ultimaDoCliente && Date.now() - Date.parse(ultimaDoCliente.received) < 23 * 36e5;
  if (!aberta) return { enviado: false, motivo: "WhatsApp 24h window is closed: the customer was not messaged" };
  // Serviço e endereço do próprio job, quando quem chama não mandou (a copy cita os dois).
  let servico = a.servico ?? null;
  let endereco = a.endereco ?? null;
  if ((!servico || !endereco) && a.referencia.trim()) {
    try {
      const { data: job } = await sb.from("jobs").select("title, property_address").eq("reference", a.referencia.trim()).maybeSingle();
      const j = job as { title?: string | null; property_address?: string | null } | null;
      servico = servico || j?.title?.trim() || null;
      endereco = endereco || j?.property_address?.trim() || null;
    } catch {
      // Sem o job, a linha sai sem serviço e endereço.
    }
  }
  const texto = textoDaConfirmacao({ nome: conversa.name, dia: a.dia, janela: a.janela, referencia: a.referencia, servico, endereco });
  await enviarTexto(conversa.conversation_id, texto, vozDaConversa(msgs));
  return { enviado: true };
}
