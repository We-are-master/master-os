/**
 * A sequência das agências de Londres: três meses, 16 e-mails, pelo Resend.
 *
 *   mês 1        oferta direta, segunda e quinta 8h30: a Fixfy como fornecedor
 *                360 (limpeza, manutenção, certificados), 10% no primeiro job,
 *                pedido de reunião em todo e-mail e os dois PDFs no rodapé.
 *   meses 2 e 3  nutrição, uma por semana, segunda 8h30: um fato útil do
 *                mercado de locação e uma linha de venda no fim.
 *
 * Sai no nome do Victor, com a assinatura dele, e a resposta cai na caixa dele.
 * O visual é de carta, não de newsletter: para quem nunca falou com a gente,
 * e-mail com cara de pessoa é lido e e-mail com cara de campanha vai para a
 * aba de promoções.
 *
 * ── Ondas ──────────────────────────────────────────────────────────────────
 *
 * A lista fria tem 922 contatos (audiência "Fixfy B2B"). Ela não sai inteira:
 * cada onda é um segmento de 200, com quem tem nome de pessoa na frente da
 * caixa geral. Lista fria é onde nasce reclamação de spam, e esta conta do
 * Resend é a mesma que manda fatura e código de cadastro de parceiro.
 *
 * Os preços são os da lista B2B (catálogo menos 5%, `~/fixfy-price-list-b2b`).
 * Os fatos da nutrição vêm da pesquisa verificada de 22/09/2026: mudou a lei ou
 * o número, muda aqui.
 */

import { CLIENT_BRAND, escapeHtml } from "@/lib/emails/client-email-layout";
import { horaDeLondres } from "./calendario";
import { LINK_DE_SAIDA, NOME_DO_CONTATO } from "./clube";
import { agendarBroadcast, broadcasts, criarBroadcast, type BroadcastResend } from "./resend";

export const AUDIENCIA_B2B = "Fixfy B2B";
export const TAMANHO_DA_ONDA = 200;
export const nomeDaOnda = (n: number) => `Fixfy B2B · Wave ${n}`;

export const PDF_O_QUE_FAZEMOS = "https://app.getfixfy.com/r/fixfy-for-business";
export const PDF_PRECOS = "https://app.getfixfy.com/r/fixfy-price-list";
const TELEFONE = "020 4538 4668";

export function remetenteB2B(): { from: string; reply_to: string } {
  return {
    from: process.env.MARKETING_B2B_FROM?.trim() || "Victor Braz <victor@news.getfixfy.com>",
    reply_to: process.env.MARKETING_B2B_REPLY_TO?.trim() || "victor@getfixfy.com",
  };
}

/* ═══════════════════ As peças ═══════════════════ */

type Parte = { p: string } | { ul: string[] } | { ol: string[] };
export type EmailB2B = {
  n: number;
  /** Dia de envio da onda 1. As ondas seguintes andam o mesmo número de dias. */
  dia: string;
  fase: "oferta" | "nutricao";
  key: string;
  assunto: string;
  subtitulo: string;
  corpo: Parte[];
  /** O que o botão diz. O destino é sempre um e-mail pronto para o Victor. */
  botao: string;
};

export const HORA_B2B = { hora: 8, minuto: 30 };

const p = (html: string): Parte => ({ p: html });
const ul = (...itens: string[]): Parte => ({ ul: itens });
const ol = (...itens: string[]): Parte => ({ ol: itens });

const FECHO = "Fixfy covers cleaning, maintenance and compliance for letting agents across London, with one point of contact and one invoice. If that would help, book 15 minutes below.";

export const SEQUENCIA_B2B: EmailB2B[] = [
  {
    n: 1, dia: "2026-10-15", fase: "oferta", key: "offer_360",
    assunto: "Cleaning and maintenance for your whole portfolio, one supplier",
    subtitulo: "Cleaners, tradespeople and certified engineers. One call, one invoice. 10% off the first job.",
    corpo: [
      p("Fixfy is the 360 property partner for London letting agents. Everything a property needs, from one supplier:"),
      ul(
        "<strong>Cleaning.</strong> End of tenancy, deep, after builders and regular cleaning",
        "<strong>Maintenance.</strong> Repairs, plumbing, carpentry and painting",
        "<strong>Compliance.</strong> Gas Safety, EICR and EPC by certified engineers, plus inventory reports",
      ),
      p("You send one message. We send the right professional, report back with photos and send one invoice after the work."),
      p("Fixed prices, VAT included: cleaning from £165, maintenance from £171 for a half day, certificates from £75."),
      p("<strong>Your first job is 10% off.</strong> Give me 15 minutes this week and I will set up your account on the call. Or reply with any job you have open today, cleaning or repair, and we will take it."),
      p("The PDF below shows everything we do."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 2, dia: "2026-10-19", fase: "oferta", key: "hardest_property",
    assunto: "Send me your hardest property this week",
    subtitulo: "A clean, a repair or a certificate. 10% off, photo report, one invoice.",
    corpo: [
      p("I wrote a few days ago. I will be direct: I want to be the supplier you call for everything, and I would rather prove it than describe it."),
      p("So send me the property that is giving you the most trouble this week. The check-out nobody has cleaned, the repair your tenant keeps chasing, the certificate that is about to expire."),
      ol(
        "You send the address and what it needs",
        "We confirm the price in writing the same day",
        "We do the job and send you the photo report",
      ),
      p("No contract and no minimum. That first job is 10% off, and if it is not better than what you have today, you do not use us again."),
      p("Reply with the address, or book 15 minutes below and I will go through the report and the price list with you."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 3, dia: "2026-10-22", fase: "oferta", key: "five_suppliers",
    assunto: "Stop managing five suppliers for one property",
    subtitulo: "Cleaner, handyman, plumber, painter, gas engineer. One number.",
    corpo: [
      p("One property, one year: a cleaner, a handyman, a plumber, a painter and a gas engineer. Five suppliers to find, book, chase and pay."),
      p("With Fixfy it is one:"),
      ul(
        "<strong>One message</strong> for any job, cleaning or maintenance",
        "<strong>One report</strong> with photos when it is done",
        "<strong>One invoice</strong>, after the work",
      ),
      p("That is what 360 means. Your team stops chasing suppliers and your landlords get one standard on every job."),
      p("<strong>10% off your first job.</strong> Book a 15 minute call below and I will open your account on the call."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 4, dia: "2026-10-26", fase: "oferta", key: "tenant_repair",
    assunto: "The repair your tenant reported this morning",
    subtitulo: "Plumbing, carpentry and general repairs. Fixed price, booked today.",
    corpo: [
      p("Maintenance does not wait for the end of a tenancy. A leak, a stuck door or a broken fitting lands in your inbox today and the tenant expects an answer today."),
      p("Send it to us:"),
      ul(
        "<strong>Repairs</strong>: £68 an hour, half day £171, full day £312, tools included. Plumbing and carpentry from £85 an hour",
        "<strong>Painting</strong>: touch-ups £204, a full room £427",
        "<strong>Bigger work</strong>: a fixed written quote after a visit",
      ),
      p("We arrange access with your tenant, do the job and send you the photos."),
      p("Forward me the next repair that comes in. First job 10% off. Or book 15 minutes below and I will show you how it works."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 5, dia: "2026-10-29", fase: "oferta", key: "every_clean",
    assunto: "Every clean a property needs, from one team",
    subtitulo: "End of tenancy, deep, after builders and regular cleaning.",
    corpo: [
      p("Cleaning is where most deposit disputes start and where most suppliers let agents down. We cover all of it:"),
      ul(
        "<strong>End of tenancy</strong>: studio £190, 1 bed £211, 2 bed £252, 3 bed £302",
        "<strong>Deep clean</strong>: from £165",
        "<strong>After builders</strong>: from £193",
        "<strong>Regular cleaning</strong>: from £22 an hour, products and equipment included",
      ),
      p("Photo report on every job. If something is missed, we come back within 14 days and put it right free of charge."),
      p("And when the clean shows a repair is needed, the same team fixes it. That is the point of one supplier."),
      p("<strong>10% off the first job.</strong> Book a 15 minute call below."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 6, dia: "2026-11-02", fase: "oferta", key: "certificates",
    assunto: "Gas Safety £75, EICR from £122, EPC from £90",
    subtitulo: "Certificates booked with the clean and the repairs. One visit plan.",
    corpo: [
      p("Compliance is the third part of what we do, and it is simpler when it is not a separate supplier."),
      ul(
        "Gas Safety certificate: £75",
        "EICR: from £122",
        "EPC: from £90",
        "Inventory check and check-out reports: from £107",
      ),
      p("Accredited engineers and assessors, with the certificate sent to you as soon as it is issued."),
      p("Send me the addresses with certificates due in the next 60 days. I will come back the same day with dates and one price."),
      p("Or book 15 minutes below. First job 10% off."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 7, dia: "2026-11-05", fase: "oferta", key: "price_list",
    assunto: "Here is our full price list. Compare it.",
    subtitulo: "Cleaning, maintenance and certificates. Fixed, VAT included.",
    corpo: [
      p("I would rather you check our prices than take my word for it. The full list is in the PDF below."),
      ul(
        "<strong>Cleaning</strong>: end of tenancy from £190, deep from £165, after builders from £193, regular from £22 an hour",
        "<strong>Maintenance</strong>: from £68 an hour, half day £171, full day £312, painting from £204",
        "<strong>Certificates</strong>: Gas Safety £75, EICR from £122, EPC from £90",
      ),
      p("Every job is confirmed in writing, with the price, before anyone attends. If something is not right, we come back within 14 days and put it right free of charge."),
      p("Put it next to what you pay your suppliers today. Then give me 15 minutes and 10% off your first job."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 8, dia: "2026-11-09", fase: "oferta", key: "last_call",
    assunto: "Last call: 10% off your first job ends Friday",
    subtitulo: "Any cleaning or maintenance job. One reply or one 15 minute call.",
    corpo: [
      p("This is my last email about this offer."),
      p("Until <strong>Friday 13 November</strong>, your first job with Fixfy is 10% off. Any job: a clean, a repair, a room painted, a certificate."),
      p("Two ways to take it:"),
      ol(
        "Book a 15 minute call below and I will open your account",
        "Reply with an address and the job, and we will book it directly",
      ),
      p(`If neither suits you now, keep the PDF. Cleaning, maintenance and compliance, one number: ${TELEFONE}.`),
    ],
    botao: "Book a 15 minute call",
  },

  /* ══════════════════ Nutrição: uma por semana ══════════════════ */
  {
    n: 9, dia: "2026-11-16", fase: "nutricao", key: "co_week",
    assunto: "Carbon Monoxide Awareness Week: a two minute check",
    subtitulo: "What to confirm in every let property this week.",
    corpo: [
      p("This is Carbon Monoxide Awareness Week, which makes it a good week to check three things across your portfolio."),
      ul(
        "A carbon monoxide alarm in every room with a fixed combustion appliance, such as a boiler or a fire (gas cookers are excluded)",
        "A smoke alarm on every storey used as living accommodation",
        "A gas safety check in the last 12 months, with a copy given to the tenant within 28 days",
      ),
      p("Once a tenant reports a faulty alarm, the landlord has to repair or replace it."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 10, dia: "2026-11-23", fase: "nutricao", key: "deposits",
    assunto: "Cleaning is still the first reason for deposit claims",
    subtitulo: "29% of claims, for the fifth year running. What gets checked first.",
    corpo: [
      p("The Deposit Protection Service published its 2025 figures this year. Cleaning was the most common reason for a deposit claim for the fifth year in a row, at 29.38% of claims, ahead of damage at 18.42% and rent at 16.45%."),
      p("In practice, check-out clerks look at the same places first:"),
      ul(
        "The oven, inside the door glass and under the trays",
        "Limescale on taps, screens and tiles",
        "Inside cupboards, the fridge and the freezer",
        "Skirting, window frames, extractor fans and switches",
      ),
      p("A professional end of tenancy clean with a dated photo report removes most of that argument before it starts."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 11, dia: "2026-11-30", fase: "nutricao", key: "december_diary",
    assunto: "December check-outs: send the dates now",
    subtitulo: "The last two weeks of the year are the first to fill.",
    corpo: [
      p("December is short. Tradespeople and cleaners take the same two weeks off as everyone else, and the properties that become empty over Christmas are the ones that sit longest."),
      p("If you already know which tenancies end in December or early January, send me the addresses and dates now. We will hold the slots and confirm each price in writing."),
      ul(
        "End of tenancy clean from £190",
        "Repairs and painting, half day from £171",
        "Gas Safety, EICR and EPC from £75",
      ),
      p("Reply with the list, or book 15 minutes below."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 12, dia: "2026-12-07", fase: "nutricao", key: "renters_rights",
    assunto: "Periodic tenancies: what changes for your turnarounds",
    subtitulo: "Less warning before a move-out means less time to prepare the property.",
    corpo: [
      p("The first phase of the Renters' Rights Act has been in force since 1 May 2026. Tenancies are now periodic, and a tenant can leave with two months' notice at any point in the year."),
      p("For your team that means changeovers are harder to plan around fixed end dates:"),
      ul(
        "Move-outs spread across the year instead of clustering",
        "Less time between notice and check-out",
        "More pressure to relet quickly",
      ),
      p("The agents handling this best have one supplier who can clean, repair and certify in the same week, booked the day the notice arrives."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 13, dia: "2026-12-14", fase: "nutricao", key: "january_voids",
    assunto: "January voids run the longest. Shorten yours.",
    subtitulo: "What you can book now so the property is ready on day one.",
    corpo: [
      p("Goodlord's rental index put the average void in England at 22 days in March 2026, with January the slowest month of the year at 26 days."),
      p("You cannot control demand in January. You can control how many of those days are lost to the property not being ready:"),
      ul(
        "Book the clean for the day after check-out, not the week after",
        "Do repairs and touch-up painting in the same visit plan",
        "Renew any certificate that expires in the first quarter while the property is empty",
      ),
      p("Send me the January check-outs you already know about and we will plan them now."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 14, dia: "2026-12-21", fase: "nutricao", key: "prs_database",
    assunto: "The landlord database: what to have ready",
    subtitulo: "Gas, electrical and EPC records are part of registration.",
    corpo: [
      p("The Private Rented Sector Database starts opening region by region from 15 December 2026, with a final registration deadline of 14 November 2027."),
      ul(
        "The fee is £65 per property per year",
        "Gas safety, electrical safety and EPC records are uploaded with the registration",
        "Failing to register can mean a penalty of up to £7,000",
      ),
      p("The practical step for agents is simple: know which properties have a certificate missing or close to expiry before your region opens."),
      p("Reply with your addresses and we will tell you what is due, then book the visits at fixed prices."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 15, dia: "2027-01-04", fase: "nutricao", key: "new_year",
    assunto: "One supplier for the year, starting with one job",
    subtitulo: "Cleaning, maintenance and compliance. Fixed prices for 2027.",
    corpo: [
      p("January is when most agents review their suppliers. If yours let you down last year, this is the week to line up a second option."),
      ul(
        "<strong>Cleaning</strong>: end of tenancy, deep, after builders and regular",
        "<strong>Maintenance</strong>: repairs, plumbing, carpentry and painting",
        "<strong>Compliance</strong>: Gas Safety, EICR, EPC and inventory reports",
      ),
      p("No contract and no minimum. One message for any job, a photo report when it is done and one invoice after the work."),
      p("Book 15 minutes below and I will open your account and send you the 2027 price list."),
    ],
    botao: "Book a 15 minute call",
  },
  {
    n: 16, dia: "2027-01-11", fase: "nutricao", key: "compliance_dates",
    assunto: "The compliance dates for a let property, on one page",
    subtitulo: "A short list you can forward to every landlord.",
    corpo: [
      p("A short reference you can forward to your landlords."),
      ul(
        "<strong>Gas safety</strong>: every 12 months, copy to the tenant within 28 days",
        "<strong>EICR</strong>: every 5 years, remedial work within 28 days of the report",
        "<strong>EPC</strong>: valid for 10 years. The minimum rating of C applies to all tenancies from 1 October 2030",
        "<strong>Smoke and carbon monoxide alarms</strong>: checked at the start of every tenancy",
      ),
      p("If you send me the addresses, we will check what is due this year and book the visits at fixed prices."),
      p(FECHO),
    ],
    botao: "Book a 15 minute call",
  },
];

/* ═══════════════════ O e-mail ═══════════════════ */

const ARIAL = "Arial,Helvetica,sans-serif";
const TEXTO = `margin:0 0 16px; font-family:${ARIAL}; font-size:15px; line-height:24px; color:#1F2340;`;

function parte(x: Parte): string {
  if ("p" in x) return `<p style="${TEXTO}">${x.p}</p>`;
  const tag = "ol" in x ? "ol" : "ul";
  const itens = ("ol" in x ? x.ol : x.ul).map((i) => `<li style="margin:0 0 7px;">${i}</li>`).join("");
  return `<${tag} style="margin:0 0 16px; padding-left:22px; font-family:${ARIAL}; font-size:15px; line-height:23px; color:#1F2340;">${itens}</${tag}>`;
}

/** O botão abre um e-mail pronto para o Victor: marcar não depende de ferramenta de agenda. */
function linkDaReuniao(e: EmailB2B): string {
  const assunto = encodeURIComponent("15 minute call with Fixfy");
  const corpo = encodeURIComponent("Hi Victor,\n\nA good time for a 15 minute call would be:\n\nCompany:\nPhone:\n");
  return `mailto:${remetenteB2B().reply_to}?subject=${assunto}&body=${corpo}`;
}

const comOrigem = (url: string, e: EmailB2B) => `${url}?utm_source=email&utm_medium=b2b&utm_campaign=agencies_${e.n}_${e.key}`;

/** A assinatura do Victor: logo, barra laranja, nome, cargo, contato e as três frentes. */
export function assinaturaDoVictor(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; font-family:${ARIAL}; margin-top:6px;">
  <tr>
    <td style="padding:0 18px 0 0; vertical-align:middle;">
      <a href="https://www.getfixfy.com/business" style="text-decoration:none;"><img src="https://www.getfixfy.com/brand/fixfy-primary-navy.png" width="116" height="50" alt="Fixfy" style="display:block; border:0; width:116px; height:50px;"></a>
    </td>
    <td style="padding:4px 0 4px 16px; border-left:3px solid ${CLIENT_BRAND.orange}; vertical-align:middle;">
      <div style="font-size:16px; line-height:21px; font-weight:bold; color:${CLIENT_BRAND.navy};">Victor Braz</div>
      <div style="font-size:13px; line-height:18px; color:#55597A;">Director of Operations · Fixfy</div>
      <div style="font-size:13px; line-height:20px; margin-top:5px; color:${CLIENT_BRAND.navy};">
        <a href="tel:+442045384668" style="color:${CLIENT_BRAND.navy}; text-decoration:none;">${TELEFONE}</a>
        <span style="color:#C9CEE0;">&nbsp;|&nbsp;</span>
        <a href="mailto:victor@getfixfy.com" style="color:${CLIENT_BRAND.navy}; text-decoration:none;">victor@getfixfy.com</a>
      </div>
      <div style="font-size:13px; line-height:20px;">
        <a href="https://www.getfixfy.com/business" style="color:${CLIENT_BRAND.orange}; text-decoration:none; font-weight:bold;">getfixfy.com/business</a>
      </div>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:12px 0 0;">
      <div style="font-size:11px; line-height:16px; letter-spacing:0.12em; text-transform:uppercase; font-weight:bold; color:${CLIENT_BRAND.navy};">
        Cleaning <span style="color:${CLIENT_BRAND.orange};">·</span> Maintenance <span style="color:${CLIENT_BRAND.orange};">·</span> Compliance
      </div>
    </td>
  </tr>
</table>`;
}

export function htmlDoB2B(e: EmailB2B): string {
  const oculto = `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">${escapeHtml(e.subtitulo)}${"&nbsp;&zwnj;".repeat(40)}</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>&#8203;</title>
</head>
<body style="margin:0; padding:0; background:#FFFFFF;">
${oculto}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
  <tr><td style="padding:26px 20px 34px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">
      <tr><td>
        <p style="${TEXTO}">Hi ${NOME_DO_CONTATO},</p>
        ${e.corpo.map(parte).join("\n        ")}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;">
          <tr><td bgcolor="${CLIENT_BRAND.orange}" style="border-radius:8px; background:${CLIENT_BRAND.orange};">
            <a href="${linkDaReuniao(e)}" style="display:inline-block; padding:13px 26px; font-family:${ARIAL}; font-size:15px; font-weight:bold; color:#FFFFFF; text-decoration:none;">${escapeHtml(e.botao)}</a>
          </td></tr>
        </table>
        <p style="margin:0 0 24px; font-family:${ARIAL}; font-size:14px; line-height:22px; color:#55597A;">
          <a href="${comOrigem(PDF_O_QUE_FAZEMOS, e)}" style="color:${CLIENT_BRAND.navy}; font-weight:bold;">What we do (PDF)</a>
          <span style="color:#C9CEE0;">&nbsp;·&nbsp;</span>
          <a href="${comOrigem(PDF_PRECOS, e)}" style="color:${CLIENT_BRAND.navy}; font-weight:bold;">Price list (PDF)</a>
        </p>
        <p style="margin:0 0 14px; font-family:${ARIAL}; font-size:15px; line-height:24px; color:#1F2340;">Best regards,</p>
        ${assinaturaDoVictor()}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
          <tr><td style="padding-top:12px; border-top:1px solid #E3E6F0; font-family:${ARIAL}; font-size:11px; line-height:16px; color:#8A8DA6;">
            Fixfy is a trading name of GETFIXFY LTD, registered in England and Wales, company no. 15406523, 124 City Road, London EC1V 2NX. You are receiving this because your agency lets property in London.
            <a href="${LINK_DE_SAIDA}" style="color:#8A8DA6; text-decoration:underline;">Unsubscribe</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/* ═══════════════════ Agenda ═══════════════════ */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Quando a peça `e` sai para a onda que começa em `inicio` ("2026-10-15" é a onda 1). */
export function quandoSai(e: EmailB2B, inicioDaOnda: string): Date {
  const desloca = Math.round((Date.parse(`${inicioDaOnda}T12:00:00Z`) - Date.parse(`${SEQUENCIA_B2B[0].dia}T12:00:00Z`)) / DIA_MS);
  const dia = new Date(Date.parse(`${e.dia}T12:00:00Z`) + desloca * DIA_MS).toISOString().slice(0, 10);
  return horaDeLondres(dia, HORA_B2B.hora, HORA_B2B.minuto);
}

export const nomeDoBroadcastB2B = (onda: number, e: EmailB2B) => `Fixfy B2B · W${onda} · ${String(e.n).padStart(2, "0")} ${e.key}`;

export type LinhaB2B = { n: number; key: string; quando: string; assunto: string; estado: "passou" | "falta criar" | "rascunho" | "agendado" | "enviado" | "criado" | "erro"; detalhe?: string };

/**
 * Cria os broadcasts da onda e, com `agendar`, põe a hora. O Resend só aceita
 * agendar até 30 dias à frente: o que passa disso fica em rascunho e é agendado
 * numa volta seguinte (a rotina da manhã do agente chama isto todo dia).
 */
export async function montarB2B(opcoes: { aplicar: boolean; agendar: boolean; onda: number; inicio: string; segmento: string | null; agora?: Date }): Promise<LinhaB2B[]> {
  const agora = opcoes.agora ?? new Date();
  const existentes = new Map<string, BroadcastResend>();
  for (const b of await broadcasts()) if (b.name) existentes.set(b.name, b);
  const { from, reply_to } = remetenteB2B();
  const linhas: LinhaB2B[] = [];

  for (const e of SEQUENCIA_B2B) {
    const quando = quandoSai(e, opcoes.inicio);
    const nome = nomeDoBroadcastB2B(opcoes.onda, e);
    const linha: LinhaB2B = { n: e.n, key: e.key, quando: quando.toISOString(), assunto: e.assunto, estado: "falta criar" };
    linhas.push(linha);
    let b = existentes.get(nome) ?? null;
    if (b) linha.estado = b.sent_at || b.status === "sent" ? "enviado" : b.scheduled_at || b.status === "queued" ? "agendado" : "rascunho";
    if (quando.getTime() <= agora.getTime() + 10 * 60 * 1000) {
      if (linha.estado === "falta criar" || linha.estado === "rascunho") linha.estado = "passou";
      continue;
    }
    if (!opcoes.aplicar || !opcoes.segmento) continue;
    try {
      if (!b) {
        const novo = await criarBroadcast({ segment_id: opcoes.segmento, from, reply_to, subject: e.assunto, html: htmlDoB2B(e), name: nome });
        b = { id: novo.id, name: nome, status: "draft", scheduled_at: null, sent_at: null };
        linha.estado = "criado";
      }
      const dentroDoLimite = quando.getTime() - agora.getTime() < 29 * DIA_MS;
      if (opcoes.agendar && dentroDoLimite && (linha.estado === "criado" || linha.estado === "rascunho")) {
        await agendarBroadcast(b.id, quando);
        linha.estado = "agendado";
      }
    } catch (err) {
      linha.detalhe = String((err as Error).message ?? err);
      if (linha.estado === "falta criar") linha.estado = "erro";
    }
  }
  return linhas;
}

/* ═══════════════════ Ondas ═══════════════════ */

/** As ondas no ar. Onda nova = uma linha aqui e `--b2b-onda=N --aplicar`. */
export const ONDAS: Array<{ n: number; inicio: string }> = [{ n: 1, inicio: "2026-10-15" }];

const ehCaixaDeEquipe = (nome: string | null) => !nome || /\bteam$/i.test(nome.trim());

/**
 * Escolhe quem entra na onda: quem ainda não está em nenhuma onda anterior,
 * fora da lista de bloqueio, com nome de pessoa antes de caixa geral. Função
 * pura, para o teste.
 */
export function escolherOnda<T extends { email: string; first_name: string | null; unsubscribed: boolean }>(
  audiencia: T[], jaEmOnda: Set<string>, bloqueados: Set<string>, tamanho = TAMANHO_DA_ONDA,
): T[] {
  const livres = audiencia.filter((c) => !c.unsubscribed && !jaEmOnda.has(c.email.toLowerCase()) && !bloqueados.has(c.email.toLowerCase()));
  const ordem = (c: T) => (ehCaixaDeEquipe(c.first_name) ? 1 : 0);
  return [...livres].sort((a, b) => ordem(a) - ordem(b) || a.email.localeCompare(b.email)).slice(0, tamanho);
}

export async function montarOnda(opcoes: { onda: number; aplicar: boolean }): Promise<{ segmento: string | null; audiencia: number; jaNaOnda: number; entram: number; pessoas: number; erros: string[] }> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { adicionarAoSegmento, contatosDoSegmento, segmentoPeloNome } = await import("./resend");
  const origem = await segmentoPeloNome(AUDIENCIA_B2B, false);
  if (!origem) throw new Error(`audiência "${AUDIENCIA_B2B}" não existe no Resend`);
  const audiencia = await contatosDoSegmento(origem);

  const jaEmOnda = new Set<string>();
  let jaNaOnda = 0;
  for (let n = 1; n <= opcoes.onda; n++) {
    const id = await segmentoPeloNome(nomeDaOnda(n), false);
    if (!id) continue;
    const dentro = await contatosDoSegmento(id);
    if (n === opcoes.onda) jaNaOnda = dentro.length;
    for (const c of dentro) jaEmOnda.add(c.email.toLowerCase());
  }

  const sb = createServiceClient();
  const { data: bloqueio, error } = await sb.from("email_suppressions").select("email").limit(5000);
  if (error) throw new Error(error.message);
  const escolhidos = escolherOnda(audiencia, jaEmOnda, new Set((bloqueio ?? []).map((b) => String(b.email).toLowerCase())), Math.max(0, TAMANHO_DA_ONDA - jaNaOnda));
  const res = { segmento: null as string | null, audiencia: audiencia.length, jaNaOnda, entram: escolhidos.length, pessoas: escolhidos.filter((c) => !ehCaixaDeEquipe(c.first_name)).length, erros: [] as string[] };
  if (!opcoes.aplicar) return res;

  res.segmento = await segmentoPeloNome(nomeDaOnda(opcoes.onda), true);
  res.entram = 0;
  for (const c of escolhidos) {
    try { await adicionarAoSegmento(c.id, res.segmento as string); res.entram++; }
    catch (e) { res.erros.push(String((e as Error).message ?? e)); if (res.erros.length >= 5) break; }
  }
  return res;
}
