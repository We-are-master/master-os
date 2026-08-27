// Desenho do email diário "seus jobs de amanhã" — estrutura com a marca real.
import { readFileSync, writeFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}
import("../../src/lib/emails/partner-email-layout").then((L) => {
  const stops = [
    { n: 1, window: "8:00 AM – 12:00 PM", title: "General Maintenance", client: "Claire", address: "28 Kingsmead Avenue, Surbiton KT6 7PP", pay: "Fixed · £51.90", drive: null as string | null },
    { n: 2, window: "12:00 PM – 4:00 PM", title: "General Maintenance", client: "David", address: "Flat 2, 121 New Road, Whitechapel E1 1AL", pay: "Hourly · £40.00/hr", drive: "35 min drive · 5.4 mi" },
    { n: 3, window: "2:00 PM – 6:00 PM", title: "Deep Clean", client: "Natasha", address: "117 Coleman Road, SE5 7TF", pay: "Half day · £75.00", drive: "39 min drive · 5.9 mi" },
  ];
  const portal = "https://partners.getfixfy.com";
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const stopCards = stops.map((s) => `
      <tr><td style="padding:6px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB; border:1px solid #E4E4EC; border-radius:10px;">
          <tr>
            <td width="46" valign="top" style="padding:14px 0 14px 14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" style="width:26px; height:26px; border-radius:999px; background-color:#020040; ${font}; font-size:13px; font-weight:700; color:#FFFFFF;">${s.n}</td>
              </tr></table>
            </td>
            <td valign="top" style="padding:12px 14px 12px 10px;">
              <p style="margin:0; ${font}; font-size:11px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; color:#ED4B00;">${s.window}</p>
              <p style="margin:3px 0 2px 0; ${font}; font-size:15px; font-weight:600; color:#0A0A1F;">${s.title}</p>
              <p style="margin:0; ${font}; font-size:12.5px; line-height:19px; color:#3A3A55;">📍 ${s.address}</p>
              <p style="margin:2px 0 0 0; ${font}; font-size:12.5px; color:#3A3A55;">${s.client} · <strong style="color:#0A0A1F;">${s.pay}</strong></p>
            </td>
            <td width="86" valign="middle" align="right" style="padding-right:14px;">
              <a href="${portal}" target="_blank" style="display:inline-block; padding:7px 10px; border-radius:6px; border:1px solid #E4E4EC; background:#FFFFFF; ${font}; font-size:11.5px; font-weight:600; color:#020040; text-decoration:none; white-space:nowrap;">Open →</a>
            </td>
          </tr>
        </table>
      </td></tr>`).join("\n");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en-GB"><head>
${L.partnerEmailHeadBlock()}
${L.partnerEmailBaseStyles()}
</head>
${L.partnerEmailBodyOpen()}
${L.partnerEmailPreheaderHtml("3 jobs tomorrow · first arrival 8:00 AM")}
${L.partnerEmailOuterTableOpen()}
${L.partnerEmailLogoHeaderRow()}

      <tr><td style="padding:34px 40px 6px 40px;" class="px-mobile">
        ${L.partnerEmailGreetingH1Html("Guilherme", { marginBottom: "10px" })}
        <p style="margin:0; ${font}; font-size:15px; line-height:23px; color:#3A3A55;">Here's your day for <strong style="color:#0A0A1F;">tomorrow, Tuesday 26 August</strong> — 3 jobs lined up, in arrival order.</p>
      </td></tr>

      <tr><td style="padding:14px 40px 4px 40px;" class="px-mobile">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#020040; border-radius:10px;">
          <tr>
            <td align="center" style="padding:12px 6px;"><p style="margin:0; ${font}; font-size:17px; font-weight:700; color:#FFFFFF;">3</p><p style="margin:1px 0 0 0; ${font}; font-size:10px; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.65);">Jobs</p></td>
            <td align="center" style="padding:12px 6px; border-left:1px solid rgba(255,255,255,0.14);"><p style="margin:0; ${font}; font-size:17px; font-weight:700; color:#FFFFFF;">8:00 AM</p><p style="margin:1px 0 0 0; ${font}; font-size:10px; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.65);">First arrival</p></td>
            <td align="center" style="padding:12px 6px; border-left:1px solid rgba(255,255,255,0.14);"><p style="margin:0; ${font}; font-size:17px; font-weight:700; color:#ED4B00;">£166.90+</p><p style="margin:1px 0 0 0; ${font}; font-size:10px; letter-spacing:0.5px; text-transform:uppercase; color:rgba(255,255,255,0.65);">Potential earnings</p></td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:10px 40px 0 40px;" class="px-mobile">
        <p style="margin:0; ${font}; font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#6B6B85;">Tomorrow's jobs · in arrival order</p>
      </td></tr>

${stopCards}

      <tr><td align="center" style="padding:22px 40px 8px 40px;" class="px-mobile">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-mobile">
          <tr><td align="center" style="border-radius:8px; background-color:#ED4B00;">
            <a href="${portal}" target="_blank" style="display:inline-block; padding:15px 34px; ${font}; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Open my day in Fixfy Trade</a>
          </td></tr>
        </table>
        <p style="margin:10px 0 0 0; ${font}; font-size:12px; line-height:18px; color:#6B6B85;">Anything changed? Reply to this email and we'll sort it before tomorrow.</p>
      </td></tr>

      <tr><td style="background-color:#F7F7FB; padding:20px 40px; border-top:1px solid #E4E4EC;" class="px-mobile">
        <p style="margin:0; ${font}; font-size:12px; line-height:18px; color:#6B6B85;"><strong style="color:#3A3A55;">Fixfy</strong> · <a href="https://www.getfixfy.com" style="color:#6B6B85;">www.getfixfy.com</a> · <a href="mailto:support@getfixfy.com" style="color:#6B6B85;">support@getfixfy.com</a> · +44 20 4538 4668</p>
      </td></tr>
${L.partnerEmailOuterTableClose()}
</body></html>`;
  const out = "/private/tmp/claude-501/-Users-victorsouza-master-os/b7112ea9-d321-4dab-879d-e048bc955190/scratchpad/email-tomorrow-partner-company.html";
  writeFileSync(out, html);
  console.log("ok:", out);
});
