/**
 * O pedido de relatório que o escritório manda pelo botão do painel do job
 * (rota /api/jobs/[id]/send-partner-report-link). Padrão do parceiro: chip
 * "Report needed", "Send your report", a data do job e o prazo, um botão.
 */
import { dataLonga } from "./fixfy-shell";
import { CHIP_PARCEIRO, PASSO_RELATORIO, emailParceiro, passosDoJob, saudacaoDoParceiro, semTravessao } from "./partner-shell";

/** `Report needed · General Maintenance · Wed 28 Oct 26 · JOB-9800`. */
export function partnerReportRequestSubject(jobReference: string, _jobTitle?: string | null, _jobDate?: string | null): string {
  // Assunto antigo (já distinto), sem travessão (dono, 23/10/2026).
  return semTravessao(`Submit work report · ${jobReference}`);
}

export function buildPartnerReportRequestEmail(args: {
  partnerName?: string | null;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  reportUrl: string;
  /** YYYY-MM-DD (ou ISO) do dia do trabalho. */
  jobDate?: string | null;
}): { html: string; text: string } {
  const dia = args.jobDate?.trim() ? dataLonga(args.jobDate.trim().slice(0, 10)) : null;
  // Copy da versão antiga (dono, 23/10/2026: "usa a copy dos emails antigos").
  return emailParceiro({
    preheader: semTravessao(`Please submit the work report for ${args.jobReference}.`),
    estado: CHIP_PARCEIRO.relatorio,
    titulo: "Please submit the work report",
    saudacao: saudacaoDoParceiro(args.partnerName),
    paragrafos: [semTravessao(`Please submit the work report for ${args.jobReference} · ${args.jobTitle}.`)],
    passos: passosDoJob(PASSO_RELATORIO),
    metricas: [
      ...(dia ? [{ rotulo: "Date", valor: dia }] : []),
      { rotulo: "Due", valor: "Today" },
    ],
    linhas: [
      ["Job", args.jobReference ? `#${args.jobReference}` : null],
      ["Type of work", args.jobTitle || null],
      ["Address", args.propertyAddress || null],
    ],
    cartoes: [
      { icone: "📸", titulo: "Before and after", texto: "One photo per room" },
      { icone: "🧾", titulo: "Receipts", texto: "For any material" },
      { icone: "✍️", titulo: "Short summary", texto: "What you did" },
    ],
    cta: { label: "Open report form", url: args.reportUrl },
    letraPequena: ["No app needed: the form runs in your browser."],
  });
}
