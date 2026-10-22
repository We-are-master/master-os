/**
 * Aviso de remarcação para o CLIENTE (copy aprovada 20/10/2026, id 6).
 *
 * O par deste email para o parceiro já existia (`buildJobRescheduledEmail`, no
 * layout de parceiro). Faltava a outra metade: quando o escritório movia a
 * data, o parceiro sabia e o cliente descobria no dia, esperando alguém que
 * não ia mais. Este arquivo é a metade que faltava, na moldura única
 * (`fixfy-shell`, desenho de app).
 *
 * As duas datas aparecem lado a lado, a antiga riscada. Mostrar só a nova
 * obriga o cliente a lembrar qual era a antiga para entender o que mudou.
 */
import { emailFixfy, saudacao, type Publico } from "./fixfy-shell";
import { lerLinhaDaAgenda } from "@/lib/zendesk-job-confirmation";
import { metricasDaVisita, passosAte, PASSOS_VISITA } from "./faixas-do-email";

export type ClientRescheduleData = {
  clientFirstName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** "Wednesday 21 October 2026" ou "2026-10-21" */
  oldDateLine: string;
  /** "9AM – 12PM" ou "between 9am and midday", quando existir */
  oldTimeLine?: string | null;
  newDateLine: string;
  newTimeLine?: string | null;
  /** Motivo, quando o escritório quis dar um. Nunca inventado. */
  reason?: string | null;
  /** Quem recebe; sem ele, B2C pelo primeiro nome. */
  publico?: Publico;
  /**
   * A Fixfy mudou a data: o fecho vira o pedido de desculpas. O cliente pediu:
   * agradece. Sem saber quem mudou, nenhum dos dois (não se inventa).
   */
  iniciadoPelaFixfy?: boolean;
};

const juntar = (...p: Array<string | null | undefined>) => p.map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");

export function buildClientJobRescheduledEmail(data: ClientRescheduleData): {
  subject: string;
  html: string;
  text: string;
} {
  const novo = lerLinhaDaAgenda(data.newDateLine, data.newTimeLine);
  const antes = lerLinhaDaAgenda(data.oldDateLine, data.oldTimeLine);
  const publico: Publico = data.publico ?? { tipo: "b2c", primeiroNome: data.clientFirstName };
  const motivo = data.reason?.trim() || null;

  const subject = novo.data ? `Your booking has been rescheduled · ${novo.data}` : "Your booking has been rescheduled";
  const primeiro = novo.data
    ? novo.janela
      ? `Your booking has been moved to ${novo.data}, with arrival ${novo.janela}. We’ve included the previous and new details below.`
      : `Your booking has been moved to ${novo.data}. We’ll confirm the arrival time before the visit. We’ve included the previous and new details below.`
    : "Your booking has been moved. We’ve included the previous and new details below.";
  const fecho =
    data.iniciadoPelaFixfy === true
      ? "We’re sorry for the change of plan, and thank you for your understanding."
      : data.iniciadoPelaFixfy === false
        ? "Thanks for keeping us up to date."
        : null;

  const { html, text } = emailFixfy({
    preheader: novo.janela ? `Your revised arrival window is ${novo.janela}.` : "Your revised booking details are below.",
    estado: { texto: "Rescheduled", cor: "orange" },
    titulo: "Your new booking details",
    destaque: novo.data
      ? { linha1: novo.data, linha2: novo.janela ?? "Arrival time to be confirmed", riscado: juntar(antes.data, antes.janela) || null }
      : null,
    metricas: metricasDaVisita(novo.data, novo.janela),
    passos: passosAte(PASSOS_VISITA, 1),
    saudacao: saudacao(publico),
    paragrafos: [
      primeiro,
      "If the new arrangements don’t suit you, just reply and we’ll help find another option.",
      ...(fecho ? [fecho] : []),
    ],
    linhas: [
      ["Previously", juntar(antes.data, antes.janela)],
      ["Now", juntar(novo.data, novo.janela)],
      ["Service", data.jobTitle],
      ["Property", data.propertyAddress],
      ["Booking", data.jobReference],
      ["Reason", motivo],
    ],
  });

  return { subject, html, text };
}
