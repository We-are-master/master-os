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
import {
  partnerEmailHeadBlock,
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailPreheaderHtml,
  partnerEmailOuterTableOpen,
  partnerEmailOuterTableClose,
  partnerEmailLogoHeaderRow,
  partnerEmailGreetingH1Html,
} from "./partner-email-layout";

const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MissingReportJob = {
  /** "JOB-9536" — o parceiro reconhece o job por ela quando responde. */
  reference: string;
  title: string;
  address: string;
  clientFirstName: string | null;
  /** "Wed 27 Aug" — o dia em que o trabalho foi feito. */
  dateLabel: string;
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

/** Dois dias é o limite do "esqueci"; daí em diante é atraso, e a cor muda. */
const DIAS_PARA_ALERTA = 2;

function tarjaDeEspera(dias: number): { texto: string; fundo: string; cor: string } {
  if (dias <= 0) return { texto: "Done today", fundo: "#EEF2FF", cor: "#3730A3" };
  if (dias === 1) return { texto: "1 day waiting", fundo: "#EEF2FF", cor: "#3730A3" };
  if (dias <= DIAS_PARA_ALERTA) return { texto: `${dias} days waiting`, fundo: "#FEF3C7", cor: "#92400E" };
  return { texto: `${dias} days waiting`, fundo: "#FDECEA", cor: "#A32D2D" };
}

export function buildPartnerMissingReportsEmail(data: PartnerMissingReportsEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";

  // Mais velho primeiro: a ordem é a da dívida, não a do dia.
  const jobs = [...data.jobs].sort((a, b) => b.daysWaiting - a.daysWaiting);
  const n = jobs.length;
  const maisVelho = jobs[0]?.daysWaiting ?? 0;

  /**
   * Profissional e amigável, nesta ordem: "Quick Reminder" avisa que é lembrete
   * e não bronca, e "to submit" pede sem acusar. "still to submit" carregava um
   * dedo apontado que não ajuda quem esqueceu de boa-fé, e o assunto é onde o
   * parceiro decide se abre. O dinheiro fica no preheader, ao lado: no assunto
   * ele lê como cobrança de dívida.
   */
  const subject =
    n === 1
      ? `Quick Reminder: 1 work report to submit · ${jobs[0]!.reference}`
      : `Quick Reminder: ${n} work reports to submit`;

  const statCell = (value: string, label: string, opts?: { accent?: boolean; first?: boolean }) => `
            <td align="center" style="padding:12px 6px;${opts?.first ? "" : " border-left:1px solid rgba(255,255,255,0.14);"}">
              <p style="margin:0; ${FONT}; font-size:17px; font-weight:700; color:${opts?.accent ? "#ED4B00" : "#FFFFFF"};">${escapeHtml(value)}</p>
              <p style="margin:1px 0 0 0; ${FONT}; font-size:10px; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.65);">${escapeHtml(label)}</p>
            </td>`;

  const stats = [
    statCell(String(n), n === 1 ? "Report" : "Reports", { first: true }),
    statCell(maisVelho <= 0 ? "Today" : `${maisVelho}d`, "Oldest"),
    ...(data.onHoldDisplay ? [statCell(data.onHoldDisplay, "On hold", { accent: true })] : []),
  ].join("\n");

  const cards = jobs
    .map((j) => {
      const tarja = tarjaDeEspera(j.daysWaiting);
      return `      <tr><td style="padding:6px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr>
            <td valign="top" style="padding:14px 14px 14px 16px; word-break:break-word;">
              <p style="margin:0 0 5px 0;">
                <span style="display:inline-block; padding:2px 8px; border-radius:999px; background:${tarja.fundo}; ${FONT}; font-size:10px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:${tarja.cor};">${escapeHtml(tarja.texto)}</span>
              </p>
              <p style="margin:0; ${FONT}; font-size:11px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:#ED4B00;">${escapeHtml(j.dateLabel)} · ${escapeHtml(j.reference)}</p>
              <p style="margin:3px 0 2px 0; ${FONT}; font-size:15px; font-weight:600; color:#0A0A1F;">${escapeHtml(j.title)}</p>
              <p style="margin:0; ${FONT}; font-size:12.5px; line-height:19px; color:#3A3A55;">📍 ${escapeHtml(j.address)}</p>
              ${
                j.clientFirstName || j.payDisplay
                  ? `<p style="margin:2px 0 0 0; ${FONT}; font-size:12.5px; color:#3A3A55;">${j.clientFirstName ? `${escapeHtml(j.clientFirstName)}${j.payDisplay ? " · " : ""}` : ""}${j.payDisplay ? `<strong style="color:#0A0A1F;">${escapeHtml(j.payDisplay)}</strong>` : ""}</p>`
                  : ""
              }
            </td>
            <td width="118" valign="middle" align="right" style="padding-right:14px;">
              <a href="${escapeHtml(j.reportUrl)}" target="_blank" style="display:inline-block; padding:9px 12px; border-radius:6px; background:#020040; ${FONT}; font-size:11.5px; font-weight:600; color:#FFFFFF; text-decoration:none; white-space:nowrap;">Submit report →</a>
            </td>
          </tr>
        </table>
      </td></tr>`;
    })
    .join("\n");

  const abertura =
    n === 1
      ? "There's <strong style=\"color:#0A0A1F;\">1 job</strong> waiting on its work report."
      : `There are <strong style="color:#0A0A1F;">${n} jobs</strong> waiting on their work reports.`;

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`${n} report${n === 1 ? "" : "s"} waiting${data.onHoldDisplay ? ` · ${data.onHoldDisplay} on hold` : ""}`)}
${partnerEmailOuterTableOpen()}
${partnerEmailLogoHeaderRow()}

      <tr><td style="padding:34px 40px 6px 40px;" class="px-mobile">
        ${partnerEmailGreetingH1Html(escapeHtml(data.partnerFirstName || "there"), { marginBottom: "10px" })}
        <p style="margin:0; ${FONT}; font-size:15px; line-height:23px; color:#3A3A55;">${abertura} Each one below opens straight on its own form.</p>
      </td></tr>

      <tr><td style="padding:14px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF3EC; border:1px solid #FFD5BF; border-left:4px solid #ED4B00; border-radius:8px;">
          <tr><td style="padding:13px 16px;">
            <p style="margin:0 0 3px 0; ${FONT}; font-size:14px; font-weight:700; color:#B33A00;">⚡ Avoid any payment delay</p>
            <p style="margin:0; ${FONT}; font-size:13px; line-height:20px; color:#7A3312;">A job with no report can't be invoiced, so it doesn't enter the next payment run. Send ${n === 1 ? "it" : "them"} tonight and ${n === 1 ? "this job clears" : "these jobs clear"} with the rest.</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:14px 40px 4px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#020040; border-radius:10px;">
          <tr>
${stats}
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:14px 40px 0 40px;" class="px-mobile">
        <p style="margin:0; ${FONT}; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Oldest first</p>
      </td></tr>

${cards}

      <tr><td align="center" style="padding:22px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-mobile">
          <tr><td align="center" style="border-radius:8px; background-color:#ED4B00;">
            <a href="${escapeHtml(data.portalUrl)}" target="_blank" style="display:inline-block; padding:15px 34px; ${FONT}; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Open my jobs in Fixfy Trade</a>
          </td></tr>
        </table>
        <p style="margin:10px 0 0 0; ${FONT}; font-size:12px; line-height:18px; color:#6B6B85;">Already sent one of these? Reply to this email and we'll chase it on our side.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:20px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; ${FONT}; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:${escapeHtml(supportEmail)}" style="color:#6B6B85;">${escapeHtml(supportEmail)}</a> · ${escapeHtml(supportPhone)}</p>
      </td></tr>
${partnerEmailOuterTableClose()}
</body></html>`;

  const text = `Hi ${data.partnerFirstName || "there"},

${n === 1 ? "There's 1 job" : `There are ${n} jobs`} waiting on ${n === 1 ? "its work report" : "their work reports"}.

AVOID ANY PAYMENT DELAY
A job with no report can't be invoiced, so it doesn't enter the next payment run. Send ${n === 1 ? "it" : "them"} tonight and ${n === 1 ? "this job clears" : "these jobs clear"} with the rest.
${data.onHoldDisplay ? `\n${data.onHoldDisplay} on hold · oldest ${maisVelho <= 0 ? "from today" : `${maisVelho} days`}\n` : ""}
${jobs
  .map(
    (j) =>
      `${tarjaDeEspera(j.daysWaiting).texto.toUpperCase()}\n${j.dateLabel} · ${j.reference} · ${j.title}\n   ${j.address}\n   ${j.clientFirstName ? `${j.clientFirstName}${j.payDisplay ? ` · ${j.payDisplay}` : ""}` : (j.payDisplay ?? "")}\n   Submit: ${j.reportUrl}`,
  )
  .join("\n\n")}

Open your jobs: ${data.portalUrl}

Already sent one of these? Reply to this email. ${supportEmail} · ${supportPhone}`;

  return { subject, html, text };
}
