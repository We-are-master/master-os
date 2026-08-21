/**
 * O email de self-bill que o parceiro recebe.
 *
 * Morava dentro de `src/app/api/self-bills/send-email/route.ts`, e por isso a
 * única forma de VER o email era mandá-lo para um parceiro de verdade: a rota
 * arrasta `server-only` por dependência e não pode ser importada fora do Next.
 *
 * Aqui ele pode ser renderizado num script, conferido antes de sair, e testado.
 * O corpo é o mesmo, sem uma vírgula mudada: isto é mudança de lugar, não de
 * conteúdo. O detalhamento job a job continua indo no PDF anexado.
 */
import { formatCurrency } from "@/lib/utils";
import type { SelfBill } from "@/types/database";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtSbDate(ymd?: string | null): string {
  const raw = ymd?.trim();
  if (!raw) return "—";
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Branded "Self-Bill Issued" partner email — mirrors the Fixfy statement
 *  design (navy header, orange accent, reference bar, summary, HMRC notice).
 *  The full job-by-job breakdown rides along as the attached PDF. */
/**
 * Exportado para poder ser RENDERIZADO sem disparar envio.
 *
 * Sem isto, a única forma de ver o email era mandá-lo para um parceiro de
 * verdade. Exportar deixa o preview possível e não muda nada de quem já usa.
 */
export function buildSelfBillEmailHtml(
  sb: SelfBill,
  dueYmd: string | null,
  args?: { partnerName?: string | null; companyName?: string | null },
): string {
  const greeting = esc((args?.partnerName?.trim() || sb.partner_name?.trim() || "there"));
  const ref = esc(sb.reference || "");
  const periodStart = sb.week_start ? fmtSbDate(sb.week_start) : null;
  const periodEnd = sb.week_end ? fmtSbDate(sb.week_end) : null;
  const periodText = periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : esc(sb.week_label ?? sb.period ?? "—");
  const payout = formatCurrency(Number(sb.net_payout ?? 0));
  const labour = formatCurrency(Number(sb.job_value ?? 0));
  const materials = formatCurrency(Number(sb.materials ?? 0));
  const commission = Number(sb.commission ?? 0);
  const jobsCount = Number(sb.jobs_count ?? 0);
  const paidAt = sb.paid_at?.trim() ? fmtSbDate(sb.paid_at) : null;

  // Banner adapts to whether the payout has actually been sent yet.
  const banner = paidAt
    ? `<tr><td bgcolor="#DCFCE7" style="background:#DCFCE7; padding:18px 40px; border-bottom:3px solid #22C55E;">
         <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#166534; text-transform:uppercase;">PAYOUT SENT</p>
         <p style="margin:2px 0 0 0; font-size:14px; color:#166534;">${payout} transferred on ${paidAt}</p>
       </td></tr>`
    : `<tr><td bgcolor="#F2F0FA" style="background:#F2F0FA; padding:18px 40px; border-bottom:3px solid #020040;">
         <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">PAYOUT SCHEDULED</p>
         <p style="margin:2px 0 0 0; font-size:14px; color:#020040;">${payout}${dueYmd ? ` · payment due ${fmtSbDate(dueYmd)}` : ""}</p>
       </td></tr>`;



  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">Self-bill issued — ${payout} for jobs completed this period. PDF attached.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(2,0,64,0.06);">

      <tr><td align="center" bgcolor="#020040" style="background:#020040; padding:24px;">
        <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="100" height="auto" style="display:block; width:100px; height:auto;">
      </td></tr>
      <tr><td style="background:#ED4B00; line-height:5px; font-size:5px; height:5px;" height="5">&nbsp;</td></tr>

      ${banner}

      <tr><td style="padding:32px 40px 8px 40px;">
        <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:3px; color:#ED4B00; text-transform:uppercase;">SELF-BILL ISSUED</p>
      </td></tr>
      <tr><td style="padding:0 40px 8px 40px;">
        <h1 style="margin:0; font-size:26px; line-height:32px; font-weight:700; color:#020040;">Hi ${greeting},</h1>
      </td></tr>
      <tr><td style="padding:0 40px 28px 40px;">
        <p style="margin:0; font-size:15px; line-height:24px; color:#4A4A55;">Your self-bill is ready. Nothing to do: it is attached below for your records.</p>
      </td></tr>

      <tr><td style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:8px;"><tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td valign="middle" style="font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Self-bill Ref</td>
                <td valign="middle" align="right" style="font-size:14px; font-weight:700; color:#020040;">${ref}</td></tr>
            <tr><td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Period</td>
                <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040;">${periodText}</td></tr>

          </table>
        </td></tr></table>
      </td></tr>




      <tr><td style="padding:0 40px 32px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:8px;"><tr><td style="padding:14px 18px;">
          <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:#020040;">Questions about your payout?</p>
          <p style="margin:0; font-size:13px; line-height:20px; color:#4A4A55;">Reply to this email or contact <a href="mailto:support@getfixfy.com" style="color:#020040; font-weight:600; text-decoration:none;">support@getfixfy.com</a> &middot; <a href="tel:+442045384668" style="color:#020040; font-weight:600; text-decoration:none;">020 4538 4668</a></p>
        </td></tr></table>
      </td></tr>

      <tr><td bgcolor="#020040" style="background:#020040; padding:24px 40px; text-align:center;">
        <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="70" height="auto" style="display:inline-block; width:70px; height:auto; margin-bottom:10px;">
        <p style="margin:0; font-size:11px; line-height:18px; color:#AAAAD0;">Getfixfy Ltd &middot; Co. No. 15406523<br>124 City Road, London EC1V 2NX, United Kingdom<br><a href="https://getfixfy.com" style="color:#AAAAD0; text-decoration:none;">getfixfy.com</a></p>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
}
