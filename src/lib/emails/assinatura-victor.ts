/**
 * A assinatura do Victor (dono, 25/10/2026): a mesma do Gmail dele
 * (docs/copy/assinatura-gmail-victor.html), usada nos e-mails de marketing que
 * saem no nome dele (B2B e clube). Mudou lá, muda aqui.
 */
const FONTE = "Helvetica,Arial,sans-serif";
const PONTO = `<span style="color:#B5B6C4;">&nbsp;·&nbsp;</span>`;

export function assinaturaDoVictorHtml(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; font-family:${FONTE};">
  <tr>
    <td style="padding:0 0 10px 0;">
      <p style="margin:0; font-size:15px; line-height:20px; font-weight:700; color:#020040;">Victor Braz</p>
      <p style="margin:2px 0 0 0; font-size:13px; line-height:18px; color:#505268;">Operations Director, Fixfy</p>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 12px 0;">
      <p style="margin:0; font-size:13px; line-height:20px; color:#303044;">
        <a href="tel:+442045384668" style="color:#303044; text-decoration:none;">+44 20 4538 4668</a>${PONTO}<a href="mailto:victor@getfixfy.com" style="color:#303044; text-decoration:none;">victor@getfixfy.com</a>
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:12px 0 0 0; border-top:1px solid #EEEEF2;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td valign="middle" style="padding:0 14px 0 0;">
            <a href="https://www.getfixfy.com" style="text-decoration:none;"><img src="https://app.getfixfy.com/logos/fixfy-primary-navy-trim.png" alt="Fixfy" width="96" height="34" style="display:block; border:0; width:96px; height:34px;"></a>
          </td>
          <td valign="middle" style="padding:0;">
            <p style="margin:0; font-size:12px; line-height:17px; color:#7A7C92;">Home repairs and maintenance across London</p>
            <p style="margin:2px 0 0 0; font-size:12px; line-height:17px;">
              <a href="https://www.getfixfy.com" style="color:#505268; text-decoration:none;">Our website</a>${PONTO}<a href="mailto:hello@getfixfy.com" style="color:#505268; text-decoration:none;">Our email</a>${PONTO}<a href="https://wa.me/442045384668" style="color:#505268; text-decoration:none;">Our WhatsApp</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:10px 0 0 0;">
      <p style="margin:0; font-size:11px; line-height:16px; color:#9A9CA8;">Getfixfy Ltd, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523</p>
    </td>
  </tr>
</table>`;
}
