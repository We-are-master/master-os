#!/usr/bin/env node
/**
 * ZIA — o fecho do turno: quem pagou, onde entrou a baixa, e quem ainda deve.
 *
 * O launchd de finance chama este arquivo desde que o turno existe, e ele
 * NUNCA EXISTIU: toda rodada terminava em MODULE_NOT_FOUND e o relatório do
 * dia morria calado (descoberto em 27/08/2026 varrendo o finance.log). O
 * turno trabalhava — promover, Checkatrade, Housekeep, coerência — e ninguém
 * ficava sabendo o resultado.
 *
 * O email responde as três perguntas do dono, nesta ordem:
 *
 *   1. Alguém pagou? Quem, quanto, por onde (Stripe ou banco/manual).
 *   2. A baixa entrou onde? O JOB de cada pagamento e o TICKET que confirma
 *      o recebimento daquele cliente, com link direto pro agente do Zendesk.
 *   3. Quanto está inadimplente? Vencidas por idade (1-7, 8-14, 15+ dias).
 *      Draft NÃO conta — draft é trabalho não entregue, não é dívida
 *      (a regra que custou reportar £13.810 onde eram £5.158).
 *
 *   node scripts/zia-report.mjs             # imprime, não manda
 *   node scripts/zia-report.mjs --enviar    # manda para daily_brief_emails
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
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* ok */ }
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}` };
const q = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: SH });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`${p.split("?")[0]} -> ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};

const fmt = (n) => `£${Number(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hojeISO = new Date().toISOString().slice(0, 10);

/**
 * Janela de 24h e não "hoje em Londres": o turno roda uma vez por dia e um
 * pagamento das 23h de ontem não pode cair no buraco entre duas rodadas.
 * A sobreposição eventual repete uma linha num email informativo — barato.
 */
const HORAS = Number(process.env.ZIA_WINDOW_HOURS ?? 24); // só para ensaio/backfill
const desde = new Date(Date.now() - HORAS * 3600e3);
const desdeData = desde.toISOString().slice(0, 10);

// ─── 1+2 · Quem pagou, e onde a baixa entrou ────────────────────────────────
const pagas = await q(
  `invoices?select=reference,client_name,job_reference,amount,amount_paid,status,paid_date,last_payment_date,stripe_paid_at,stripe_payment_intent_id,invoice_kind` +
  `&deleted_at=is.null&or=(paid_date.gte.${desdeData},last_payment_date.gte.${desdeData},stripe_paid_at.gte.${desde.toISOString()})&limit=100`,
);

// O ticket que confirma o recebimento: vem do job da invoice.
const refs = [...new Set(pagas.map((i) => i.job_reference).filter(Boolean))];
const ticketPorJob = new Map();
const statusPorJob = new Map();
if (refs.length) {
  const jobs = await q(
    `jobs?select=reference,external_source,external_ref,payment_status,status&reference=in.(${encodeURIComponent(`"${refs.join('","')}"`)})`,
  );
  for (const j of jobs) {
    if (j.external_source === "zendesk" && j.external_ref) ticketPorJob.set(j.reference, j.external_ref);
    statusPorJob.set(j.reference, j.payment_status ?? j.status);
  }
}
const zd = env.ZENDESK_SUBDOMAIN ? `https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/` : null;

// ─── 3 · Inadimplência com idade (draft NUNCA entra) ────────────────────────
const abertas = await q(
  `invoices?select=reference,client_name,job_reference,amount,amount_paid,status,due_date` +
  `&deleted_at=is.null&status=in.(pending,overdue,partially_paid)&due_date=lt.${hojeISO}&order=due_date.asc&limit=500`,
);
const idade = (d) => Math.floor((Date.now() - new Date(`${d}T12:00:00Z`).getTime()) / 86_400_000);
const falta = (i) => Number(i.amount ?? 0) - Number(i.amount_paid ?? 0);
const faixas = [
  { nome: "1–7 days overdue", min: 1, max: 7, linhas: [] },
  { nome: "8–14 days overdue", min: 8, max: 14, linhas: [] },
  { nome: "15+ days overdue", min: 15, max: 99999, linhas: [] },
];
for (const i of abertas) {
  const d = idade(i.due_date);
  const f = faixas.find((f) => d >= f.min && d <= f.max);
  if (f) f.linhas.push({ ...i, dias: d });
}
const totalVencido = abertas.reduce((a, i) => a + falta(i), 0);
const totalRecebido = pagas.reduce((a, i) => a + Number(i.amount_paid ?? i.amount ?? 0), 0);

// ─── Texto (console + corpo alternativo do email) ───────────────────────────
const L = [];
L.push(`ZIA · ${hojeISO}`);
L.push("");
L.push(`RECEIVED (last ${HORAS}h): ${pagas.length} payment(s) · ${fmt(totalRecebido)}`);
for (const i of pagas) {
  const via = i.stripe_payment_intent_id || i.stripe_paid_at ? "Stripe" : "bank/manual";
  const tk = ticketPorJob.get(i.job_reference);
  L.push(
    `  ${i.client_name ?? "?"} · ${fmt(i.amount_paid ?? i.amount)} · ${via}` +
    ` · settled on ${i.job_reference ?? "?"} (${i.reference})` +
    (tk ? ` · confirmed by ticket #${tk}` : " · no ticket on the job"),
  );
}
if (!pagas.length) L.push("  nobody paid in the window.");
L.push("");
L.push(`OUTSTANDING (past due, drafts excluded): ${abertas.length} invoice(s) · ${fmt(totalVencido)}`);
for (const f of faixas) {
  if (!f.linhas.length) continue;
  L.push(`  ${f.nome}: ${f.linhas.length} · ${fmt(f.linhas.reduce((a, i) => a + falta(i), 0))}`);
  for (const i of f.linhas) L.push(`    ${i.client_name ?? "?"} · ${i.job_reference ?? "?"} · ${fmt(falta(i))} · due ${i.due_date} (${i.dias}d)`);
}
const texto = L.join("\n");
console.log("\n" + texto + "\n");

// ─── HTML no padrão da casa (navy + laranja, selo antes de qualquer leitura) ─
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const F = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const linhaPagto = (i) => {
  const via = i.stripe_payment_intent_id || i.stripe_paid_at ? "Stripe" : "bank / manual";
  const tk = ticketPorJob.get(i.job_reference);
  return `<tr>
    <td style="padding:8px 10px 8px 0; ${F}; font-size:13px; color:#0A0A1F; border-bottom:1px solid #E4E4EC;"><strong>${esc(i.client_name ?? "?")}</strong></td>
    <td style="padding:8px 10px 8px 0; ${F}; font-size:13px; color:#12704F; border-bottom:1px solid #E4E4EC; white-space:nowrap;"><strong>${fmt(i.amount_paid ?? i.amount)}</strong></td>
    <td style="padding:8px 10px 8px 0; ${F}; font-size:12px; color:#3A3A55; border-bottom:1px solid #E4E4EC;">${via}</td>
    <td style="padding:8px 10px 8px 0; ${F}; font-size:12px; color:#3A3A55; border-bottom:1px solid #E4E4EC; white-space:nowrap;">${esc(i.job_reference ?? "?")}<br><span style="color:#6B6B85;">${esc(i.reference)}</span></td>
    <td style="padding:8px 0; ${F}; font-size:12px; border-bottom:1px solid #E4E4EC;">${
      ticketPorJob.get(i.job_reference)
        ? (zd ? `<a href="${zd}${esc(tk)}" style="color:#020040;">#${esc(tk)}</a>` : `#${esc(tk)}`)
        : `<span style="color:#A32D2D;">no ticket</span>`
    }</td>
  </tr>`;
};
const blocoFaixa = (f) =>
  !f.linhas.length ? "" : `
  <p style="margin:14px 0 4px; ${F}; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:${f.min >= 15 ? "#A32D2D" : f.min >= 8 ? "#92400E" : "#6B6B85"};">${f.nome} · ${fmt(f.linhas.reduce((a, i) => a + falta(i), 0))}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${f.linhas
    .map((i) => `<tr>
      <td style="padding:6px 10px 6px 0; ${F}; font-size:13px; color:#0A0A1F; border-bottom:1px solid #E4E4EC;">${esc(i.client_name ?? "?")}</td>
      <td style="padding:6px 10px 6px 0; ${F}; font-size:12px; color:#3A3A55; border-bottom:1px solid #E4E4EC;">${esc(i.job_reference ?? "?")}</td>
      <td style="padding:6px 10px 6px 0; ${F}; font-size:13px; color:#0A0A1F; border-bottom:1px solid #E4E4EC; white-space:nowrap;"><strong>${fmt(falta(i))}</strong></td>
      <td style="padding:6px 0; ${F}; font-size:12px; color:#6B6B85; border-bottom:1px solid #E4E4EC; white-space:nowrap;">due ${esc(i.due_date)} · ${i.dias}d</td>
    </tr>`)
    .join("")}</table>`;

const html = `<!DOCTYPE html><html lang="en"><body style="margin:0; background:#F0F0F5; padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px; width:100%; background:#FFFFFF; border-radius:12px; overflow:hidden;">
  <tr><td style="background:#020040; padding:18px 28px;">
    <p style="margin:0; ${F}; font-size:15px; font-weight:700; color:#FFFFFF;">Zia · money in <span style="color:rgba(255,255,255,.6); font-weight:400;">· ${hojeISO}</span></p>
  </td></tr>
  <tr><td style="padding:22px 28px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#020040; border-radius:10px;"><tr>
      <td align="center" style="padding:12px 6px;"><p style="margin:0; ${F}; font-size:17px; font-weight:700; color:#FFFFFF;">${fmt(totalRecebido)}</p><p style="margin:1px 0 0; ${F}; font-size:10px; letter-spacing:.5px; text-transform:uppercase; color:rgba(255,255,255,.65);">Received ${HORAS}h</p></td>
      <td align="center" style="padding:12px 6px; border-left:1px solid rgba(255,255,255,.14);"><p style="margin:0; ${F}; font-size:17px; font-weight:700; color:#FFFFFF;">${pagas.length}</p><p style="margin:1px 0 0; ${F}; font-size:10px; letter-spacing:.5px; text-transform:uppercase; color:rgba(255,255,255,.65);">Payment${pagas.length === 1 ? "" : "s"}</p></td>
      <td align="center" style="padding:12px 6px; border-left:1px solid rgba(255,255,255,.14);"><p style="margin:0; ${F}; font-size:17px; font-weight:700; color:#ED4B00;">${fmt(totalVencido)}</p><p style="margin:1px 0 0; ${F}; font-size:10px; letter-spacing:.5px; text-transform:uppercase; color:rgba(255,255,255,.65);">Past due</p></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 28px 4px;">
    <p style="margin:0 0 6px; ${F}; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#12704F;">Received · who paid and where it settled</p>
    ${pagas.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${["Client", "Amount", "Via", "Settled on", "Ticket"].map((h) => `<th align="left" style="padding:0 10px 5px 0; ${F}; font-size:10px; letter-spacing:.6px; text-transform:uppercase; color:#6B6B85; border-bottom:1px solid #E4E4EC;">${h}</th>`).join("")}</tr>
      ${pagas.map(linhaPagto).join("")}
    </table>` : `<p style="margin:4px 0 0; ${F}; font-size:13px; color:#6B6B85;">Nobody paid in the last 24 hours.</p>`}
  </td></tr>
  <tr><td style="padding:18px 28px 8px;">
    <p style="margin:0; ${F}; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#A32D2D;">Outstanding · past due, drafts excluded</p>
    ${abertas.length ? faixas.map(blocoFaixa).join("") : `<p style="margin:4px 0 0; ${F}; font-size:13px; color:#6B6B85;">Nothing past due. Clean slate.</p>`}
  </td></tr>
  <tr><td style="background:#F7F7FB; padding:14px 28px; border-top:1px solid #E4E4EC;">
    <p style="margin:0; ${F}; font-size:11px; line-height:17px; color:#6B6B85;">Zia runs the finance shift daily: period close, Checkatrade payments, Housekeep payouts, coherence check, then this report. Drafts never count as receivables.</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

// ─── Envio ──────────────────────────────────────────────────────────────────
if (!ENVIAR) {
  const saida = process.env.ZIA_HTML_OUT?.trim();
  if (saida) { (await import("node:fs")).writeFileSync(saida, html); console.log(`html: ${saida}`); }
  console.log("(ensaio: nada enviado. rode com --enviar)");
  process.exit(0);
}
if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY ausente");
const cfg = await q("company_settings?select=daily_brief_emails&limit=1");
const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
if (!para.length) throw new Error("company_settings.daily_brief_emails vazio");

const assunto = pagas.length
  ? `Zia: ${fmt(totalRecebido)} received (${pagas.length}) · ${fmt(totalVencido)} past due`
  : `Zia: no payments today · ${fmt(totalVencido)} past due`;

const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
  body: JSON.stringify({
    from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>",
    to: para,
    subject: assunto,
    html,
    text: texto,
  }),
});
console.log(r.ok ? `email enviado para ${para.join(", ")}` : `falha no email: ${(await r.text()).slice(0, 200)}`);
