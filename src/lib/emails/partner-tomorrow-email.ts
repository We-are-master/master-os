/**
 * O email diário das 17h (UK): "seus jobs de amanhã", na ordem do dia.
 *
 * Duas caras, um builder: parceiro com endereço de casa cadastrado vê a ROTA
 * (saída de casa, pernas de deslocamento entre paradas, tempo total no
 * volante); empresa multi-equipe (sem endereço de casa) vê a lista limpa em
 * ordem de chegada, sem rota — ela distribui entre a equipe dela.
 *
 * Earnings vs Potential earnings (dono, 25/08): dia só de preço combinado
 * (fixed/day rate/half day) promete o número exato; dia com hourly no meio
 * vira "Potential earnings £X+" — nunca prometer número que depende do
 * relógio. O rótulo do acordo vem NA FRENTE do valor em cada card.
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
import { formatDuration, formatDistanceMiles } from "@/lib/mapbox-directions";

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

export type PartnerTomorrowStop = {
  /** "8:00 AM – 12:00 PM" ou "Time to be confirmed". */
  windowLabel: string;
  title: string;
  address: string;
  clientFirstName: string | null;
  /** Já formatado com o rótulo na frente: "Half day · £75.00". */
  payDisplay: string;
  /** Link simples que leva ao portal. */
  portalUrl: string;
  /** Perna ATÉ esta parada (null na primeira ou no modo sem rota). */
  drive: { durationSec: number; distanceM: number } | null;
  /** Divide o dia em Morning/Afternoon (dono, 26/08). null = sem horário. */
  slot?: "morning" | "afternoon" | null;
};

export type PartnerTomorrowEmailData = {
  partnerFirstName: string;
  /** "Tuesday 26 August". */
  dateLabel: string;
  stops: PartnerTomorrowStop[];
  /** true = variante com rota (casa cadastrada e pernas calculadas). */
  showRoute: boolean;
  totalDriveSec: number | null;
  firstArrivalLabel: string;
  /** "Earnings" ou "Potential earnings". */
  earningsLabel: string;
  /** "£166.90" ou "£166.90+". */
  earningsDisplay: string;
  portalUrl: string;
  /** "today" quando o disparo sai depois da meia-noite de Londres (correção). */
  dayWord?: "today" | "tomorrow";
  /** Banner âmbar sob a abertura — usado no reenvio de correção. */
  correctionNote?: string | null;
  supportEmail?: string;
  supportPhone?: string;
};

export function buildPartnerTomorrowEmail(data: PartnerTomorrowEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const n = data.stops.length;
  const dayWord = data.dayWord ?? "tomorrow";
  const subject = `Your jobs for ${dayWord} — ${data.dateLabel} (${n} job${n === 1 ? "" : "s"})`;

  const statCell = (value: string, label: string, opts?: { accent?: boolean; first?: boolean }) => `
            <td align="center" style="padding:12px 6px;${opts?.first ? "" : " border-left:1px solid rgba(255,255,255,0.14);"}">
              <p style="margin:0; ${FONT}; font-size:17px; font-weight:700; color:${opts?.accent ? "#ED4B00" : "#FFFFFF"};">${escapeHtml(value)}</p>
              <p style="margin:1px 0 0 0; ${FONT}; font-size:10px; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.65);">${escapeHtml(label)}</p>
            </td>`;

  const stats = [
    statCell(String(n), n === 1 ? "Job" : "Jobs", { first: true }),
    statCell(data.firstArrivalLabel, "First arrival"),
    ...(data.showRoute && data.totalDriveSec != null && data.totalDriveSec > 0
      ? [statCell(formatDuration(data.totalDriveSec), "On the road")]
      : []),
    statCell(data.earningsDisplay, data.earningsLabel, { accent: true }),
  ].join("\n");

  // Cabeçalho de slot entra quando o slot MUDA de uma parada pra outra; a
  // numeração segue contínua (a ordem do dia é uma só, o slot é só leitura).
  const slotHeaderHtml = (slot: "morning" | "afternoon") => `      <tr><td style="padding:16px 40px 2px 40px;" class="px-mobile">
        <p style="margin:0; ${FONT}; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">${slot === "morning" ? "🌅 Morning slot" : "🌇 Afternoon slot"}</p>
      </td></tr>`;
  const temSlots = data.stops.some((s) => s.slot != null);

  const cards = data.stops
    .map((s, i) => {
      const slotHeader =
        temSlots && s.slot != null && data.stops[i - 1]?.slot !== s.slot ? `${slotHeaderHtml(s.slot)}\n` : "";
      const drive =
        data.showRoute && s.drive && s.drive.durationSec > 0
          ? `      <tr><td style="padding:2px 40px;" class="px-mobile"><p style="margin:0; padding-left:34px; ${FONT}; font-size:11.5px; color:#6B6B85;">↓ ${formatDuration(s.drive.durationSec)} drive · ${formatDistanceMiles(s.drive.distanceM)}</p></td></tr>\n`
          : "";
      return `${slotHeader}${drive}      <tr><td style="padding:6px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr>
            <td width="46" valign="top" style="padding:14px 0 14px 14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" style="width:26px; height:26px; border-radius:999px; background-color:#020040; ${FONT}; font-size:13px; font-weight:700; color:#FFFFFF;">${i + 1}</td>
              </tr></table>
            </td>
            <td valign="top" style="padding:12px 14px 12px 10px; word-break:break-word;">
              <p style="margin:0; ${FONT}; font-size:11px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:#ED4B00;">${escapeHtml(s.windowLabel)}</p>
              <p style="margin:3px 0 2px 0; ${FONT}; font-size:15px; font-weight:600; color:#0A0A1F;">${escapeHtml(s.title)}</p>
              <p style="margin:0; ${FONT}; font-size:12.5px; line-height:19px; color:#3A3A55;">📍 ${escapeHtml(s.address)}</p>
              <p style="margin:2px 0 0 0; ${FONT}; font-size:12.5px; color:#3A3A55;">${s.clientFirstName ? `${escapeHtml(s.clientFirstName)} · ` : ""}<strong style="color:#0A0A1F;">${escapeHtml(s.payDisplay)}</strong></p>
            </td>
            <td width="86" valign="middle" align="right" style="padding-right:14px;">
              <a href="${escapeHtml(s.portalUrl)}" target="_blank" style="display:inline-block; padding:7px 10px; border-radius:6px; border:1px solid #E4E4EC; background:#FFFFFF; ${FONT}; font-size:11.5px; font-weight:600; color:#020040; text-decoration:none; white-space:nowrap;">Open →</a>
            </td>
          </tr>
        </table>
      </td></tr>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(`${n} job${n === 1 ? "" : "s"} ${dayWord} · first arrival ${data.firstArrivalLabel}`)}
${partnerEmailOuterTableOpen()}
${partnerEmailLogoHeaderRow()}

      <tr><td style="padding:34px 40px 6px 40px;" class="px-mobile">
        ${partnerEmailGreetingH1Html(escapeHtml(data.partnerFirstName || "there"), { marginBottom: "10px" })}
        <p style="margin:0; ${FONT}; font-size:15px; line-height:23px; color:#3A3A55;">Here's your day for <strong style="color:#0A0A1F;">${dayWord}, ${escapeHtml(data.dateLabel)}</strong> — ${n} job${n === 1 ? "" : "s"} lined up, ${data.showRoute ? "in driving order from home" : "in arrival order"}.</p>
      </td></tr>

      ${data.correctionNote ? `<tr><td style="padding:10px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF3C7; border:1px solid #FDE68A; border-radius:8px;">
          <tr><td style="padding:10px 14px;"><p style="margin:0; ${FONT}; font-size:12.5px; line-height:19px; color:#92400E;">⚠️ ${escapeHtml(data.correctionNote)}</p></td></tr>
        </table>
      </td></tr>` : ""}

      <tr><td style="padding:14px 40px 4px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#020040; border-radius:10px;">
          <tr>
${stats}
          </tr>
        </table>
      </td></tr>

${temSlots ? "" : `      <tr><td style="padding:10px 40px 0 40px;" class="px-mobile">
        <p style="margin:0; ${FONT}; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">${data.showRoute ? "🏠 Leaving from home · route in order" : "Tomorrow's jobs · in arrival order"}</p>
      </td></tr>`}

${cards}

      <tr><td align="center" style="padding:22px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-mobile">
          <tr><td align="center" style="border-radius:8px; background-color:#ED4B00;">
            <a href="${escapeHtml(data.portalUrl)}" target="_blank" style="display:inline-block; padding:15px 34px; ${FONT}; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Open my day in Fixfy Trade</a>
          </td></tr>
        </table>
        <p style="margin:10px 0 0 0; ${FONT}; font-size:12px; line-height:18px; color:#6B6B85;">Anything changed? Reply to this email and we'll sort it before tomorrow.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:20px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; ${FONT}; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:${escapeHtml(supportEmail)}" style="color:#6B6B85;">${escapeHtml(supportEmail)}</a> · ${escapeHtml(supportPhone)}</p>
      </td></tr>
${partnerEmailOuterTableClose()}
</body></html>`;

  const text = `Hi ${data.partnerFirstName || "there"},
${data.correctionNote ? `\n${data.correctionNote}\n` : ""}
Your day for ${dayWord}, ${data.dateLabel} — ${n} job${n === 1 ? "" : "s"}${data.showRoute ? ", in driving order from home" : ", in arrival order"}.
${data.earningsLabel}: ${data.earningsDisplay} · First arrival ${data.firstArrivalLabel}

${data.stops
  .map((s, i) => {
    const slotHeader =
      temSlots && s.slot != null && data.stops[i - 1]?.slot !== s.slot
        ? `${s.slot === "morning" ? "MORNING SLOT" : "AFTERNOON SLOT"}\n`
        : "";
    return `${slotHeader}${i + 1}. ${s.windowLabel} · ${s.title}\n   ${s.address}\n   ${s.clientFirstName ? `${s.clientFirstName} · ` : ""}${s.payDisplay}${data.showRoute && s.drive && s.drive.durationSec > 0 ? `\n   (${formatDuration(s.drive.durationSec)} drive to get here)` : ""}`;
  })
  .join("\n\n")}

Open your day: ${data.portalUrl}

Anything changed? Reply to this email. ${supportEmail} · ${supportPhone}`;

  return { subject, html, text };
}
