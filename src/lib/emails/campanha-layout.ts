/**
 * O layout das campanhas: o e-mail bonito, e por que cada peça dele existe.
 *
 * Irmão do `client-email-layout`, que continua sendo o do transacional. Este é
 * o da agenda de marketing, e ele tem três coisas que o outro não tem:
 *
 *   etiqueta   a tirinha laranja no topo ("Home notes", "Offer", "Landlords").
 *              Diz em uma palavra de que tipo é o e-mail antes de a pessoa ler
 *              a primeira linha, que é o que faz a leitura continuar.
 *   caixa de   o cupom com moldura tracejada, código grande e validade. Código
 *   oferta     escondido no meio do texto não é usado; código em caixa é.
 *   rodapé     endereço da empresa e saída em um clique, que é exigência de
 *   honesto    marketing no Reino Unido e o que faz o provedor confiar.
 *
 * Regras de e-mail que parecem exagero e não são: tudo em tabela, tudo com
 * estilo em linha, imagem com largura fixa, `color-scheme: light` para o Gmail
 * não inverter as cores sozinho, e `<title>` vazio para o celular não repetir o
 * assunto dentro do corpo.
 *
 * O logo é sempre o oficial, servido do próprio OS: `/logos/fixfy-wordmark-white-trim.png`.
 */

import { appBaseUrl } from "@/lib/app-base-url";
import { CLIENT_BRAND, escapeHtml } from "@/lib/emails/client-email-layout";
import { assinaturaDoVictorHtml } from "./assinatura-victor";

export type BlocoDeTexto = { tipo: "texto"; html: string };
export type BlocoDeLista = { tipo: "lista"; titulo: string; itens: string[] };
export type BlocoDeCitacao = { tipo: "citacao"; texto: string; autor: string };
export type BlocoDeNumeros = { tipo: "numeros"; itens: Array<{ valor: string; rotulo: string }> };
export type Bloco = BlocoDeTexto | BlocoDeLista | BlocoDeCitacao | BlocoDeNumeros;

export type OfertaNoEmail = {
  codigo: string;
  /** "10% off", "£20 off". */
  valor: string;
  /** O que o desconto cobre, em uma linha. */
  sobre: string;
  /** "31 March". */
  validade: string;
};

export type CampanhaInput = {
  preheader: string;
  /** A tirinha do topo. Duas ou três palavras. */
  etiqueta: string;
  titulo: string;
  nome?: string;
  blocos: Bloco[];
  oferta?: OfertaNoEmail;
  cta: { texto: string; url: string };
  unsubscribeUrl?: string;
  /** Linha extra no rodapé, quando a peça precisa explicar algo. */
  notaDoRodape?: string;
  /** Selo laranja à direita do logo ("FIXFY CLUB", "36 HOURS ONLY"). Sem selo, só o logo. */
  selo?: string;
  /** Quem assina. Sem isto, "The Fixfy Team". */
  assinatura?: Assinatura;
};

/** `html` substitui o nome e a linha no corpo (assinatura com logo e contatos). */
export type Assinatura = { nome: string; linha: string; html?: string };

/** Voz do Victor no B2C (dono, 15/10/2026): Diretor de Operações, e a resposta cai na caixa dele. */
export const ASSINATURA_DO_VICTOR: Assinatura = {
  nome: "Victor Braz",
  linha: "Operations Director, Fixfy. Reply to this email and I will get back to you personally.",
  html: assinaturaDoVictorHtml(),
};
const ASSINATURA_PADRAO: Assinatura = { nome: "The Fixfy Team", linha: "Reply to this email and a real person answers." };

function assinaturaNoCorpo(a: Assinatura): string {
  if (a.html) return `<div style="margin:24px 0 0;">${a.html}</div>`;
  return `<p style="margin:22px 0 0; font-size:15px; line-height:24px; color:${CLIENT_BRAND.body};">
            ${escapeHtml(a.nome)}<br>
            <span style="color:${CLIENT_BRAND.gray}; font-size:14px;">${escapeHtml(a.linha)}</span>
          </p>`;
}


/**
 * Cabeçalho compacto (dono, 15/10/2026, versão C): faixa navy baixa com o logo
 * branco à esquerda, o selo da peça em laranja à direita e uma frase curta
 * embaixo, fechada por um fio laranja. A faixa antiga de 600x88 era uma imagem
 * só; aqui o logo é o PNG branco e o resto é texto, então lê mesmo com imagem
 * bloqueada.
 */
const LOGO_LARGURA = 118;
const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function cabecalho(logo: string, selo?: string): string {
  const pilula = selo?.trim()
    ? `<span style="display:inline-block; font-family:${FONTE}; font-size:10px; line-height:12px; letter-spacing:0.14em; font-weight:800; text-transform:uppercase; color:#FFFFFF; background:${CLIENT_BRAND.orange}; border-radius:999px; padding:6px 11px;">${escapeHtml(selo.trim())}</span>`
    : "";
  return `<tr>
        <td bgcolor="${CLIENT_BRAND.navy}" style="background:${CLIENT_BRAND.navy}; padding:18px 28px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle"><img src="${logo}" alt="Fixfy" width="${LOGO_LARGURA}" style="display:block; width:${LOGO_LARGURA}px; height:auto; border:0;"></td>
            <td valign="middle" align="right">${pilula}</td>
          </tr></table>
          <div style="font-family:${FONTE}; font-size:15px; line-height:21px; font-weight:700; color:#FFFFFF; margin-top:12px;">Your home, <span style="color:#FF7A3D;">sorted</span> by one team.</div>
        </td>
      </tr>
      <tr><td bgcolor="${CLIENT_BRAND.orange}" style="background:${CLIENT_BRAND.orange}; height:4px; line-height:4px; font-size:0;">&nbsp;</td></tr>`;
}

function preheaderOculto(texto: string): string {
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${CLIENT_BRAND.canvas}; opacity:0;">${escapeHtml(texto)}</div>`;
}

function paragrafo(html: string): string {
  return `<p style="margin:0 0 16px; font-size:16px; line-height:26px; color:${CLIENT_BRAND.body};">${html}</p>`;
}

function lista(titulo: string, itens: string[]): string {
  const linhas = itens
    .map(
      (i) => `<tr>
        <td width="22" valign="top" style="padding:5px 0; font-size:15px; line-height:22px; color:${CLIENT_BRAND.orange};">&#10003;</td>
        <td style="padding:5px 0; font-size:15px; line-height:22px; color:#44403C;">${i}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px; background:#FBFAF9; border:1px solid ${CLIENT_BRAND.line}; border-radius:10px;">
    <tr><td style="padding:20px 22px;">
      <p style="margin:0 0 12px; font-size:15px; line-height:22px; color:${CLIENT_BRAND.navy}; font-weight:700;">${escapeHtml(titulo)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${linhas}</table>
    </td></tr>
  </table>`;
}

function citacao(texto: string, autor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
    <tr><td style="padding:2px 0 2px 18px; border-left:3px solid ${CLIENT_BRAND.orange};">
      <p style="margin:0 0 6px; font-size:16px; line-height:26px; color:${CLIENT_BRAND.ink}; font-style:italic;">&ldquo;${escapeHtml(texto)}&rdquo;</p>
      <p style="margin:0; font-size:13px; line-height:20px; color:${CLIENT_BRAND.gray};">&#9733;&#9733;&#9733;&#9733;&#9733; &nbsp;${escapeHtml(autor)}</p>
    </td></tr>
  </table>`;
}

function numeros(itens: Array<{ valor: string; rotulo: string }>): string {
  const celulas = itens
    .map(
      (i) => `<td align="center" style="padding:14px 8px;">
        <div style="font-size:24px; line-height:30px; font-weight:700; color:${CLIENT_BRAND.navy};">${escapeHtml(i.valor)}</div>
        <div style="font-size:12px; line-height:18px; color:${CLIENT_BRAND.gray}; margin-top:2px;">${escapeHtml(i.rotulo)}</div>
      </td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px; background:${CLIENT_BRAND.canvas}; border-radius:10px;">
    <tr>${celulas}</tr>
  </table>`;
}

/**
 * A caixa da oferta.
 *
 * Moldura tracejada e código grande em fonte de largura fixa: parece cupom, e
 * é lido como cupom. A validade fica dentro da caixa de propósito, porque
 * prazo em nota de rodapé não cria urgência nenhuma.
 */
function caixaDaOferta(o: OfertaNoEmail): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px; background:${CLIENT_BRAND.softOrangeBg}; border:2px dashed ${CLIENT_BRAND.orange}; border-radius:12px;">
    <tr><td align="center" style="padding:22px 20px;">
      <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; font-weight:700; color:${CLIENT_BRAND.orange};">${escapeHtml(o.valor)}</div>
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace; font-size:30px; line-height:38px; font-weight:700; color:${CLIENT_BRAND.navy}; letter-spacing:0.04em; margin:8px 0 6px;">${escapeHtml(o.codigo)}</div>
      <div style="font-size:14px; line-height:21px; color:#44403C;">${escapeHtml(o.sobre)}</div>
      <div style="font-size:12px; line-height:18px; color:${CLIENT_BRAND.gray}; margin-top:8px;">The button applies it for you, or enter it at checkout. Valid until ${escapeHtml(o.validade)}.</div>
    </td></tr>
  </table>`;
}

function botao(texto: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 2px;">
    <tr><td class="btn-mobile" style="border-radius:8px; background:${CLIENT_BRAND.orange};">
      <a href="${escapeHtml(url)}" style="display:inline-block; padding:15px 32px; font-size:16px; font-weight:600; color:#FFFFFF; text-decoration:none;">${escapeHtml(texto)}</a>
    </td></tr>
  </table>`;
}

function renderBloco(b: Bloco): string {
  switch (b.tipo) {
    case "texto": return paragrafo(b.html);
    case "lista": return lista(b.titulo, b.itens);
    case "citacao": return citacao(b.texto, b.autor);
    case "numeros": return numeros(b.itens);
  }
}

export function renderCampanha(input: CampanhaInput): string {
  const nome = input.nome?.trim() ? escapeHtml(input.nome.trim().split(/\s+/)[0]) : "there";
  const logo = `${appBaseUrl()}/logos/fixfy-wordmark-white-trim.png`;
  const corpo = input.blocos.map(renderBloco).join("");
  const oferta = input.oferta ? caixaDaOferta(input.oferta) : "";
  const saida = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${CLIENT_BRAND.gray}; text-decoration:underline;">Unsubscribe</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
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
  a { color: ${CLIENT_BRAND.orange}; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px-mobile { padding-left: 22px !important; padding-right: 22px !important; }
    .h1-mobile { font-size: 25px !important; line-height: 33px !important; }
    .btn-mobile a { display: block !important; text-align: center; }
  }
</style>
</head>
<body bgcolor="${CLIENT_BRAND.canvas}" style="margin:0; padding:0; background-color:${CLIENT_BRAND.canvas}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheaderOculto(input.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CLIENT_BRAND.canvas}" style="background-color:${CLIENT_BRAND.canvas};">
  <tr><td align="center" style="padding:28px 16px 40px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px; max-width:600px; background-color:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(2,0,64,0.08);">

      ${cabecalho(logo, input.selo)}

      <tr>
        <td class="px-mobile" style="padding:30px 40px 0;">
          <div style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:${CLIENT_BRAND.orange}; margin-bottom:12px;">${escapeHtml(input.etiqueta)}</div>
          <h1 class="h1-mobile" style="margin:0 0 18px; font-size:28px; line-height:36px; font-weight:800; letter-spacing:-0.02em; color:${CLIENT_BRAND.navy};">${escapeHtml(input.titulo)}</h1>
          <p style="margin:0 0 18px; font-size:16px; line-height:26px; color:${CLIENT_BRAND.body};">Hi ${nome},</p>
          ${corpo}
          ${oferta}
          ${botao(input.cta.texto, input.cta.url)}
          ${assinaturaNoCorpo(input.assinatura ?? ASSINATURA_PADRAO)}
        </td>
      </tr>

      <tr>
        <td class="px-mobile" style="padding:26px 40px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-top:1px solid ${CLIENT_BRAND.line}; padding-top:16px;">
              ${input.notaDoRodape ? `<p style="margin:0 0 10px; font-size:12px; line-height:19px; color:${CLIENT_BRAND.gray};">${input.notaDoRodape}</p>` : ""}
              <p style="margin:0 0 6px; font-size:12px; line-height:19px; color:${CLIENT_BRAND.gray};">
                Fixfy, London. Cleaning, handyman, painting, electrics, plumbing and landlord certificates.
              </p>
              <p style="margin:0; font-size:12px; line-height:19px; color:${CLIENT_BRAND.gray};">
                You are on this list because you asked us for a price or booked a job. ${saida}
              </p>
            </td></tr>
          </table>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
