/**
 * O turno da Zia, em um e-mail: o que entrou hoje e o que ainda falta entrar.
 *
 *   node scripts/zia-report.mjs            # modo seco
 *   node scripts/zia-report.mjs --enviar
 *
 * Draft nunca entra no "a receber". Draft e trabalho que ainda nao foi entregue,
 * e soma-lo ja fez o OS reportar 13.810 onde havia 5.158.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENVIAR = process.argv.includes("--enviar");
const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const SH = { apikey: KEY, authorization: `Bearer ${KEY}` };
const BRL = 7;

const p = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]),
);
const hoje = `${p.year}-${p.month}-${p.day}`;
const bonito = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
  .format(new Date(hoje + "T12:00:00Z"));

const q = async (t, f) => {
  const r = await fetch(`${SB}/rest/v1/${t}?${f}`, { headers: SH });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
};
const n = (v) => Number(v) || 0;
const money = (v) =>
  `£${n(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
  ` (R$ ${(n(v) * BRL).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const COLS = "reference,client_name,amount,amount_paid,status,due_date,paid_date,last_payment_date";
// Aberto = pending, overdue, partially_paid. Draft fica fora, de proposito.
const ABERTO = "status=in.(pending,overdue,partially_paid)";

const pagasHoje = await q("invoices", `select=${COLS}&or=(paid_date.eq.${hoje},last_payment_date.eq.${hoje})&status=eq.paid`);
const abertas = await q("invoices", `select=${COLS}&${ABERTO}`);
const falta = (i) => Math.max(0, n(i.amount) - n(i.amount_paid));
const vencemHoje = abertas.filter((i) => i.due_date === hoje);
const vencidas = abertas.filter((i) => i.due_date && i.due_date < hoje);
const soma = (a) => a.reduce((s, i) => s + falta(i), 0);
const recebido = pagasHoje.reduce((s, i) => s + n(i.amount), 0);
const totalAberto = soma(abertas);

const bloco = (rot, valor, sub, cor) => `
  <tr><td style="padding:14px 0;border-bottom:1px solid #ECECF2">
    <div style="font:600 10px/1 -apple-system,Segoe UI,Helvetica,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8AA0">${esc(rot)}</div>
    <div style="font:700 21px/1.25 -apple-system,Segoe UI,Helvetica,sans-serif;color:${cor ?? "#020040"};margin-top:7px">${esc(valor)}</div>
    ${sub ? `<div style="font:400 12px/1.45 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0;margin-top:4px">${esc(sub)}</div>` : ""}
  </td></tr>`;

const listaPagas = pagasHoje.length
  ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">${pagasHoje.slice(0, 8).map((i) => `
      <tr><td style="font:400 12px/1.7 -apple-system,Segoe UI,Helvetica,sans-serif;color:#5A5A72;padding:2px 0">
        <b style="color:#020040">${esc(i.reference ?? "—")}</b> · ${esc(i.client_name ?? "—")} · <b style="color:#0F6E56">${esc(money(i.amount))}</b>
      </td></tr>`).join("")}${pagasHoje.length > 8 ? `<tr><td style="font:400 12px/1.7 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0">+${pagasHoje.length - 8} more</td></tr>` : ""}</table>`
  : `<div style="font:400 12.5px/1.5 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0;margin-top:6px">Nothing came in today.</div>`;

const html = `<!doctype html><html><body style="margin:0;background:#F2F2F6;padding:28px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#020040;padding:22px 26px">
    <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="86" style="display:block;width:86px;height:auto;border:0">
    <div style="font:400 12px/1.4 -apple-system,Segoe UI,Helvetica,sans-serif;color:#9A9AC4;margin-top:12px">Receivables · ${esc(bonito)}</div>
  </td></tr>
  <tr><td style="height:3px;background:${vencidas.length ? "#C0392B" : "#0F6E56"}"></td></tr>
  <tr><td style="padding:6px 26px 22px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:14px 0;border-bottom:1px solid #ECECF2">
        <div style="font:600 10px/1 -apple-system,Segoe UI,Helvetica,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8AA0">Paid today</div>
        <div style="font:700 21px/1.25 -apple-system,Segoe UI,Helvetica,sans-serif;color:#0F6E56;margin-top:7px">${esc(money(recebido))}</div>
        <div style="font:400 12px/1.45 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0;margin-top:4px">${pagasHoje.length} invoice${pagasHoje.length === 1 ? "" : "s"} settled</div>
        ${listaPagas}
      </td></tr>
      ${bloco("Due today", money(soma(vencemHoje)), `${vencemHoje.length} invoice${vencemHoje.length === 1 ? "" : "s"}`)}
      ${bloco("Overdue", money(soma(vencidas)), `${vencidas.length} invoice${vencidas.length === 1 ? "" : "s"} past due`, vencidas.length ? "#C0392B" : "#020040")}
      ${bloco("Total receivable", money(totalAberto), `${abertas.length} open invoice${abertas.length === 1 ? "" : "s"} · drafts excluded`)}
    </table>
  </td></tr>
  <tr><td style="background:#FAFAFC;border-top:1px solid #ECECF2;padding:18px 26px;text-align:center">
    <img src="https://www.getfixfy.com/logos/fixfy-wordmark-navy-trim.png" alt="Fixfy" width="58" style="display:inline-block;width:58px;height:auto;border:0;opacity:.75">
    <div style="font:400 11px/1.5 -apple-system,Segoe UI,Helvetica,sans-serif;color:#9A9AAF;margin-top:9px">
      Zia closes the receivables at 18:00 London. Drafts are never counted: they are work not yet delivered.
    </div>
  </td></tr>
</table></body></html>`;

console.log(`\nFixfy Receivables - ${bonito}`);
console.log(`  pago hoje        ${money(recebido)}  · ${pagasHoje.length} fatura(s)`);
console.log(`  vence hoje       ${money(soma(vencemHoje))}  · ${vencemHoje.length}`);
console.log(`  vencidas         ${money(soma(vencidas))}  · ${vencidas.length}`);
console.log(`  total a receber  ${money(totalAberto)}  · ${abertas.length} em aberto\n`);

const iH = process.argv.indexOf("--html");
if (iH > -1 && process.argv[iH + 1]) { const { writeFileSync } = await import("node:fs"); writeFileSync(process.argv[iH + 1], html); console.log("html em " + process.argv[iH + 1]); }
if (!ENVIAR) { console.log("(modo seco: nada enviado)\n"); process.exit(0); }
const cfg = await q("company_settings", "select=daily_brief_emails&limit=1");
const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
if (!para.length || !env.RESEND_API_KEY) { console.log("sem destinatario ou sem RESEND_API_KEY"); process.exit(1); }
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
  body: JSON.stringify({ from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>", to: para, subject: `Fixfy Receivables - ${bonito}`, html }),
});
console.log(r.ok ? `enviado para ${para.join(", ")}` : `falhou: ${(await r.text()).slice(0, 200)}`);
