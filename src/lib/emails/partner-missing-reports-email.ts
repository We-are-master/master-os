/**
 * O email diário das 20h (UK): "os relatórios que ainda faltam".
 *
 * Fecha o par do email das 17h. Aquele abre o dia dizendo o que fazer; este
 * fecha o dia cobrando o que não foi entregue. O que trava um job no Final
 * check é quase sempre relatório que nunca chegou, e a cobrança acontecia no
 * WhatsApp, uma a uma, quando alguém do escritório lembrava.
 *
 * Três decisões que valem explicação:
 *
 * 1. **Mais velho primeiro.** A ordem não é a do dia, é a da dívida. O
 *    relatório de três dias atrás é o que trava pagamento e o que o parceiro
 *    esqueceu de verdade; o de hoje ele ainda tem na cabeça.
 *
 * 2. **O dinheiro aparece.** "£X on hold" é o motivo real de o relatório
 *    importar, e é fato, não pressão inventada: sem relatório o job não fecha e
 *    a nota não sai. Dizer isso é mais honesto do que pedir "por favor" três
 *    vezes.
 *
 * 3. **Um link por job, direto no formulário.** Não é "entre no portal e
 *    procure". Cada card leva ao report daquele job, com o mesmo token por
 *    (job, parceiro) que o escritório copia na lista de Final checks.
 */
import { emailFixfy, dataLonga } from "./fixfy-shell";
import { PASSO_RELATORIO, passosDoJob, saudacaoDoParceiro, semTravessao } from "./partner-shell";

export type MissingReportJob = {
  /** "JOB-9536" — o parceiro reconhece o job por ela quando responde. */
  reference: string;
  title: string;
  address: string;
  clientFirstName: string | null;
  /** "Wed 27 Aug": o dia em que o trabalho foi feito (só usado sem `dateYmd`). */
  dateLabel: string;
  /** YYYY-MM-DD do dia do trabalho: vira "Wed 27 Aug 26". */
  dateYmd?: string | null;
  /** 0 = feito hoje. É o que decide a cor da tarja e a ordem da lista. */
  daysWaiting: number;
  /** Link tokenizado do formulário DESTE job. */
  reportUrl: string;
  /** "£114.00" — o que este job paga quando fecha. null esconde a linha. */
  payDisplay: string | null;
};

export type PartnerMissingReportsEmailData = {
  partnerFirstName: string;
  jobs: MissingReportJob[];
  /** Soma dos `payDisplay`, já formatada: "£277.80". null esconde o stat. */
  onHoldDisplay: string | null;
  portalUrl: string;
  supportEmail?: string;
  supportPhone?: string;
};

function tarjaDeEspera(dias: number): { texto: string } {
  if (dias <= 0) return { texto: "Done today" };
  if (dias === 1) return { texto: "1 day waiting" };
  return { texto: `${dias} days waiting` };
}

export function buildPartnerMissingReportsEmail(data: PartnerMissingReportsEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  // Mais velho primeiro: a ordem é a da dívida, não a do dia.
  const jobs = [...data.jobs].sort((a, b) => b.daysWaiting - a.daysWaiting);
  const n = jobs.length;
  const maisVelho = jobs[0]?.daysWaiting ?? 0;

  // Lead with the required action; payment context belongs in the preview.
  const subject =
    n === 1
      ? `Submit your job report · ${jobs[0]!.reference}`
      : `${n} job reports awaiting submission`;

  const linhaDoJob = (j: MissingReportJob) => {
    const tarja = tarjaDeEspera(j.daysWaiting);
    const dia = dataLonga(j.dateYmd ?? null) ?? j.dateLabel;
    const partes = [
      tarja.texto,
      dia,
      j.reference,
      j.title,
      j.address,
      j.clientFirstName,
      j.payDisplay,
    ].filter((p): p is string => Boolean(p && String(p).trim()));
    return semTravessao(partes.join(" · "));
  };

  const abertura =
    n === 1
      ? "There's 1 job waiting on its work report."
      : `There are ${n} jobs waiting on their work reports.`;

  // Um link por job, direto no formulário daquele job. Com um job só, ele é o botão.
  const unico = n === 1 ? jobs[0]! : null;

  const { html, text } = emailFixfy({
    preheader: `${n} report${n === 1 ? "" : "s"} waiting${data.onHoldDisplay ? ` · ${data.onHoldDisplay} on hold` : ""}`,
    estado: { texto: "Action required", cor: "orange" },
    titulo: n === 1 ? "1 job report waiting" : `${n} job reports waiting`,
    passos: passosDoJob(PASSO_RELATORIO),
    metricas: [
      { rotulo: n === 1 ? "Report" : "Reports", valor: String(n) },
      { rotulo: "Oldest", valor: maisVelho <= 0 ? "Today" : `${maisVelho}d` },
      ...(data.onHoldDisplay ? [{ rotulo: "On hold", valor: data.onHoldDisplay }] : []),
    ],
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      `${abertura} Each one below opens straight on its own form.`,
      "Oldest first",
      ...jobs.map(linhaDoJob),
    ],
    nota: `Avoid any payment delay. A job with no report can't be invoiced, so it doesn't enter the next payment run. Send ${n === 1 ? "it" : "them"} tonight and ${n === 1 ? "this job clears" : "these jobs clear"} with the rest.`,
    cta: unico
      ? { label: "Submit report", url: unico.reportUrl }
      : { label: "Open my jobs in Fixfy Trade", url: data.portalUrl },
    linksSecundarios: unico
      ? [{ label: "Open my jobs in Fixfy Trade", url: data.portalUrl }]
      : jobs.map((j) => ({ label: `Submit ${j.reference}`, url: j.reportUrl })),
    letraPequena: ["Already sent one of these? Reply to this email and we'll chase it on our side."],
  });
  return { subject, html, text };
}
