/**
 * WhatsApp de remarcação para o cliente FINAL, com o template aprovado
 * `reschedule` ({{1}} nome, {{2}} data, {{3}} janela, {{4}} serviço).
 *
 * Mora ao lado da confirmação (`send.ts`) e usa a mesma política por conta e o
 * mesmo canal: quem decide SE manda é a conta do cliente; quem manda é o canal
 * da Fixfy. O email da remarcação continua saindo — o WhatsApp é o canal que o
 * morador de fato lê.
 *
 * Sem trava de idempotência de propósito: remarcar duas vezes DEVE avisar duas
 * vezes, porque cada aviso carrega uma data diferente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp/cloud";
import { decidirEnvio } from "./policy";
import { dataPorExtenso, janelaDeChegada } from "./send";

const template = () => process.env.WHATSAPP_TEMPLATE_RESCHEDULE?.trim() || "booking_rescheduled";
const idioma = () => process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en_GB";

function primeiroNome(completo: string | null | undefined): string {
  const nome = String(completo ?? "").trim().split(/\s+/)[0];
  return nome || "there";
}

export type ResultadoRescheduleWhatsapp =
  | { estado: "enviado"; telefone: string; messageId: string }
  | { estado: "pulado"; motivo: string }
  | { estado: "falhou"; motivo: string };

export async function enviarRescheduleDoCliente(
  supabase: SupabaseClient,
  job: {
    id: string;
    client_id?: string | null;
    client_name?: string | null;
    title?: string | null;
    scheduled_date?: string | null;
    scheduled_start_at?: string | null;
    scheduled_end_at?: string | null;
  },
): Promise<ResultadoRescheduleWhatsapp> {
  const clientId = job.client_id?.trim();
  if (!clientId) return { estado: "pulado", motivo: "job has no client record" };

  const { data: cliente } = await supabase
    .from("clients")
    .select("id, full_name, phone, source_account_id")
    .eq("id", clientId)
    .maybeSingle();
  const c = (cliente ?? {}) as { full_name?: string | null; phone?: string | null; source_account_id?: string | null };

  let politica: boolean | null | undefined;
  let nomeDaConta: string | null = null;
  if (c.source_account_id) {
    const { data: conta } = await supabase
      .from("accounts")
      .select("id, company_name, client_confirmation_whatsapp")
      .eq("id", c.source_account_id)
      .maybeSingle();
    politica = (conta as { client_confirmation_whatsapp?: boolean | null } | null)?.client_confirmation_whatsapp;
    nomeDaConta = (conta as { company_name?: string | null } | null)?.company_name ?? null;
  }

  // `jaEnviadoEm: null` de propósito: a política de conta e o telefone valem,
  // mas remarcação repetida manda de novo — cada aviso tem uma data nova.
  const decisao = decidirEnvio({
    politicaDaConta: politica,
    nomeDaConta,
    telefoneDoCliente: c.phone ?? null,
    jaEnviadoEm: null,
  });
  if (!decisao.manda) return { estado: "pulado", motivo: decisao.motivo };
  if (!whatsappConfigured()) return { estado: "pulado", motivo: "WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)" };

  const data = dataPorExtenso(job.scheduled_date ?? job.scheduled_start_at ?? null);
  const janela = janelaDeChegada(job.scheduled_start_at ?? null, job.scheduled_end_at ?? null);
  if (!data) return { estado: "pulado", motivo: "job has no scheduled date" };

  const parametros = [
    primeiroNome(c.full_name ?? job.client_name),
    data,
    janela ?? "to be confirmed",
    String(job.title ?? "").trim() || "your booking",
  ];

  try {
    const { messageId } = await sendTemplate({
      to: decisao.telefone,
      name: template(),
      language: idioma(),
      bodyParams: parametros,
    });
    console.log(`[reschedule-whatsapp] ${job.id} enviado para ${decisao.telefone} (message ${messageId})`);
    return { estado: "enviado", telefone: decisao.telefone, messageId };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "send failed";
    console.error(`[reschedule-whatsapp] ${job.id} falhou:`, motivo);
    return { estado: "falhou", motivo };
  }
}
