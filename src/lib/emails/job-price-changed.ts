/**
 * Aviso de mudança de preço do job: um e-mail para o lado do cliente e outro
 * para o parceiro, no mesmo molde da remarcação (valor novo em destaque, o
 * antigo riscado ao lado).
 *
 * ─── A regra que não se quebra ───────────────────────────────────────────
 *
 * Cada builder só RECEBE o dinheiro do seu lado. O do cliente não tem campo
 * para o repasse do parceiro e o do parceiro não tem campo para o preço do
 * cliente: não dá para vazar margem por engano, porque o número nem chega aqui.
 */
import { emailFixfy, gbp, saudacao, type Estado, type Metrica, type Publico } from "./fixfy-shell";
import { passosDoJob, PASSO_ACEITO, saudacaoDoParceiro, semTravessao } from "./partner-shell";
import { passosAte, PASSOS_VISITA } from "./faixas-do-email";

export type PriceChangeBilling = "fixed" | "hourly";

export type PriceChangeHourly = {
  /** Taxa por hora antes da mudança (do lado de quem recebe o e-mail). */
  oldRate?: number | null;
  /** Taxa por hora depois da mudança (do lado de quem recebe o e-mail). */
  newRate?: number | null;
  /** Horas estimadas do job, quando o valor é uma estimativa. */
  hours?: number | null;
};

export type ClientJobPriceChangedData = {
  publico: Publico;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** Preço do CLIENTE antes. */
  oldAmount: number;
  /** Preço do CLIENTE depois. */
  newAmount: number;
  billing: PriceChangeBilling;
  /** Só taxas do cliente. */
  hourly?: PriceChangeHourly | null;
};

export type PartnerJobPriceChangedData = {
  partnerFirstName?: string | null;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** Repasse do PARCEIRO antes. */
  oldPay: number;
  /** Repasse do PARCEIRO depois. */
  newPay: number;
  billing: PriceChangeBilling;
  /** Só taxas do parceiro. */
  hourly?: PriceChangeHourly | null;
  /** Link do job no app do parceiro. */
  jobUrl?: string | null;
};

type Email = { subject: string; html: string; text: string };

const num = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

const porHora = (n: number | null | undefined): string | null => {
  const v = num(n);
  return v == null ? null : `${gbp(v)}/h`;
};

/** "3 hours", "1 hour", "2.5 hours". */
function horasTexto(h: number | null | undefined): string | null {
  const v = num(h);
  if (v == null || v <= 0) return null;
  const t = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return `${t} ${v === 1 ? "hour" : "hours"}`;
}

const juntar = (...p: Array<string | null | undefined>) =>
  p.map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");

const ESTADO_CLIENTE: Estado = { texto: "Price updated", cor: "orange", chip: true };

/**
 * O quadro navy cheio (dono, 10/11/2026: "o price updated tá feio assim"): o
 * valor novo à esquerda, o antigo riscado à direita; por hora, a taxa no meio.
 * Mesmo quadro nos dois e-mails.
 */
function metricasDoPreco(a: {
  rotuloNovo: string; novo: string; hourly: boolean; horas: string | null;
  taxaNova: string | null; taxaAntiga: string | null; taxaMudou: boolean; antigo: string; subFixo: string;
}): Metrica[] {
  if (!a.hourly) {
    return [
      { rotulo: a.rotuloNovo, valor: a.novo, sub: a.subFixo },
      { rotulo: "Previously", valor: a.antigo, riscado: true },
    ];
  }
  return [
    { rotulo: "New estimate", valor: a.novo, sub: a.horas ? `Based on ${a.horas}` : "Follows the time on site" },
    ...(a.taxaNova ? [{ rotulo: "Hourly rate", valor: a.taxaNova, sub: a.taxaMudou && a.taxaAntiga ? `Was ${a.taxaAntiga}` : null }] : []),
    { rotulo: "Previously", valor: a.antigo, riscado: true },
  ];
}

// ─── Cliente ─────────────────────────────────────────────────────────────

export function buildClientJobPriceChangedEmail(data: ClientJobPriceChangedData): Email {
  const novo = gbp(data.newAmount);
  const antigo = gbp(data.oldAmount);
  const hourly = data.billing === "hourly";
  const taxaNova = hourly ? porHora(data.hourly?.newRate) : null;
  const taxaAntiga = hourly ? porHora(data.hourly?.oldRate) : null;
  const taxaMudou = Boolean(taxaNova && taxaAntiga && taxaNova !== taxaAntiga);
  const horas = hourly ? horasTexto(data.hourly?.hours) : null;

  const ref = data.jobReference.trim();
  const subject = ref ? `Your booking price has been updated · ${ref}` : "Your booking price has been updated";

  const paragrafos = hourly
    ? [
        taxaNova
          ? `We’ve updated the price for your booking. It’s charged at ${taxaNova}, so the final amount follows the time on site.`
          : "We’ve updated the price for your booking. It’s charged by the hour, so the final amount follows the time on site.",
        horas ? `The estimate below is based on ${horas}.` : null,
        "If you have any questions, just reply to this email.",
      ]
    : [
        `We’ve updated the price for your booking. The new price is ${novo}.`,
        "If you have any questions, just reply to this email.",
      ];

  const metricas = metricasDoPreco({
    rotuloNovo: "New price", novo, hourly, horas, taxaNova, taxaAntiga, taxaMudou, antigo, subFixo: "Fixed price",
  });

  const { html, text } = emailFixfy({
    preheader: hourly ? `Your new estimate is ${novo}.` : `Your new price is ${novo}.`,
    estado: ESTADO_CLIENTE,
    // Faixa de aviso no topo e a régua do job (dono, 10/11/2026: "coloca a bar nele").
    faixa: { tipo: "acao", texto: "Price updated", nota: ref || null },
    passos: passosAte(PASSOS_VISITA, 1),
    titulo: "Your price has been updated",
    metricas,
    saudacao: saudacao(data.publico),
    paragrafos: paragrafos.filter((p): p is string => Boolean(p)),
    linhas: [
      ["Previously", juntar(antigo, taxaMudou ? taxaAntiga : null)],
      ["Now", juntar(novo, taxaNova)],
      ["Pricing", hourly ? "Hourly. Final amount follows the time on site" : "Fixed price"],
      ["Service", data.jobTitle],
      ["Property", data.propertyAddress],
      ["Booking", ref],
    ],
  });

  return { subject, html, text };
}

// ─── Parceiro ────────────────────────────────────────────────────────────

export function buildPartnerJobPriceChangedEmail(data: PartnerJobPriceChangedData): Email {
  // Mesmo desenho do e-mail do cliente (dono, 10/11/2026: "mesmo style pra both"):
  // valor novo em destaque, o antigo riscado embaixo, Previously / Now na tabela.
  const hourly = data.billing === "hourly";
  const novo = gbp(data.newPay);
  const antigo = gbp(data.oldPay);
  const taxaNova = hourly ? porHora(data.hourly?.newRate) : null;
  const taxaAntiga = hourly ? porHora(data.hourly?.oldRate) : null;
  const taxaMudou = Boolean(taxaNova && taxaAntiga && taxaNova !== taxaAntiga);
  const horas = hourly ? horasTexto(data.hourly?.hours) : null;
  const ref = data.jobReference.trim();

  const subject = semTravessao(ref ? `Your pay has been updated · ${ref}` : "Your pay has been updated");

  const paragrafos = hourly
    ? [
        taxaNova
          ? `We’ve updated your pay for this job. It’s paid at ${taxaNova}, so the final amount follows the time on site.`
          : "We’ve updated your pay for this job. It’s paid by the hour, so the final amount follows the time on site.",
        horas ? `The estimate below is based on ${horas}.` : null,
        "Something doesn’t look right? Just reply to this email and we’ll sort it.",
      ]
    : [
        `We’ve updated your pay for this job. Your new pay is ${novo}.`,
        "Something doesn’t look right? Just reply to this email and we’ll sort it.",
      ];

  const metricas = metricasDoPreco({
    rotuloNovo: "Your new pay", novo, hourly, horas, taxaNova, taxaAntiga, taxaMudou, antigo, subFixo: "Fixed pay",
  });

  const endereco = data.propertyAddress?.trim() && data.propertyAddress.trim() !== "—" ? data.propertyAddress.trim() : "";
  const url = data.jobUrl?.trim() || null;

  const { html, text } = emailFixfy({
    preheader: semTravessao(hourly ? `Your new estimate is ${novo}.` : `Your new pay is ${novo}.`),
    estado: ESTADO_CLIENTE,
    faixa: { tipo: "acao", texto: "Price updated", nota: ref || null },
    passos: passosDoJob(PASSO_ACEITO),
    titulo: "Your pay has been updated",
    metricas,
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: paragrafos.filter((p): p is string => Boolean(p)).map(semTravessao),
    linhas: [
      ["Previously", juntar(antigo, taxaMudou ? taxaAntiga : null)],
      ["Now", juntar(novo, taxaNova)],
      ["Pricing", hourly ? "Hourly. Final amount follows the time on site" : "Fixed"],
      ["Service", data.jobTitle?.trim() || ""],
      ["Property", endereco],
      ["Booking", ref],
    ],
    cta: url ? { label: "Open job in app", url } : null,
  });

  return { subject, html, text };
}
