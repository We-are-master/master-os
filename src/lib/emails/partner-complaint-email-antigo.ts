/**
 * O e-mail de reclamação ao parceiro EXATAMENTE como era até 19/10/2026 (commit
 * 68a40bcf^, ramo de reclamação do antigo `buildPartnerJobOnHoldEmail`), a
 * pedido do dono (23/10/2026: "volta exatamente o antigo"). Copiado palavra por
 * palavra. Só duas diferenças: a largura fluida (máximo 600px, encolhe no
 * celular em vez de cortar) e nenhum travessão (regra da casa: " · " ou ":").
 */
import {
  partnerEmailBaseStyles,
  partnerEmailBodyOpen,
  partnerEmailHeadBlock,
  partnerEmailLogoHeaderRow,
  partnerEmailPreheaderHtml,
  partnerEmailSplitTitleHtml,
} from "./partner-email-layout";

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function telHref(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/** Travessão vira " · " (com espaços) ou "-" (colado), como no resto dos e-mails. */
function semTravessao(s: string): string {
  return s.replace(/\s+[—–]\s+/g, " · ").replace(/[—–]/g, "-");
}

function partnerJobOnHoldJobCardHtml(safe: {
  ref: string;
  title: string;
  address: string;
  pillLabel: string;
  pillBg: string;
  pillColor: string;
  reason?: string;
}): string {
  // O que o cliente reclamou mora dentro do card do job (dono, 23/10/2026).
  const reclamacao = safe.reason
    ? `
            <div style="margin-top:16px; padding-top:16px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">What the customer reported</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#0A0A1F; white-space:pre-wrap;">${safe.reason}</p>
            </div>`
    : "";
  return `      <tr><td style="padding:0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr><td style="padding:24px;">
            <p style="margin:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Job #${safe.ref}</p>
            <p style="margin:0 0 16px 0; font-size:18px; font-weight:600; color:#0A0A1F;">${safe.title}</p>
            <div style="display:inline-block; background-color:${safe.pillBg}; color:${safe.pillColor}; padding:6px 12px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">${safe.pillLabel}</div>
            <div style="margin-top:18px; padding-top:18px; border-top:1px solid #E4E4EC;">
              <p style="margin:0 0 4px 0; font-size:13px; color:#6B6B85;">Location</p>
              <p style="margin:0; font-size:14px; line-height:21px; color:#3A3A55;">${safe.address}</p>
            </div>${reclamacao}
          </td></tr>
        </table>
      </td></tr>`;
}

function partnerJobOnHoldFooterHtml(safe: {
  resolveUrl?: string;
  showResolveLink: boolean;
  support: string;
  supportTel: string;
  supportTelHref: string;
}): string {
  const linkBlock = safe.showResolveLink
    ? `<p style="margin:0 0 8px 0; font-size:12px; line-height:18px; color:#9A9AAE; word-break:break-all;">Button not working? Paste this link into your browser:<br/><a href="${safe.resolveUrl}" style="color:#ED4B00;">${safe.resolveUrl}</a></p>`
    : "";
  return `      <tr><td align="center" style="padding:32px 40px 32px 40px;" class="px-mobile">
        ${linkBlock}
        <p style="margin:0; font-size:13px; line-height:20px; color:#6B6B85;">Need to talk this through? Message us on <a href="https://wa.me/442045384668" style="color:#ED4B00; font-weight:600;">WhatsApp</a> or email <a href="mailto:${safe.support}" style="color:#ED4B00;">${safe.support}</a>.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:24px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0 0 10px 0; font-size:12px; line-height:18px; color:#6B6B85;">You're receiving this email because you're registered as a partner with Fixfy.</p>
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:${safe.support}" style="color:#6B6B85;">${safe.support}</a></p>
      </td></tr>`;
}

export function buildPartnerComplaintEmailAntigo(data: {
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  resolveUrl: string;
  complaintReason?: string | null;
  supportEmail?: string;
  supportPhone?: string;
}): { html: string; text: string } {
  const supportEmail = data.supportEmail ?? "support@getfixfy.com";
  const supportPhone = data.supportPhone ?? "+44 20 4538 4668";
  const isComplaint = true;
  const rawReason = (data.complaintReason ?? "").trim();
  const showReason =
    isComplaint && rawReason.length > 0 && !/^customer complaint/i.test(rawReason);

  const safe = {
    name:           escapeHtml(data.partnerFirstName || "there"),
    ref:            escapeHtml(data.jobReference),
    title:          escapeHtml(data.jobTitle),
    address:        escapeHtml(data.propertyAddress || "—"),
    resolveUrl:     escapeHtml(data.resolveUrl),
    reason:         escapeHtml(rawReason),
    support:        escapeHtml(supportEmail),
    supportTel:     escapeHtml(supportPhone),
    supportTelHref: telHref(supportPhone),
  };

  const jobCard = partnerJobOnHoldJobCardHtml({
    ref: safe.ref,
    title: safe.title,
    address: safe.address,
    pillLabel: isComplaint ? "⏸ On hold" : "⏸ Awaiting next stage",
    pillBg: isComplaint ? "#FBEFD6" : "#E8F4FD",
    pillColor: isComplaint ? "#C47A00" : "#0B5FFF",
    reason: showReason ? safe.reason : undefined,
  });

  const reasonBlockHtml = "";

  const footer = partnerJobOnHoldFooterHtml({
    resolveUrl: safe.resolveUrl,
    showResolveLink: isComplaint,
    support: safe.support,
    supportTel: safe.supportTel,
    supportTelHref: safe.supportTelHref,
  });

  let bodyMiddle: string;
  let preheader: string;
  let text: string;

  {
    preheader = `Job ${safe.ref}: complaint raised. Please reply within 12 hours.`;
    bodyMiddle = `
      <tr><td bgcolor="#C8102E" style="background-color:#C8102E; padding:10px 40px; text-align:center;" class="px-mobile">
        <p style="margin:0; font-size:12px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase; color:#FFFFFF;">⚠ Action required · reply within 12 hours</p>
      </td></tr>

${partnerEmailLogoHeaderRow("26px 40px", true)}

      <tr><td style="padding:40px 40px 24px 40px;" class="px-mobile">
        ${partnerEmailSplitTitleHtml(
          safe.name,
          "A complaint was raised on this job. We need your help to resolve it.",
        )}
        <p style="margin:0 0 16px 0; font-size:16px; line-height:24px; color:#3A3A55;">A complaint has come in about the job below, so we've placed it on hold while we look into it. We've committed to the customer that we'll resolve this within 24 hours, so we'll need your reply with the evidence below within <strong style="color:#0A0A1F;">12 hours</strong>.</p>
      </td></tr>
${jobCard}
${reasonBlockHtml}
      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBE3E7; border-left:3px solid #C8102E; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-size:13px; line-height:20px; color:#7A0A1E;"><strong style="color:#C8102E;">💰 Payment on hold until resolved.</strong> Your payment for this job is paused until we receive the evidence and close the case.</p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:24px 40px 0 40px;" class="px-mobile">
        <p style="margin:0 0 12px 0; font-size:15px; font-weight:700; color:#0A0A1F;">What we need from you</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBEFD6; border-left:3px solid #C47A00; border-radius:6px;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 10px 0; font-size:14px; line-height:21px; color:#0A0A1F;">Tap the button below and reply in the complaint journal with:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;"><strong>A short written summary</strong> of what was done and how you can resolve the issue</td></tr>
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;"><strong>Photos</strong> of the work area / completed work</td></tr>
              <tr><td valign="top" width="20" style="padding:4px 0; font-size:14px; color:#C47A00; font-weight:700;">•</td><td valign="top" style="padding:4px 0; font-size:14px; line-height:21px; color:#0A0A1F;">Anything relevant: <strong>receipts</strong> for materials, <strong>certificates</strong> (CP12, electrical), etc.</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <tr><td align="center" style="padding:28px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr><td align="center" style="border-radius:10px; background-color:#ED4B00; background-image:linear-gradient(135deg,#ED4B00 0%,#FF7A29 100%);">
            <a href="${safe.resolveUrl}" target="_blank" style="display:inline-block; padding:16px 40px; font-size:16px; font-weight:700; color:#FFFFFF; text-decoration:none; letter-spacing:0.2px; border-radius:10px;">Reply in the journal</a>
          </td></tr>
        </table>
        <p style="margin:14px 0 0 0; font-size:12px; line-height:18px; color:#6B6B85;">Opens your partner portal already signed in, on this job. Write what happened and add photos.</p>
      </td></tr>

      <tr><td style="padding:16px 40px 0 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E1ECFF; border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0; font-size:13px; line-height:20px; color:#0A3A8C;"><strong style="color:#0B5FFF;">⏱ Please respond within 12 hours</strong> so we can resolve this for the customer in time.</p>
          </td></tr>
        </table>
      </td></tr>
${footer}`;

    text =
`ACTION REQUIRED · REPLY WITHIN 12 HOURS

Hi ${data.partnerFirstName || "there"},

A complaint was raised on this job. We need your help to resolve it.

Job #${data.jobReference} · ${data.jobTitle}
Location: ${data.propertyAddress || "—"}
${showReason ? `\nWhat the customer reported:\n${rawReason}\n` : ""}
Payment on hold until resolved.

Reply in the complaint journal (opens your partner portal, already signed in):
${data.resolveUrl}

Please respond within 12 hours.

Need to talk this through? Message us on WhatsApp (https://wa.me/442045384668) or email ${supportEmail}.

Fixfy · www.getfixfy.com`;
  }

  // Única mudança de desenho: a caixa de 600px fixos vira fluida (máximo 600px).
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${partnerEmailHeadBlock()}
${partnerEmailBaseStyles()}
</head>
${partnerEmailBodyOpen()}
${partnerEmailPreheaderHtml(preheader)}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="#F7F7FB" style="background-color:#F7F7FB;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" class="container email-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%; max-width:600px; background-color:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">
${bodyMiddle}
    </table>
  </td></tr>
</table>
</body></html>`;

  return { html: semTravessao(html), text: semTravessao(text) };
}
