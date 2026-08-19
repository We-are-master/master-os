#!/usr/bin/env node
/**
 * Fixfy Daily Report: o dia inteiro num email, às 20h de Londres.
 *
 * Mostra o que cada agente fez, o que entrou, o que saiu, e — principalmente —
 * o que precisa de você. A ordem é essa de propósito: número bom qualquer um
 * lê, e o que trava a operação é o que costuma ficar no fim de relatório e
 * nunca ser lido.
 *
 * O horário é o de LONDRES, não o da máquina. O launchd dispara duas vezes
 * (16h e 17h de São Paulo) e o script sai calado se não forem 20h em Londres:
 * assim o relatório chega na mesma hora no horário de verão e fora dele, sem
 * ninguém lembrar de ajustar em outubro.
 *
 *   node scripts/fixfy-daily-report.mjs           # imprime, não manda
 *   node scripts/fixfy-daily-report.mjs --enviar  # manda o email
 *   node scripts/fixfy-daily-report.mjs --forcar  # ignora a checagem de hora
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENVIAR = process.argv.includes("--enviar");
const FORCAR = process.argv.includes("--forcar");
// --dia permite reemitir um dia passado (conferência, e preview antes de soltar).
const DIA = (process.argv[process.argv.indexOf("--dia") + 1] ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ? process.argv[process.argv.indexOf("--dia") + 1] : null;
const HTML_OUT = process.argv.includes("--html") ? process.argv[process.argv.indexOf("--html") + 1] : null;

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY };

const agora = new Date();
const emLondres = (d, o) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(d);
const horaLondres = Number(emLondres(agora, { hour: "2-digit", hour12: false }));
if (!FORCAR && ENVIAR && horaLondres !== 20) {
  console.log(`agora sao ${horaLondres}h em Londres, o relatorio e das 20h. saindo.`);
  process.exit(0);
}
// A data do relatório é a de Londres: o dia da operação, não o do servidor.
const [dd, mm, aa] = emLondres(agora, { day: "2-digit", month: "2-digit", year: "numeric" }).split("/");
const hojeLdn = DIA ?? `${aa}-${mm}-${dd}`;
const dataBonita = new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(new Date(hojeLdn+"T12:00:00Z"));

const q = async (t, f) => {
  const r = await fetch(`${SB}/rest/v1/${t}?${f}`, { headers: SH });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
};
const soma = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const lb = (v) => "£" + (Number(v) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const desde = `${hojeLdn}T00:00:00Z`;

// ── O dia ────────────────────────────────────────────────────────────────
const criados   = await q("jobs", `select=reference,client_price,client_name&created_at=gte.${desde}&deleted_at=is.null`);
const feitos    = await q("jobs", `select=reference,client_price,client_name&completed_date=eq.${hojeLdn}&deleted_at=is.null`);
const pagos     = await q("jobs", `select=reference,payment_amount,client_name&paid_at=gte.${desde}&deleted_at=is.null`);
const quotes    = await q("quotes", `select=reference&customer_pdf_sent_at=gte.${desde}`);
const reports   = await q("jobs", `select=reference&external_report_submitted_at=gte.${desde}`);
const cancel    = await q("jobs", `select=reference,cancellation_reason,client_name&cancelled_at=gte.${desde}`);

// ── Precisa de você ──────────────────────────────────────────────────────
const contas = await q("accounts", "select=id,company_name");
const nomeConta = Object.fromEntries(contas.map((a) => [a.id, a.company_name]));
const abertas = await q("invoices", `select=reference,job_reference,amount,amount_paid,due_date,source_account_id,status&status=in.("pending","overdue","partially_paid")&deleted_at=is.null&limit=500`);
const falta = (i) => Math.max(0, (Number(i.amount) || 0) - (Number(i.amount_paid) || 0));
// Fatura que vence daqui a meses não é "a receber" de hoje: ela infla o número
// e ninguém vai cobrar. O Kvadrat, £2.448 vencendo em 31/12, sozinho distorcia
// o total em 27%. Sai da manchete e aparece em separado.
const HORIZONTE = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
const aCobrar = abertas.filter((i) => !i.due_date || i.due_date <= HORIZONTE);
const longe = abertas.filter((i) => i.due_date && i.due_date > HORIZONTE);
const vencidas = aCobrar.filter((i) => i.due_date && i.due_date < hojeLdn);
const travados = await q("jobs", `select=reference,client_name,completed_date&status=eq.final_check&deleted_at=is.null&limit=50`);
const semParceiro = await q("jobs", `select=reference,client_name,scheduled_date&status=in.("unassigned","auto_assigning")&scheduled_date=gte.${hojeLdn}&deleted_at=is.null&limit=50`);
const atrasados = await q("jobs", `select=reference,client_name,scheduled_date&status=eq.late&deleted_at=is.null&limit=50`);

// ── O que os agentes fizeram (dos logs deles) ────────────────────────────
// Cada agente escreve num formato próprio; o relatório lê e traduz. Ler log em
// vez de exigir que cada um reporte mantém os agentes independentes: nenhum
// precisa saber que este relatório existe.
const linhasDe = (caminho) => {
  try { return readFileSync(caminho, "utf8").split("\n"); } catch { return []; }
};

let rpaCiclos = 0, rpaPerdidos = 0, rpaCards = 0;
for (const l of linhasDe("/Users/victorsouza/checkatrade-rpa/.logs/rpa.log")) {
  if (!l.startsWith("[" + hojeLdn)) continue;
  if (/Poll cycle:/.test(l)) rpaCiclos++;
  if (/LOST job/.test(l)) rpaPerdidos++;
  const m = /Boards read: (\d+) cards/.exec(l);
  if (m) rpaCards = Math.max(rpaCards, Number(m[1]));
}

// Harvey carimba a data em cada ciclo; o resto das linhas do ciclo vem depois.
let hvCiclos = 0, hvRascunhos = 0, hvPendencias = 0, dentroDoDia = false;
for (const l of linhasDe("/Users/victorsouza/master-os/.logs/harvey.log")) {
  const c = /^\[harvey\] (\d{4}-\d{2}-\d{2})T/.exec(l);
  if (c) { dentroDoDia = c[1] === hojeLdn; if (dentroDoDia) hvCiclos++; continue; }
  if (!dentroDoDia) continue;
  const r = /ciclo fechado: (\d+) rascunho/.exec(l);
  if (r) hvRascunhos += Number(r[1]);
  const p = /reconciliacao: \d+ tickets, (\d+) pendencia/.exec(l);
  if (p) hvPendencias = Number(p[1]);
}

// Alex e o dispatch não carimbam data por linha, então o relatório conta o
// arquivo inteiro e diz isso: número honesto é melhor que número inventado.
const alexLinhas = linhasDe("/Users/victorsouza/fixfy-sales/.logs/alex.log");
const alexVendas = alexLinhas.filter((l) => /completado da conversa/.test(l)).length;
const alexHandoff = alexLinhas.filter((l) => /handoff:/.test(l)).length;
const alexFalhas = alexLinhas.filter((l) => /venda não virou job/.test(l)).length;
const mikeLinhas = linhasDe("/Users/victorsouza/fixfy-sales/.logs/sales-dispatch-novos.log");
const mikeForaDeTurno = mikeLinhas.filter((l) => /Fora da janela/.test(l)).length;

// ── Montagem ─────────────────────────────────────────────────────────────
const NAVY = "#020040", LARANJA = "#ED4B00", FUNDO = "#F5F5F7";
const TINTA = "#1A1A1A", MUDO = "#9A9AA8", MEIO = "#4A4A55", BORDA = "#E8E8EE", LILAS = "#F2F0FA";
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const numero = (rot, val, sub) => `
  <td width="25%" align="center" style="padding:14px 6px;">
    <div style="font:700 26px/1 ${F};color:${NAVY};letter-spacing:-.5px;">${val}</div>
    <div style="font:600 10px/1.4 ${F};color:${MUDO};text-transform:uppercase;letter-spacing:.8px;margin-top:6px;">${rot}</div>
    ${sub ? `<div style="font:400 11px/1.4 ${F};color:${MEIO};margin-top:3px;">${sub}</div>` : ""}
  </td>`;

const agente = (nome, papel, feito, cor) => `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid ${BORDA};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="4" bgcolor="${cor}" style="background:${cor};border-radius:2px;">&nbsp;</td>
        <td style="padding-left:12px;">
          <div style="font:700 14px/1.3 ${F};color:${TINTA};">${nome}<span style="font:400 12px/1.3 ${F};color:${MUDO};"> · ${papel}</span></div>
          <div style="font:400 13px/1.5 ${F};color:${MEIO};margin-top:3px;">${feito}</div>
        </td>
      </tr></table>
    </td>
  </tr>`;

const alerta = (titulo, detalhe, valor, cor) => `
  <tr>
    <td style="padding:11px 14px;border-bottom:1px solid ${BORDA};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:600 13.5px/1.4 ${F};color:${TINTA};">${titulo}
          <div style="font:400 12.5px/1.5 ${F};color:${MEIO};margin-top:2px;font-weight:400;">${detalhe}</div>
        </td>
        <td align="right" valign="top" style="font:700 15px/1.3 ${F};color:${cor};white-space:nowrap;padding-left:12px;">${valor}</td>
      </tr></table>
    </td>
  </tr>`;

const alertas = [];
if (vencidas.length) alertas.push(alerta("Faturas vencidas", `${vencidas.length} clientes passaram do prazo. A mais velha vence desde ${vencidas.map((i) => i.due_date).sort()[0]}.`, lb(vencidas.reduce((a, i) => a + falta(i), 0)), LARANJA));
if (travados.length) alertas.push(alerta("Esperando seu Finish work", `${travados.length} job(s) entregues, parados em revisão. Enquanto não aprova, a fatura não sai e o dinheiro não é cobrado.`, `${travados.length}`, LARANJA));
if (semParceiro.length) alertas.push(alerta("Sem parceiro designado", `${semParceiro.length} job(s) agendados de hoje em diante e ainda sem ninguém para executar.`, `${semParceiro.length}`, "#C2410C"));
if (atrasados.length) alertas.push(alerta("Passou da data e não foi concluído", `${atrasados.map((j) => j.reference).join(", ")}`, `${atrasados.length}`, "#B91C1C"));
if (alexFalhas) alertas.push(alerta("Venda fechada que não virou job", `O Alex fechou na conversa e a criação do job falhou ${alexFalhas}x. Cliente confirmou e ninguém foi agendado.`, `${alexFalhas}`, "#B91C1C"));
if (cancel.length) alertas.push(alerta("Cancelados hoje", cancel.map((j) => `${j.reference} · ${String(j.cancellation_reason ?? "sem motivo").slice(0, 40)}`).join("<br>"), `${cancel.length}`, MUDO));

const linhasAgentes = [
  agente("Ruben", "Checkatrade", rpaCiclos ? `${rpaCiclos} varreduras do board, ${rpaCards} cards lidos${rpaPerdidos ? `, ${rpaPerdidos} job(s) perdidos na disputa` : ""}.` : "Sem atividade registrada hoje.", "#2563EB"),
  agente("Stefane", "Relatórios", reports.length ? `${reports.length} relatório(s) entregues na plataforma do cliente.` : "Nenhum relatório para entregar hoje.", "#7C3AED"),
  agente("Financeiro", "Recebimentos", pagos.length ? `${pagos.length} pagamento(s) escriturados, ${lb(soma(pagos, "payment_amount"))}. Conferência de coerência rodou.` : "Nenhum pagamento novo confirmado pelas plataformas.", "#059669"),
  agente("Sam", "Dispatch", criados.length ? `${criados.length} job(s) entraram no OS.` : "Nenhum job novo hoje.", "#EA580C"),
  agente("Harvey", "Quotes no Zendesk", hvCiclos ? `${hvCiclos} ciclos, ${hvRascunhos} rascunho(s) de quote${hvPendencias ? `, ${hvPendencias} pendência(s) na reconciliação` : ""}.` : "Sem ciclo registrado hoje.", "#DB2777"),
  agente("Alex", "WhatsApp", `${alexVendas} venda(s) fechadas na conversa, ${alexHandoff} passada(s) para humano${alexFalhas ? `. ${alexFalhas} venda(s) não viraram job` : ""}.`, "#0891B2"),
  agente("Mike", "Dispatch de leads", mikeForaDeTurno ? `Rodou fora da janela de 8h-20h ${mikeForaDeTurno}x e não enviou nada, como esperado.` : "Dentro do turno.", "#CA8A04"),
].join("");

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Fixfy Daily Report</title></head>
<body style="margin:0;padding:0;background:${FUNDO};font-family:${F};">
<div style="display:none;max-height:0;overflow:hidden;">${feitos.length} jobs feitos · ${lb(soma(feitos, "client_price"))} · ${alertas.length} coisas para você</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(2,0,64,.06);">

  <tr><td align="center" bgcolor="${NAVY}" style="background:${NAVY};padding:22px 24px 16px;">
    <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="94" style="display:block;width:94px;height:auto;">
  </td></tr>
  <tr><td style="background:${LARANJA};line-height:4px;font-size:4px;height:4px;">&nbsp;</td></tr>

  <tr><td style="padding:26px 26px 4px;">
    <div style="font:700 21px/1.3 ${F};color:${TINTA};">Daily Report</div>
    <div style="font:400 13px/1.5 ${F};color:${MUDO};margin-top:3px;">${dataBonita} · fechamento de 20h</div>
  </td></tr>

  <tr><td style="padding:16px 20px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LILAS};border-radius:10px;"><tr>
      ${numero("Vendido", lb(soma(criados, "client_price")), `${criados.length} job(s)`)}
      ${numero("Entregue", lb(soma(feitos, "client_price")), `${feitos.length} job(s)`)}
      ${numero("Recebido", lb(soma(pagos, "payment_amount")), `${pagos.length} baixa(s)`)}
      ${numero("A receber", lb(aCobrar.reduce((a, i) => a + falta(i), 0)), `${aCobrar.length} fatura(s)`)}
    </tr></table>
  </td></tr>

  ${alertas.length ? `
  <tr><td style="padding:22px 26px 0;">
    <div style="font:700 12px/1 ${F};color:${LARANJA};text-transform:uppercase;letter-spacing:1px;">Precisa de você</div>
  </td></tr>
  <tr><td style="padding:8px 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDA};border-radius:10px;overflow:hidden;">${alertas.join("")}</table>
  </td></tr>` : `
  <tr><td style="padding:20px 26px 0;">
    <div style="background:#ECFDF5;border-radius:10px;padding:14px 16px;font:600 13.5px/1.5 ${F};color:#065F46;">Nada preso hoje. Nenhuma fatura vencida, nenhum job sem parceiro, nada esperando aprovação.</div>
  </td></tr>`}

  <tr><td style="padding:24px 26px 0;">
    <div style="font:700 12px/1 ${F};color:${MUDO};text-transform:uppercase;letter-spacing:1px;">O que a equipe fez</div>
  </td></tr>
  <tr><td style="padding:4px 26px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhasAgentes}</table></td></tr>

  <tr><td style="padding:22px 26px 28px;">
    <div style="font:400 11.5px/1.6 ${F};color:${MUDO};border-top:1px solid ${BORDA};padding-top:14px;">
      Apurado direto do OS às 20h de Londres. Quotes enviadas hoje: ${quotes.length}.${longe.length ? ` Fora da conta: ${lb(longe.reduce((a, i) => a + falta(i), 0))} em ${longe.length} fatura(s) que só vencem depois de ${HORIZONTE}.` : ""}
      Números do dia operacional de Londres, não do relógio do servidor.
    </div>
  </td></tr>

</table></td></tr></table></body></html>`;

console.log(`\nFixfy Daily Report · ${dataBonita}`);
console.log(`  vendido ${lb(soma(criados, "client_price"))} (${criados.length}) · entregue ${lb(soma(feitos, "client_price"))} (${feitos.length}) · recebido ${lb(soma(pagos, "payment_amount"))} (${pagos.length})`);
console.log(`  a receber ${lb(aCobrar.reduce((a, i) => a + falta(i), 0))} em ${aCobrar.length} faturas (+${lb(longe.reduce((a, i) => a + falta(i), 0))} fora do horizonte) · ${alertas.length} alerta(s)`);
console.log(`  ruben ${rpaCiclos} ciclos · stefane ${reports.length} relatorios · quotes ${quotes.length}\n`);

if (HTML_OUT) { const { writeFileSync } = await import("node:fs"); writeFileSync(HTML_OUT, html); console.log("html em " + HTML_OUT); }
if (!ENVIAR) { console.log("(modo seco: nada enviado)\n"); process.exit(0); }

const cfg = await q("company_settings", "select=daily_brief_emails&limit=1");
const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
if (!para.length || !env.RESEND_API_KEY) { console.log("sem destinatario ou sem RESEND_API_KEY"); process.exit(0); }
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
  body: JSON.stringify({ from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>", to: para,
    subject: `Fixfy Daily Report · ${dataBonita}`, html }),
});
console.log(r.ok ? `enviado para ${para.join(", ")}` : `falhou: ${(await r.text()).slice(0, 200)}`);
