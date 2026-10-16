/**
 * E-mail de reembolso ao cliente (dono, 16/10/2026).
 *
 * O refund do job (`/api/jobs/[id]/refund`) devolvia no cartão e registrava no razão, mas o
 * cliente não ficava sabendo: o dinheiro aparecia no extrato dias depois sem explicação.
 * Aqui o aviso curto: quanto, por onde, de qual job e quando aparece. O motivo do refund é
 * interno e não vai no e-mail.
 */
import { Resend } from "resend";

const REMETENTE = "Fixfy Team <no-reply@getfixfy.com>";
const RESPONDER_PARA = "hello@getfixfy.com";
const LOGO = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

export type DadosDoReembolso = {
  primeiroNome: string | null;
  referenciaDoJob: string;
  tituloDoJob: string | null;
  valor: number;
  metodo: "stripe" | "bank_transfer";
  /** Final do cartão, quando a Stripe devolveu. */
  finalDoCartao?: string | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function montarEmailDeReembolso(d: DadosDoReembolso): { subject: string; html: string; text: string } {
  const valor = `£${d.valor.toFixed(2)}`;
  const oi = d.primeiroNome?.trim() ? `Hi ${d.primeiroNome.trim().split(/\s+/)[0]},` : "Hi,";
  const job = d.tituloDoJob?.trim() ? `${d.referenciaDoJob} (${d.tituloDoJob.trim()})` : d.referenciaDoJob;
  const como =
    d.metodo === "stripe"
      ? `we've refunded ${valor} to your card${d.finalDoCartao ? ` ending ${d.finalDoCartao}` : ""} for job ${job}.`
      : `we're sending you a refund of ${valor} by bank transfer for job ${job}.`;
  const quando =
    d.metodo === "stripe"
      ? "It usually shows on your statement within 5 to 10 working days, depending on your bank."
      : "It should reach your account within 1 to 3 working days.";
  const subject = `Your ${valor} refund is on its way · ${d.referenciaDoJob}`;
  const text = `${oi}\n\n${como.charAt(0).toUpperCase()}${como.slice(1)} ${quando}\n\nAny questions, reply to this email or write to ${RESPONDER_PARA}.\n\nFixfy Team`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:0;background:#F7F7FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="border:0;padding:32px 16px;">
<div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;text-align:left;">
<div style="background:#020040;padding:16px 24px;"><img src="${LOGO}" alt="Fixfy" width="74" height="32" style="display:block;margin:0 auto;width:74px;height:32px;border:0;"></div>
<div style="background:#ED4B00;height:4px;line-height:4px;font-size:4px;">&nbsp;</div>
<div style="padding:22px 24px 20px 24px;">
<p style="margin:0 0 10px 0;font-size:10px;font-weight:700;letter-spacing:2.5px;color:#ED4B00;text-transform:uppercase;">Refund</p>
<p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:#4A4A55;">${esc(oi)} ${esc(como)}</p>
<p style="margin:0 0 16px 0;font-size:24px;font-weight:700;line-height:30px;color:#020040;">${esc(valor)}</p>
<p style="margin:0;font-size:14px;line-height:21px;color:#4A4A55;">${esc(quando)}</p>
<p style="margin:20px 0 0 0;font-size:13px;line-height:20px;color:#4A4A55;">Any questions, reply to this email or write to <a href="mailto:${RESPONDER_PARA}" style="color:#020040;font-weight:600;text-decoration:none;">${RESPONDER_PARA}</a>.</p>
</div>
<div style="background:#020040;padding:24px;text-align:center;"><p style="margin:0;font-size:11px;line-height:16px;color:#AAAAD0;">Getfixfy Ltd &middot; 124 City Road, London EC1V 2NX &middot; <a href="https://getfixfy.com" style="color:#AAAAD0;text-decoration:none;">getfixfy.com</a></p></div>
</div>
</td></tr>
</table>`.trim();
  return { subject, html, text };
}

export type EnvioDoReembolso = (msg: { from: string; to: string[]; replyTo: string; subject: string; html: string; text: string }) => Promise<{ id?: string }>;

async function enviarPeloResend(msg: Parameters<EnvioDoReembolso>[0]): Promise<{ id?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const { data, error } = await new Resend(key).emails.send(msg);
  if (error) throw new Error(typeof error === "object" && "message" in error ? String(error.message) : "send failed");
  return { id: data?.id };
}

export async function enviarEmailDeReembolso(
  para: string,
  d: DadosDoReembolso,
  enviar: EnvioDoReembolso = enviarPeloResend,
): Promise<{ id?: string }> {
  const m = montarEmailDeReembolso(d);
  return enviar({ from: REMETENTE, to: [para], replyTo: RESPONDER_PARA, subject: m.subject, html: m.html, text: m.text });
}
