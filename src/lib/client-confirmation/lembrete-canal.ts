/**
 * Por onde sai o lembrete de véspera (plano do dono, 22/10/2026, etapa 4).
 *
 * Conta com os fluxos novos (regras.v2): o lembrete vai pelo canal ativo da
 * conversa. `conversation_channel = 'email'`, cliente sem mobile UK ou conta que
 * não fala por WhatsApp: e-mail dentro do ticket do job. O resto: WhatsApp, como
 * sempre. Conta sem v2 nem passa por aqui.
 *
 * A chave de envio é uma por job e horário marcado, qualquer que seja o canal:
 * remarcar para outro horário gera lembrete novo, voltar ao mesmo não repete, e
 * trocar de canal no meio não manda dois.
 */
import { chaveDeEnvio } from "@/lib/idempotencia/envio";
import { normalizarMobileUk } from "./policy";

export type CanalDoLembrete = "email" | "whatsapp";

export function canalDoLembrete(input: {
  conversationChannel?: string | null;
  telefone?: string | null;
  canaisDaConta?: Array<"email" | "whatsapp"> | null;
}): CanalDoLembrete {
  if (input.conversationChannel === "email") return "email";
  if (input.canaisDaConta && !input.canaisDaConta.includes("whatsapp")) return "email";
  if (!normalizarMobileUk(input.telefone)) return "email";
  return "whatsapp";
}

export function chaveDoLembrete(jobId: string, scheduledStartAt: string | null | undefined, scheduledDate?: string | null): string {
  return chaveDeEnvio("lembrete-24h", jobId, String(scheduledStartAt ?? scheduledDate ?? ""));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O e-mail do lembrete. Inglês, sem travessão, sem falar de VAT. */
export function emailDoLembrete(p: { primeiroNome: string; data: string; janela: string; endereco?: string | null; referencia?: string | null }): { assunto: string; html: string } {
  const onde = p.endereco ? ` at ${esc(p.endereco)}` : "";
  const assunto = `Reminder: your Fixfy visit is tomorrow${p.referencia ? ` (${p.referencia})` : ""}`;
  const html =
    `<p>Hi ${esc(p.primeiroNome || "there")},</p>` +
    `<p>Just a reminder that your Fixfy visit is booked for tomorrow, ${esc(p.data)}, with an arrival window of ${esc(p.janela)}${onde}.</p>` +
    `<p>If anything has changed, or someone else will let us in, simply reply to this email and we will sort it out.</p>` +
    `<p>Thank you,<br>Fixfy Team<br>hello@getfixfy.com · +44 20 4538 4668</p>`;
  return { assunto, html };
}
