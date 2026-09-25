/**
 * Os três e-mails de quem começou a reservar no site e não pagou.
 *
 *   1  30 minutos depois   "o seu preço está guardado"
 *   2  4 horas depois do 1 "alguma dúvida?", com o que está incluso
 *      (limpeza fala de cômodo e checklist; conserto fala do trabalho feito)
 *   3  dia seguinte, 10h   10% com código único já aplicado, 48 horas
 *
 * Texto aprovado pelo dono em 24/09/2026. Parente das campanhas
 * (`campanha-layout`), com cabeçalho branco e logo pequeno, laranja só no botão, tudo em
 * tabela e estilo em linha. Os ícones do e-mail 2 são PNG em
 * `public/email/abandono/`, porque o Gmail não mostra SVG.
 *
 * Quem decide QUANDO cada um sai é `agendaDoAbandono`; quem decide SE sai
 * (pagou, descadastrou, conversa aberta com o time) é o motor, na hora do envio.
 */

import { appBaseUrl } from "@/lib/app-base-url";
import { CLIENT_BRAND, escapeHtml } from "@/lib/emails/client-email-layout";

const WHATSAPP_GREEN = "#1FA855";
const EMPRESA = "Getfixfy Ltd · 124 City Road, London EC1V 2NX";

/**
 * Cabeçalho navy em degradê (com um brilho laranja no canto) e logo branco
 * pequeno, alinhado ao texto: a faixa de 600px das campanhas gritava demais.
 * `public/email/abandono/fixfy-logo-white.png` (420x149) vem do
 * `fixfy-primary-white` do site, o de engrenagem limpa. Mostrado em 130px,
 * nítido em tela retina. O Outlook ignora o degradê e mostra o navy liso.
 */
const LOGO_LARGURA = 130;
const LOGO_ALTURA = Math.round((149 / 420) * LOGO_LARGURA);

export type ReservaAbandonada = {
  firstName?: string | null;
  service: {
    /** "2 bed deep clean", "handyman half day". Vai no meio da frase. */
    name: string;
    /** "a 2 bed deep clean". Vai no assunto do e-mail 1. */
    withArticle: string;
  };
  /**
   * Limpeza fala de cômodo e checklist; conserto, pintura e certificado não.
   * O e-mail 2 muda as promessas conforme isso. Padrão: limpeza.
   */
  kind?: "cleaning" | "trade";
  /** Linhas curtas do cartão da reserva: "2 bedrooms", "Up to 3.5 hours". */
  details?: string[];
  postcode?: string | null;
  /** Em libras, com VAT. */
  price: number;
  /** Reabre o mesmo serviço, tamanho e postcode. */
  resumeUrl: string;
  whatsappUrl: string;
  unsubscribeUrl: string;
  /** Só no e-mail 3. */
  /**
   * Só no e-mail 3. Com `expiresAt` é o código ÚNICO da pessoa (48 h, uso
   * único); sem ele é o cupom FIXO da Stripe (COMEBACK10), que não expira por
   * pessoa, então o e-mail não promete prazo nem "personal" (DMCC: prazo falso
   * é prática enganosa).
   */
  promo?: { code: string; percentOff: number; discountedPrice: number; expiresAt?: Date | null };
  /** Base dos ícones e do logo. Padrão: o próprio OS. */
  assetBase?: string;
};

export type EmailPronto = { subject: string; preheader: string; html: string; text: string };

export function formatarLibras(v: number): string {
  const inteiro = Math.round(v * 100) % 100 === 0;
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: inteiro ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "Saturday 26 September at 10:00", no horário de Londres. */
export function formatarValidade(d: Date): string {
  const dia = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(d);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${dia} at ${hora}`;
}

// ---------------------------------------------------------------- horários

const JANELA_INICIO = 8;
const JANELA_FIM = 20;

/** Hora e data de Londres de um instante. */
function partesLondres(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, minuto: +p.minute };
}

/** O instante de uma hora cheia de Londres num dia de Londres (lida com o horário de verão). */
function londres(ano: number, mes: number, dia: number, hora: number): Date {
  const palpite = new Date(Date.UTC(ano, mes - 1, dia, hora));
  const visto = partesLondres(palpite);
  const diferencaHoras = visto.hora - hora + (visto.dia !== dia ? (visto.dia > dia ? 24 : -24) : 0);
  return new Date(palpite.getTime() - diferencaHoras * 3_600_000);
}

function diaSeguinte(d: Date, hora: number): Date {
  const p = partesLondres(d);
  const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
  return londres(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), hora);
}

/** Fora das 8h às 20h de Londres, empurra para as 8h (do mesmo dia ou do seguinte). */
function dentroDaJanela(d: Date): Date {
  const p = partesLondres(d);
  if (p.hora >= JANELA_INICIO && p.hora < JANELA_FIM) return d;
  if (p.hora < JANELA_INICIO) return londres(p.ano, p.mes, p.dia, JANELA_INICIO);
  return diaSeguinte(d, JANELA_INICIO);
}

/**
 * Quando cada e-mail sai, a partir do momento em que a pessoa parou.
 *
 * 1: 30 minutos depois (fora da janela, 8h). 2: 4 horas depois do 1; passou
 * das 20h, vai para as 8h do dia seguinte. 3: 10h do dia seguinte ao do
 * e-mail 2, então quando o 2 atrasa o 3 atrasa junto e os dois nunca chegam
 * com duas horas de diferença.
 */
export function agendaDoAbandono(parouEm: Date): { email1: Date; email2: Date; email3: Date } {
  const email1 = dentroDaJanela(new Date(parouEm.getTime() + 30 * 60_000));
  const email2 = dentroDaJanela(new Date(email1.getTime() + 4 * 3_600_000));
  const email3 = diaSeguinte(email2, 10);
  return { email1, email2, email3 };
}

// ---------------------------------------------------------------- peças

function preheaderOculto(texto: string): string {
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${CLIENT_BRAND.canvas}; opacity:0;">${escapeHtml(texto)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>`;
}

function p(html: string, extra = ""): string {
  return `<p style="margin:0 0 16px; font-size:16px; line-height:26px; color:${CLIENT_BRAND.body};${extra}">${html}</p>`;
}

function cartaoDaReserva(d: ReservaAbandonada, comDesconto: boolean): string {
  const linhas = [...(d.details ?? []), d.postcode ? d.postcode.toUpperCase() : null].filter(Boolean) as string[];
  const preco = comDesconto && d.promo
    ? `<div style="font-size:14px; line-height:20px; color:${CLIENT_BRAND.gray}; text-decoration:line-through;">${formatarLibras(d.price)}</div>
       <div style="font-size:26px; line-height:32px; font-weight:800; color:${CLIENT_BRAND.navy};">${formatarLibras(d.promo.discountedPrice)}</div>
       <div style="font-size:12px; line-height:18px; font-weight:700; color:${CLIENT_BRAND.orange};">${d.promo.percentOff}% off applied</div>`
    : `<div style="font-size:26px; line-height:32px; font-weight:800; color:${CLIENT_BRAND.navy};">${formatarLibras(d.price)}</div>
       <div style="font-size:12px; line-height:18px; color:${CLIENT_BRAND.gray};">Fixed price, VAT included</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px; background:${CLIENT_BRAND.canvas}; border:1px solid ${CLIENT_BRAND.line}; border-radius:12px;">
    <tr>
      <td valign="middle" style="padding:18px 20px;">
        <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700; color:${CLIENT_BRAND.gray}; margin-bottom:4px;">Your saved booking</div>
        <div style="font-size:17px; line-height:24px; font-weight:700; color:${CLIENT_BRAND.navy}; text-transform:capitalize;">${escapeHtml(d.service.name)}</div>
        ${linhas.length ? `<div style="font-size:14px; line-height:21px; color:${CLIENT_BRAND.body}; margin-top:2px;">${linhas.map(escapeHtml).join(" &middot; ")}</div>` : ""}
      </td>
      <td valign="middle" align="right" style="padding:18px 20px; white-space:nowrap;">${preco}</td>
    </tr>
  </table>`;
}

function botao(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 26px;">
    <tr><td class="btn-mobile" style="border-radius:10px; background:${CLIENT_BRAND.orange};">
      <a href="${escapeHtml(url)}" style="display:inline-block; padding:16px 34px; font-size:16px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">${escapeHtml(texto)}</a>
    </td></tr>
  </table>`;
}

function blocoWhatsApp(pergunta: string, url: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px; border-top:1px solid ${CLIENT_BRAND.line};">
    <tr><td style="padding:22px 0 0;">
      <p style="margin:0 0 12px; font-size:15px; line-height:22px; color:${CLIENT_BRAND.ink}; font-weight:600;">${escapeHtml(pergunta)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="btn-mobile" style="border-radius:10px; border:1.5px solid ${WHATSAPP_GREEN};">
          <a href="${escapeHtml(url)}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:700; color:${WHATSAPP_GREEN}; text-decoration:none; border-radius:10px;">Chat with us on WhatsApp</a>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

function listaComIcones(itens: Array<{ icone: string; texto: string }>, base: string): string {
  const linhas = itens.map((i) => `<tr>
      <td width="52" valign="middle" style="padding:7px 0;"><img src="${base}/email/abandono/${i.icone}.png" width="40" height="40" alt="" style="display:block; width:40px; height:40px; border:0;"></td>
      <td valign="middle" style="padding:7px 0; font-size:15px; line-height:22px; color:${CLIENT_BRAND.ink}; font-weight:600;">${escapeHtml(i.texto)}</td>
    </tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:2px 0 20px;">${linhas}</table>`;
}

function caixaDoCodigo(d: ReservaAbandonada): string {
  if (!d.promo) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px; background:${CLIENT_BRAND.softOrangeBg}; border:2px dashed ${CLIENT_BRAND.orange}; border-radius:12px;">
    <tr><td align="center" style="padding:20px;">
      <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700; color:${CLIENT_BRAND.orange};">${d.promo.expiresAt ? "Your personal code · already applied" : "We've applied code"}</div>
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace; font-size:28px; line-height:36px; font-weight:700; color:${CLIENT_BRAND.navy}; letter-spacing:0.04em; margin:8px 0 4px;">${escapeHtml(d.promo.code)}</div>
      ${d.promo.expiresAt ? `<div style="font-size:13px; line-height:20px; color:${CLIENT_BRAND.body};">Valid until <b>${escapeHtml(formatarValidade(d.promo.expiresAt))}</b></div>` : ""}
    </td></tr>
  </table>`;
}

function montar(opts: { preheader: string; etiqueta: string; titulo: string; nome: string; corpo: string; base: string; unsubscribeUrl: string }): string {
  const logo = `${opts.base}/email/abandono/fixfy-logo-white.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>&#8203;</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${CLIENT_BRAND.canvas} !important; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 22px !important; padding-right: 22px !important; }
    .h1-mobile { font-size: 25px !important; line-height: 32px !important; }
    .btn-mobile, .btn-mobile a { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body bgcolor="${CLIENT_BRAND.canvas}" style="margin:0; padding:0; background-color:${CLIENT_BRAND.canvas}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheaderOculto(opts.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CLIENT_BRAND.canvas}" style="background-color:${CLIENT_BRAND.canvas};">
  <tr><td align="center" style="padding:28px 16px 40px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">
      <tr><td class="px-mobile" bgcolor="${CLIENT_BRAND.navy}" style="padding:30px 40px; background-color:${CLIENT_BRAND.navy}; background-image:radial-gradient(circle at 100% 0%, rgba(237,75,0,0.32) 0%, rgba(237,75,0,0) 42%), linear-gradient(135deg, #020040 0%, #0A0960 58%, #1B1478 100%);">
        <a href="https://www.getfixfy.com" style="text-decoration:none;"><img src="${logo}" alt="Fixfy" width="${LOGO_LARGURA}" height="${LOGO_ALTURA}" style="display:block; width:${LOGO_LARGURA}px; height:${LOGO_ALTURA}px; border:0;"></a>
      </td></tr>
      <tr><td class="px-mobile" style="padding:28px 40px 6px;">
        <div style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:${CLIENT_BRAND.orange}; margin-bottom:12px;">${escapeHtml(opts.etiqueta)}</div>
        <h1 class="h1-mobile" style="margin:0 0 20px; font-size:28px; line-height:35px; font-weight:800; letter-spacing:-0.02em; color:${CLIENT_BRAND.navy};">${escapeHtml(opts.titulo)}</h1>
        ${p(`Hi ${escapeHtml(opts.nome)},`)}
        ${opts.corpo}
        <p style="margin:0 0 30px; font-size:16px; line-height:24px; color:${CLIENT_BRAND.ink}; font-weight:600;">The Fixfy Team</p>
      </td></tr>
    </table>
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
      <tr><td class="px-mobile" align="center" style="padding:22px 40px 0; font-size:12px; line-height:19px; color:${CLIENT_BRAND.gray};">
        You are receiving this because you started a booking at getfixfy.com.<br>
        ${EMPRESA}<br>
        <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${CLIENT_BRAND.gray}; text-decoration:underline;">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function primeiroNome(d: ReservaAbandonada): string {
  const n = d.firstName?.trim().split(/\s+/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "there";
}

function rodapeTexto(d: ReservaAbandonada): string {
  return `\n\nThe Fixfy Team\n\nYou are receiving this because you started a booking at getfixfy.com.\n${EMPRESA}\nUnsubscribe: ${d.unsubscribeUrl}`;
}

// ---------------------------------------------------------------- os três

export function email1(d: ReservaAbandonada): EmailPronto {
  const nome = primeiroNome(d);
  const base = d.assetBase ?? appBaseUrl();
  // Curto de propósito: no celular o assunto corta perto de 40 caracteres. O serviço e o preço vão no preheader.
  const subject = "You're almost there!";
  const preheader = `Finish your booking: ${d.service.name} · ${formatarLibras(d.price)} fixed price`;
  const corpo = [
    p(`We have saved the details of your ${escapeHtml(d.service.name)} booking, so you will not need to start again.`),
    cartaoDaReserva(d, false),
    p(`Your fixed price is <b style="color:${CLIENT_BRAND.navy};">${formatarLibras(d.price)}</b>. There are no hidden charges added at checkout.`),
    p("Your booking has not been confirmed yet, but you can continue from exactly where you stopped."),
    botao("Finish my booking", d.resumeUrl),
    blocoWhatsApp("Have a question before booking?", d.whatsappUrl),
  ].join("");
  const text = `Hi ${nome},

We have saved the details of your ${d.service.name} booking, so you will not need to start again.

Your fixed price is ${formatarLibras(d.price)}. There are no hidden charges added at checkout.

Your booking has not been confirmed yet, but you can continue from exactly where you stopped.

Finish my booking: ${d.resumeUrl}

Have a question before booking? Chat with us on WhatsApp: ${d.whatsappUrl}${rodapeTexto(d)}`;
  return { subject, preheader, text, html: montar({ preheader, etiqueta: "Booking saved", titulo: "Your fixed price is waiting", nome, corpo, base, unsubscribeUrl: d.unsubscribeUrl }) };
}

export function email2(d: ReservaAbandonada): EmailPronto {
  const nome = primeiroNome(d);
  const base = d.assetBase ?? appBaseUrl();
  const subject = "Anything we can help with?";
  const limpeza = (d.kind ?? "cleaning") === "cleaning";
  const preheader = "Clear pricing, report photos, secure payment and a 14-day guarantee.";
  const fotos = limpeza ? "Photos of every room once the service is complete" : "Photos of the finished work once the job is complete";
  const garantia = limpeza
    ? "If anything on the agreed checklist is not completed correctly, let us know within 14 days and we will return to put it right at no additional cost."
    : "If any of the agreed work is not done correctly, let us know within 14 days and we will return to put it right at no additional cost.";
  const itens = [
    { icone: "price", texto: "A clear fixed price, including VAT" },
    { icone: "photos", texto: fotos },
    { icone: "guarantee", texto: "A 14-day Fixfy guarantee" },
    { icone: "secure", texto: "Secure payment through Stripe" },
    { icone: "nohidden", texto: "No hidden charges" },
  ];
  const corpo = [
    p("If you paused because you wanted to check a few details, here is what you can expect from Fixfy:"),
    listaComIcones(itens, base),
    p(garantia),
    p("Your details are still saved, so you can continue without entering everything again."),
    botao("Finish my booking", d.resumeUrl),
    blocoWhatsApp("Would you prefer to speak with someone first?", d.whatsappUrl),
  ].join("");
  const text = `Hi ${nome},

If you paused because you wanted to check a few details, here is what you can expect from Fixfy:

- A clear fixed price, including VAT
- ${fotos}
- A 14-day Fixfy guarantee
- Secure payment through Stripe
- No hidden charges

${garantia}

Your details are still saved, so you can continue without entering everything again.

Finish my booking: ${d.resumeUrl}

Would you prefer to speak with someone first? Chat with us on WhatsApp: ${d.whatsappUrl}${rodapeTexto(d)}`;
  return { subject, preheader, text, html: montar({ preheader, etiqueta: "Before you book", titulo: "Everything included, nothing hidden", nome, corpo, base, unsubscribeUrl: d.unsubscribeUrl }) };
}

export function email3(d: ReservaAbandonada): EmailPronto {
  if (!d.promo) throw new Error("email3 precisa do código de desconto");
  const nome = primeiroNome(d);
  const base = d.assetBase ?? appBaseUrl();
  const pct = d.promo.percentOff;
  const unico = Boolean(d.promo.expiresAt);
  const validade = d.promo.expiresAt ? formatarValidade(d.promo.expiresAt) : "";
  const subject = `Get ${pct}% OFF to finish your booking`;
  // O preço no preheader: é a primeira coisa que aparece na caixa de entrada, antes de abrir.
  const precos = `${formatarLibras(d.price)} is now ${formatarLibras(d.promo.discountedPrice)}`;
  const preheader = unico
    ? `${precos} with your personal code, valid for 48 hours.`
    : `${precos} with code ${d.promo.code}, already applied.`;
  const navy = (t: string) => `<b style="color:${CLIENT_BRAND.navy};">${t}</b>`;
  const frasesDoCodigo = unico
    ? `Your unique code is ${navy(escapeHtml(d.promo.code))}, and it has already been applied to your booking. The discount is valid until ${navy(escapeHtml(validade))}. After that time, the code will expire automatically.`
    : `We've applied code ${navy(escapeHtml(d.promo.code))} to your booking.`;
  const corpo = [
    p(`We have added a ${unico ? "personal " : ""}${navy(`${pct}% discount`)} to your saved ${escapeHtml(d.service.name)} booking.`),
    cartaoDaReserva(d, true),
    p(`Original price: ${formatarLibras(d.price)}<br>Your discounted price: ${navy(formatarLibras(d.promo.discountedPrice))}`),
    caixaDoCodigo(d),
    p(frasesDoCodigo),
    p("Use the button below to continue from where you stopped and confirm your booking with the discount applied."),
    botao(`Finish my booking with ${pct}% off`, d.resumeUrl),
    blocoWhatsApp("Have a question before confirming?", d.whatsappUrl),
  ].join("");
  const text = `Hi ${nome},

We have added a ${unico ? "personal " : ""}${pct}% discount to your saved ${d.service.name} booking.

Original price: ${formatarLibras(d.price)}
Your discounted price: ${formatarLibras(d.promo.discountedPrice)}

${unico ? `Your unique code is ${d.promo.code}, and it has already been applied to your booking.

The discount is valid until ${validade}. After that time, the code will expire automatically.` : `We've applied code ${d.promo.code} to your booking.`}

Finish my booking with ${pct}% off: ${d.resumeUrl}

Have a question before confirming? Chat with us on WhatsApp: ${d.whatsappUrl}${rodapeTexto(d)}`;
  return {
    subject,
    preheader,
    text,
    html: montar({ preheader, etiqueta: unico ? `${pct}% off · 48 hours` : `${pct}% off`, titulo: `${pct}% off, already applied`, nome, corpo, base, unsubscribeUrl: d.unsubscribeUrl }),
  };
}
