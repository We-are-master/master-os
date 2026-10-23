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
import { dataLonga } from "./fixfy-shell";
import { PASSO_RELATORIO, emailParceiro, pagaDoParceiro, passosDoJob, saudacaoDoParceiro, semTravessao } from "./partner-shell";

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

function tarjaDeEspera(dias: number): string {
  if (dias <= 0) return "Done today";
  if (dias === 1) return "1 day waiting";
  return `${dias} days waiting`;
}

/** Assunto antigo (já distinto): `Submit your job report · JOB-9536`; vários: `3 job reports awaiting submission`. */
export function partnerMissingReportsSubject(jobs: readonly MissingReportJob[]): string {
  const ordem = [...jobs].sort((a, b) => b.daysWaiting - a.daysWaiting);
  const n = ordem.length;
  if (n === 1) return semTravessao(`Submit your job report · ${ordem[0]!.reference}`);
  return `${n} job reports awaiting submission`;
}

export function buildPartnerMissingReportsEmail(data: PartnerMissingReportsEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  // Mais velho primeiro: a ordem é a da dívida, não a do dia.
  const jobs = [...data.jobs].sort((a, b) => b.daysWaiting - a.daysWaiting);
  const n = jobs.length;
  const subject = partnerMissingReportsSubject(jobs);
  const unico = n === 1 ? jobs[0]! : null;
  const diaDe = (j: MissingReportJob) => dataLonga(j.dateYmd ?? null) ?? semTravessao(j.dateLabel);
  const emEspera = data.onHoldDisplay ? `${pagaDoParceiro(data.onHoldDisplay)?.valor ?? data.onHoldDisplay} on hold` : null;

  const { html, text } = emailParceiro({
    zendesk: false,
    preheader: `${n} report${n === 1 ? "" : "s"} waiting${data.onHoldDisplay ? ` · ${data.onHoldDisplay} on hold` : ""}`,
    estado: { texto: "Action required", cor: "orange", chip: true },
    titulo: unico ? "1 job report waiting" : `${n} job reports waiting`,
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [unico ? "There's 1 job waiting on its work report." : `There are ${n} jobs waiting on their work reports.`],
    passos: passosDoJob(PASSO_RELATORIO),
    metricas: [
      { rotulo: n === 1 ? "Report" : "Reports", valor: String(n) },
      { rotulo: "Oldest", valor: (jobs[0]?.daysWaiting ?? 0) <= 0 ? "Today" : `${jobs[0]!.daysWaiting}d` },
      ...(data.onHoldDisplay ? [{ rotulo: "On hold", valor: pagaDoParceiro(data.onHoldDisplay)?.valor ?? data.onHoldDisplay }] : []),
    ],
    // Um job: o quadro de sempre. Vários: uma linha por job, mais velho primeiro.
    linhas: unico
      ? [
          ["Job", `#${unico.reference}`],
          ["Type of work", unico.title || null],
          ["Date", diaDe(unico)],
          ["Address", unico.address || null],
        ]
      : jobs.map((j): [string, string] => [
          semTravessao(`${j.reference} · ${diaDe(j)} · ${tarjaDeEspera(j.daysWaiting)}`),
          semTravessao([j.title, j.address].filter((p) => p?.trim()).join(" · ")),
        ]),
    // O quadro vermelho só quando já está atrasado: sem relatório, o job não entra no pagamento.
    avisos:
      (jobs[0]?.daysWaiting ?? 0) > 0
        ? [{ tom: "red", icone: "⚡", titulo: "Avoid any payment delay", texto: "A job with no report can't be invoiced, so it doesn't enter the next payment run." }]
        : [],
    cta: unico ? { label: "Submit report", url: unico.reportUrl } : { label: "Open my jobs in Fixfy Trade", url: data.portalUrl },
    linksSecundarios: unico ? [{ label: "Open my jobs in Fixfy Trade", url: data.portalUrl }] : jobs.map((j) => ({ label: `Submit ${j.reference}`, url: j.reportUrl })),
    letraPequena: ["Already sent one of these? Reply to this email and we'll chase it on our side."],
  });
  return { subject, html, text };
}
