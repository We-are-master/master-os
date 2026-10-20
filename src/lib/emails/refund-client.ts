/**
 * E-mail de reembolso ao cliente (dono, 16/10/2026).
 *
 * O refund do job (`/api/jobs/[id]/refund`) devolvia no cartão e registrava no razão, mas o
 * cliente não ficava sabendo: o dinheiro aparecia no extrato dias depois sem explicação.
 * Aqui o aviso curto: quanto, por onde, de qual job e quando aparece. O motivo do refund é
 * interno e não vai no e-mail.
 */
import { Resend } from "resend";
import { dataLonga, emailFixfy, gbp, saudacao, type Publico } from "./fixfy-shell";
import { semTravessao } from "./billing-email-common";

const REMETENTE = "Fixfy Team <no-reply@getfixfy.com>";
const RESPONDER_PARA = "hello@getfixfy.com";

export type DadosDoReembolso = {
  primeiroNome: string | null;
  referenciaDoJob: string;
  tituloDoJob: string | null;
  valor: number;
  metodo: "stripe" | "bank_transfer";
  /** Final do cartão, quando a Stripe devolveu. */
  finalDoCartao?: string | null;
  /**
   * Reembolso a uma conta (cobrança B2B): "Hi {empresa} team,". Ausente = B2C pelo
   * primeiro nome. Nunca o nome da pessoa de contato em B2B.
   */
  empresa?: string | null;
  /** Quando o reembolso saiu (padrão: agora). Mostrado em Europe/London. */
  emitidoEm?: string | Date | null;
};

/**
 * Prazo de cada método, só o que se sabe (handoff: "Refund processing times must follow
 * the actual provider/method"). Cartão: o prazo que a Stripe publica para o reembolso
 * aparecer no extrato. Transferência: a equipe manda pelo banco; sem prazo prometido.
 */
function fraseDoPrazo(metodo: DadosDoReembolso["metodo"]): string {
  return metodo === "stripe"
    ? "Card refunds usually show on your statement within 5 to 10 working days, depending on your bank."
    : "We’ve sent it by bank transfer. If it hasn’t reached your account when you expect it, just reply and we’ll check it for you.";
}

/** Copy 19 na moldura única. Só chamar depois do reembolso feito (Stripe ok / transferência registrada). */
export function montarEmailDeReembolso(d: DadosDoReembolso): { subject: string; html: string; text: string } {
  const valor = gbp(d.valor);
  const publico: Publico = d.empresa?.trim() ? { tipo: "b2b", empresa: d.empresa } : { tipo: "b2c", primeiroNome: d.primeiroNome };
  const destino =
    d.metodo === "stripe"
      ? `your card${d.finalDoCartao ? ` ending ${d.finalDoCartao}` : ""}`
      : "your bank account";
  const servico = semTravessao(d.tituloDoJob) || `booking ${d.referenciaDoJob}`;
  const emitido = dataLonga(d.emitidoEm ?? new Date());
  const subject = `Your ${valor} refund has been issued · ${d.referenciaDoJob}`;
  const { html, text } = emailFixfy({
    preheader: `Your refund has been sent to ${destino}.`,
    estado: { texto: "Refund issued", cor: "green" },
    titulo: "Your refund is on its way",
    destaque: { linha1: `${valor} refunded`, linha2: `to ${destino}` },
    saudacao: saudacao(publico),
    paragrafos: [
      `We’ve issued a refund of ${valor} for ${servico} to ${destino}.`,
      fraseDoPrazo(d.metodo),
      "If you have any questions about the refund, just reply and we’ll help.",
    ],
    linhas: [
      ["Refund", valor],
      ["Issued", emitido],
      ["Booking", d.referenciaDoJob],
    ],
  });
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
