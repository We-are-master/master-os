/**
 * O relatório do Fixfy: seis números e nada mais.
 *
 *   vendas do dia · faturamento · na rua · pago ao parceiro · sobrou bruto · margem
 *
 * O antigo tinha nove seções e mandava duas vezes por dia. Este roda uma vez,
 * às 18:00 de Londres, e cabe numa tela de telefone.
 *
 * Todo valor sai em libra com o real ao lado, à taxa fixa de 7, que é como o
 * dono lê o número.
 *
 *   node scripts/fixfy-report.mjs                 # hoje, modo seco
 *   node scripts/fixfy-report.mjs --enviar
 *   node scripts/fixfy-report.mjs --semana        # desde segunda
 *   node scripts/fixfy-report.mjs --dia 2026-08-21
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENVIAR = process.argv.includes("--enviar");
const SEMANA = process.argv.includes("--semana");
const iDia = process.argv.indexOf("--dia");
const DIA = iDia > -1 && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[iDia + 1] ?? "") ? process.argv[iDia + 1] : null;

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

/** Câmbio fixo pedido pelo dono. Não é cotação: é a régua com que ele lê. */
const BRL = 7;

const emLondres = (d, o) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(d);
const hojeLdn = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
};
/** Segunda da semana do dia dado, em Londres. */
const segundaDe = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

const fim = DIA ?? hojeLdn();
const ini = SEMANA ? segundaDe(fim) : fim;
const proximo = (() => { const d = new Date(`${fim}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

const q = async (t, f) => {
  const r = await fetch(`${SB}/rest/v1/${t}?${f}`, { headers: SH });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
};
const n = (v) => Number(v) || 0;
const soma = (a, ...ks) => a.reduce((s, r) => s + ks.reduce((x, k) => x + n(r[k]), 0), 0);
/** "£1.234,56 (R$ 8.641,92)" — a libra manda, o real acompanha. */
const money = (v) =>
  `£${n(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
  ` (R$ ${(n(v) * BRL).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CAMPOS = "reference,status,client_price,extras_amount,partner_cost,materials_cost,completed_date,scheduled_date,created_at";
const vivo = (j) => j.status !== "cancelled" && j.status !== "deleted";

// ── Os seis números ───────────────────────────────────────────────────────
// Vendas: o que entrou como trabalho novo. Cancelado fora: um job que morreu no
// mesmo dia nunca foi venda.
const criados = (await q("jobs", `select=${CAMPOS}&created_at=gte.${ini}T00:00:00Z&created_at=lt.${proximo}T00:00:00Z&deleted_at=is.null`)).filter(vivo);
// Faturamento: o que foi entregue. É o dinheiro que já aconteceu.
const feitos = (await q("jobs", `select=${CAMPOS}&completed_date=gte.${ini}&completed_date=lte.${fim}&deleted_at=is.null`)).filter(vivo);
// Na rua: trabalho que de fato começou. `late` é o contrário disso — a janela
// de chegada passou e ninguém começou —, e contá-lo aqui fazia um no-show
// aparecer como equipe trabalhando.
const agenda = (await q("jobs", `select=${CAMPOS}&scheduled_date=gte.${ini}&scheduled_date=lte.${fim}&deleted_at=is.null`)).filter(vivo);
const naRua = agenda.filter((j) => j.status === "in_progress");
// O que estava marcado para o período e não saiu. É o número que pede ação.
const naoSaiu = agenda.filter((j) => ["late", "unassigned", "auto_assigning", "on_hold"].includes(j.status));

const vendas = soma(criados, "client_price", "extras_amount");
const faturado = soma(feitos, "client_price", "extras_amount");
const pago = soma(feitos, "partner_cost", "materials_cost");
const sobrou = Math.round((faturado - pago) * 100) / 100;
const margem = faturado > 0 ? (sobrou / faturado) * 100 : null;
const naRuaValor = soma(naRua, "client_price", "extras_amount");
const naoSaiuValor = soma(naoSaiu, "client_price", "extras_amount");

const lb0 = (v) => "£" + Math.round(n(v)).toLocaleString("en-GB");

const LOGO = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
const LOGO_ESCURO = "https://www.getfixfy.com/logos/fixfy-wordmark-navy-trim.png";

const dLdn = (ymd, o) => emLondres(new Date(ymd + "T12:00:00Z"), o);
const periodo = SEMANA
  ? `${dLdn(ini, { day: "numeric", month: "short" })} – ${dLdn(fim, { day: "numeric", month: "short", year: "numeric" })}`
  : dLdn(fim, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Verde no alvo, âmbar perto, vermelho longe. A cor muda com o resultado, e é
 *  ela que faz o assunto do e-mail dizer algo antes de ser aberto. */
const alvo = 40;
const farol = margem == null ? { cor: "#8A8AA0", bola: "⚪️" }
  : margem >= alvo ? { cor: "#0F6E56", bola: "🟢" }
  : margem >= 25 ? { cor: "#B45309", bola: "🟡" }
  : { cor: "#A32D2D", bola: "🔴" };
const pct = margem == null ? "--" : Math.round(margem) + "%";
const assunto = SEMANA
  ? `${farol.bola} Fixfy week · ${periodo} · ${pct} margin · ${lb0(sobrou)} gross`
  : `${farol.bola} Fixfy · ${periodo} · ${pct} margin · ${lb0(sobrou)} gross`;

const linha = (rot, valor, sub, forte) => `
  <tr>
    <td style="padding:${forte ? "18px 0 6px" : "14px 0"};border-bottom:1px solid #ECECF2">
      <div style="font:600 10px/1 -apple-system,Segoe UI,Helvetica,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8AA0">${esc(rot)}</div>
      <div style="font:700 ${forte ? "26px" : "21px"}/1.25 -apple-system,Segoe UI,Helvetica,sans-serif;color:#020040;margin-top:7px">${esc(valor)}</div>
      ${sub ? `<div style="font:400 12px/1.45 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0;margin-top:4px">${esc(sub)}</div>` : ""}
    </td>
  </tr>`;

const html = `<!doctype html><html><body style="margin:0;background:#F2F2F6;padding:28px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#020040;padding:22px 26px">
    <img src="${LOGO}" alt="Fixfy" width="86" style="display:block;width:86px;height:auto;border:0">
    <div style="font:400 12px/1.4 -apple-system,Segoe UI,Helvetica,sans-serif;color:#9A9AC4;margin-top:12px">
      ${esc(SEMANA ? "Weekly report" : "Daily report")} · ${esc(periodo)}
    </div>
  </td></tr>
  <tr><td style="height:3px;background:${farol.cor}"></td></tr>
  <tr><td style="padding:6px 26px 22px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${linha("Sales", money(vendas), `${criados.length} new job${criados.length === 1 ? "" : "s"}`)}
      ${linha("Delivered", money(faturado), `${feitos.length} job${feitos.length === 1 ? "" : "s"} completed`)}
      ${linha("Paid", money(pago), "partner labour + materials")}
      ${linha("Gross margin", money(sobrou), "delivered minus paid", true)}
      <tr><td style="padding:14px 0 2px">
        <div style="font:700 44px/1 -apple-system,Segoe UI,Helvetica,sans-serif;color:${farol.cor}">${pct}</div>
        <div style="font:400 12px/1.4 -apple-system,Segoe UI,Helvetica,sans-serif;color:#8A8AA0;margin-top:6px">
          ${margem == null ? "no delivered work yet" : margem >= alvo ? `on target · ${alvo}%` : `below the ${alvo}% target`}
        </div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#FAFAFC;border-top:1px solid #ECECF2;padding:18px 26px;text-align:center">
    <img src="${LOGO_ESCURO}" alt="Fixfy" width="58" style="display:inline-block;width:58px;height:auto;border:0;opacity:.75">
    <div style="font:400 11px/1.5 -apple-system,Segoe UI,Helvetica,sans-serif;color:#9A9AAF;margin-top:9px">
      Figures close at 18:00 London. Amounts in GBP, Brazilian real at a fixed rate of ${BRL}.
    </div>
  </td></tr>
</table></body></html>`;

console.log(`\n${assunto}`);
console.log(`  vendas       ${money(vendas)}  · ${criados.length} job(s)`);
console.log(`  delivered    ${money(faturado)}  · ${feitos.length} job(s)`);
console.log(`  na rua       ${money(naRuaValor)}  · ${naRua.length} job(s) em execucao`);
if (naoSaiu.length) console.log(`  nao saiu     ${money(naoSaiuValor)}  · ${naoSaiu.length} job(s): ${naoSaiu.map((j) => j.reference).join(", ")}`);
console.log(`  pago         ${money(pago)}`);
console.log(`  sobrou bruto ${money(sobrou)}`);
console.log(`  margem       ${margem == null ? "--" : Math.round(margem) + "%"}\n`);

const iHtml = process.argv.indexOf("--html");
if (iHtml > -1 && process.argv[iHtml + 1]) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[iHtml + 1], html);
  console.log("html em " + process.argv[iHtml + 1]);
}
if (!ENVIAR) { console.log("(modo seco: nada enviado)\n"); process.exit(0); }
const cfg = await q("company_settings", "select=daily_brief_emails&limit=1");
const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
if (!para.length || !env.RESEND_API_KEY) { console.log("sem destinatario ou sem RESEND_API_KEY"); process.exit(1); }
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
  body: JSON.stringify({
    from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>",
    to: para,
    subject: assunto,
    html,
  }),
});
console.log(r.ok ? `enviado para ${para.join(", ")}` : `falhou: ${(await r.text()).slice(0, 200)}`);
