/**
 * "Submit work report": o pedido de relatório que o escritório manda pelo
 * botão do painel do job (antes ficava dentro da rota
 * /api/jobs/[id]/send-partner-report-link). Moldura única, variante Zendesk:
 * sai na conversa lateral do job.
 */
import { emailFixfy } from "./fixfy-shell";
import { PASSO_RELATORIO, passosDoJob, saudacaoDoParceiro, semTravessao } from "./partner-shell";

export function partnerReportRequestSubject(jobReference: string): string {
  return semTravessao(`Submit work report · ${jobReference}`);
}

export function buildPartnerReportRequestEmail(args: {
  partnerName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  reportUrl: string;
}): { html: string; text: string } {
  return emailFixfy({
    zendesk: true,
    preheader: semTravessao(`Please submit the work report for ${args.jobReference}.`),
    estado: { texto: "Action required", cor: "orange" },
    titulo: "Please submit the work report",
    passos: passosDoJob(PASSO_RELATORIO),
    saudacao: saudacaoDoParceiro(args.partnerName),
    paragrafos: [semTravessao(`Please submit the work report for ${args.jobReference} · ${args.jobTitle}.`)],
    linhas: [
      ["Job", args.jobReference || null],
      ["Type of work", args.jobTitle || null],
      ["Address", args.propertyAddress || null],
    ],
    cta: { label: "Open report form", url: args.reportUrl },
    letraPequena: ["No app needed: the form runs in your browser. Photos are resized automatically before upload."],
  });
}
