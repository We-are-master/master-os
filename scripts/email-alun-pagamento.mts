/**
 * Email de cobrança do job do Alun (19/09, consumer unit + 2 circuitos novos).
 *
 *   npx tsx scripts/email-alun-pagamento.mts                      # ensaio: só escreve o HTML
 *   npx tsx scripts/email-alun-pagamento.mts --para=x@y.com       # teste, manda pra quem você disser
 *   npx tsx scripts/email-alun-pagamento.mts --enviar             # manda PRO ALUN de verdade
 *
 * Nasce em ensaio, como toda porta que fala com cliente de verdade.
 * Não é o job confirmation: aquele é o WhatsApp do agendamento. Este é o
 * pedido de pagamento por transferência, com os dados da GETFIXFY LTD.
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
    }
  } catch { /* ok */ }
}

const [{ renderClientEmail, clientP, CLIENT_BRAND, escapeHtml }, { FIXFY_CLIENT_BANK_DETAILS }] =
  await Promise.all([
    import("../src/lib/emails/client-email-layout"),
    import("../src/lib/fixfy-client-bank-details"),
  ]);

const ALUN = "alunmcneilwatson@yahoo.com";
const destinoArg = process.argv.find((a) => a.startsWith("--para="))?.slice(7)?.trim() ?? null;
const ENVIAR_AO_ALUN = process.argv.includes("--enviar");
const destino = ENVIAR_AO_ALUN ? ALUN : destinoArg;

const B = CLIENT_BRAND;

/** Linha de dado: rótulo cinza à esquerda, valor forte à direita. Empilha no mobile. */
function linha(rotulo: string, valor: string, forte = false): string {
  return `<tr>
    <td style="padding:12px 0; border-bottom:1px solid ${B.line};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:13px; line-height:18px; color:${B.gray};">${escapeHtml(rotulo)}</td>
          <td align="right" style="font-size:${forte ? "18" : "15"}px; line-height:24px; color:${forte ? B.navy : B.ink}; font-weight:${forte ? "700" : "600"}; padding-left:12px;">${valor}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/** Dado longo (endereço): rótulo em cima, valor embaixo. Lado a lado quebra feio no celular. */
function linhaEmpilhada(rotulo: string, valor: string): string {
  return `<tr>
    <td style="padding:12px 0; border-bottom:1px solid ${B.line};">
      <div style="font-size:13px; line-height:18px; color:${B.gray};">${escapeHtml(rotulo)}</div>
      <div style="font-size:15px; line-height:22px; color:${B.ink}; font-weight:600; padding-top:3px;">${escapeHtml(valor)}</div>
    </td>
  </tr>`;
}

/** Bloco dos dados bancários: fundo escuro, número grande, fácil de copiar no celular. */
function blocoBanco(): string {
  const item = (rotulo: string, valor: string) => `<tr>
    <td style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.12);">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:12px; line-height:18px; color:rgba(255,255,255,0.62); text-transform:uppercase; letter-spacing:0.6px;">${escapeHtml(rotulo)}</td>
          <td align="right" style="font-size:17px; line-height:24px; color:#FFFFFF; font-weight:700; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; padding-left:12px;">${escapeHtml(valor)}</td>
        </tr>
      </table>
    </td>
  </tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px; background:${B.navy}; border-radius:12px;">
    <tr><td style="padding:22px 22px 16px;">
      <p style="margin:0 0 4px; font-size:12px; line-height:18px; color:rgba(255,255,255,0.62); text-transform:uppercase; letter-spacing:1px; font-weight:700;">Pay by bank transfer</p>
      <p style="margin:0 0 14px; font-size:30px; line-height:38px; color:#FFFFFF; font-weight:800; letter-spacing:-0.8px;">&pound;2,075.00</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${item("Account name", FIXFY_CLIENT_BANK_DETAILS.accountName)}
        ${item("Sort code", FIXFY_CLIENT_BANK_DETAILS.sortCode)}
        ${item("Account no.", FIXFY_CLIENT_BANK_DETAILS.accountNumber)}
        <tr>
          <td style="padding:10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:12px; line-height:18px; color:rgba(255,255,255,0.62); text-transform:uppercase; letter-spacing:0.6px;">Reference</td>
                <td align="right" style="font-size:17px; line-height:24px; color:${B.orange}; font-weight:700; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; padding-left:12px;">MCNEIL-WATSON</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

const bodyHtml = [
  clientP("Thanks for confirming. Here is everything for Saturday, with the payment details at the bottom."),

  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px; border-top:1px solid ${B.line};">
    ${linha("Booking date", "Saturday 19 September")}
    ${linhaEmpilhada("Address", "31 Ardleigh Road, London E17 5BU")}
    ${linha("Work", "Consumer unit replacement")}
    ${linha("Total", "&pound;2,075.00", true)}
  </table>`,

  `<p style="margin:0 0 10px; font-size:13px; line-height:18px; color:${B.gray}; text-transform:uppercase; letter-spacing:1px; font-weight:700;">What we will do</p>`,
  clientP("Replace the existing fuse box and add the two new circuits to it, giving you two extra sockets."),
  clientP(`We recommended this option because the current fuse box is extremely old and only just passed the EICR. Replacing it is the safer and more suitable solution, rather than adding new circuits to a unit that is already at the end of its life.`),
  clientP(`The <strong style="color:${B.ink};">&pound;2,075.00</strong> is the total cost, including VAT and all materials. There is nothing further to pay on the day.`),

  blocoBanco(),

  clientP(`Please use <strong style="color:${B.ink};">MCNEIL-WATSON</strong> as the payment reference so we can match it to your booking straight away. If anything about Saturday needs to change, just reply to this email.`),
].join("\n");

const html = renderClientEmail({
  preheader: "Saturday 19 September. Consumer unit replacement plus two new circuits. £2,075.00 inc. VAT and materials.",
  heading: "Your booking on Saturday 19 September",
  name: "Alun",
  bodyHtml,
  footerNote: "GETFIXFY LTD. This email confirms the agreed price for the work booked above.",
});

const subject = "Your Fixfy booking on Saturday 19 September · £2,075.00";
const saida = "scratchpad/email-alun.html";
writeFileSync(saida, html);
console.log(`HTML escrito em ${saida} (${html.length} bytes)`);
console.log(`Assunto: ${subject}`);

if (!destino) {
  console.log("\nEnsaio. Nada enviado. Use --para=voce@dominio.com para testar, --enviar para mandar ao Alun.");
  process.exit(0);
}

const REGISTRO = "scripts/.alun-pagamento-sent.json";
type Registro = Record<string, string>;
const jaEnviados: Registro = (() => {
  try { return JSON.parse(readFileSync(REGISTRO, "utf8")) as Registro; } catch { return {}; }
})();
const FORCAR = process.argv.includes("--forcar");
if (jaEnviados[destino] && !FORCAR) {
  console.error(`JÁ ENVIADO para ${destino} em ${jaEnviados[destino]}.`);
  console.error("Nada foi mandado. Use --forcar se for mesmo para reenviar.");
  process.exit(1);
}

const { Resend } = await import("resend");
const resend = new Resend(process.env.RESEND_API_KEY!);
const { data, error } = await resend.emails.send({
  from: process.env.RESEND_FROM_EMAIL || "Fixfy <noreply@getfixfy.com>",
  to: destino,
  replyTo: "hello@getfixfy.com",
  subject,
  html,
});
if (error) {
  console.error("FALHOU:", error);
  process.exit(1);
}
jaEnviados[destino] = new Date().toISOString();
writeFileSync(REGISTRO, JSON.stringify(jaEnviados, null, 2));
console.log(`Enviado para ${destino}. id=${data?.id}`);
