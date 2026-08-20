#!/usr/bin/env node
/**
 * Fixfy Daily Report: o dia inteiro num email, às 20h de Londres.
 *
 * A ordem das seções é uma decisão, não um acaso:
 *
 *   1. MARGEM      o número que diz se o dia valeu a pena. Vem primeiro porque
 *                  faturamento alto com margem ruim é dia ruim, e ler só o
 *                  faturamento esconde exatamente isso.
 *   2. O DIA       vendido, na rua, entregue, recebido.
 *   3. NA RUA      job por job do que estava agendado hoje, com parceiro e hora.
 *   4. PRECISA DE VOCÊ   o que trava a operação.
 *   5. OS AGENTES  o que cada um fez, lido do log de cada um.
 *
 * O horário é o de LONDRES, não o da máquina. O launchd dispara duas vezes
 * (16h e 17h de São Paulo) e o script sai calado se não forem 20h em Londres:
 * assim o relatório chega na mesma hora no horário de verão e fora dele, sem
 * ninguém lembrar de ajustar em outubro.
 *
 *   node scripts/fixfy-daily-report.mjs           # imprime, não manda
 *   node scripts/fixfy-daily-report.mjs --enviar  # manda o email
 *   node scripts/fixfy-daily-report.mjs --forcar  # ignora a checagem de hora
 *   node scripts/fixfy-daily-report.mjs --dia 2026-08-19 --html /tmp/r.html
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
const lb0 = (v) => "£" + Math.round(Number(v) || 0).toLocaleString("en-GB");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const desde = `${hojeLdn}T00:00:00Z`;

// Campos de dinheiro em todo job que entra na conta de margem. Uma lista só,
// para vendido e entregue nunca saírem de sintonia por esquecimento.
const DINHEIRO = "reference,client_name,client_price,extras_amount,partner_cost,materials_cost,expenses";

// ── O dia ────────────────────────────────────────────────────────────────
const criados   = await q("jobs", `select=${DINHEIRO}&created_at=gte.${desde}&deleted_at=is.null`);
const feitos    = await q("jobs", `select=${DINHEIRO}&completed_date=eq.${hojeLdn}&deleted_at=is.null`);
const pagos     = await q("jobs", `select=reference,payment_amount,client_name&paid_at=gte.${desde}&deleted_at=is.null`);
const quotes    = await q("quotes", `select=reference&customer_pdf_sent_at=gte.${desde}`);
const reports   = await q("jobs", `select=reference&external_report_submitted_at=gte.${desde}`);
const cancel    = await q("jobs", `select=reference,cancellation_reason,client_name&cancelled_at=gte.${desde}`);
const agenda    = await q("jobs", `select=reference,client_name,partner_name,status,scheduled_start_at,scheduled_end_at,client_price,extras_amount&scheduled_date=eq.${hojeLdn}&deleted_at=is.null&order=scheduled_start_at.asc&limit=60`);

// ── Margem ───────────────────────────────────────────────────────────────
// A conta é a MESMA do Pulse (`src/components/pulse/financials.tsx`, que usa
// `src/lib/pulse-margins.ts`): receita = client_price + extras, custo
// operacional = parceiro + material + despesas. Repetir a fórmula aqui em vez
// de inventar outra é o ponto. Relatório que discorda da tela vira discussão
// sobre qual dos dois está certo, e aí ninguém olha mais nenhum dos dois.
//
// A margem do dia é a do ENTREGUE, não a do vendido: é a que já aconteceu. A do
// vendido aparece do lado, marcada como prevista, porque job que ainda não foi
// executado pode mudar de custo até a visita.
const receitaDe = (js) => soma(js, "client_price") + soma(js, "extras_amount");
const custoDe   = (js) => soma(js, "partner_cost") + soma(js, "materials_cost") + soma(js, "expenses");
/** Porcentagem, ou null quando não há receita: dia sem job não tem margem 0%, tem margem nenhuma. */
const pctDe = (sobra, receita) => (receita > 0 ? (sobra / receita) * 100 : null);

const recEntregue = receitaDe(feitos), custoEntregue = custoDe(feitos);
const margemGbp = recEntregue - custoEntregue;
const margemPct = pctDe(margemGbp, recEntregue);

const recVendido = receitaDe(criados), custoVendido = custoDe(criados);
const margemVendidoGbp = recVendido - custoVendido;
const margemVendidoPct = pctDe(margemVendidoGbp, recVendido);
// Job vendido sem custo de parceiro ainda não tem margem de verdade, tem
// margem otimista. O relatório conta quantos são em vez de fingir que fecham.
const semCusto = criados.filter((j) => !Number(j.partner_cost)).length;

const cfgSetup = await q("company_settings", "select=frontend_setup&limit=1");
const META = Number(cfgSetup?.[0]?.frontend_setup?.target_margin_pct) || 40;

// ── Na rua ───────────────────────────────────────────────────────────────
// "Na rua" é o que estava agendado para hoje e não foi cancelado. Cancelado
// aparece em Precisa de você, não aqui: ninguém saiu para fazer.
const naRua = agenda.filter((j) => j.status !== "cancelled");
const recNaRua = receitaDe(naRua);
const ENTREGUE_ST = new Set(["completed", "awaiting_payment", "final_check"]);
const naRuaFeitos = naRua.filter((j) => ENTREGUE_ST.has(j.status)).length;
const naRuaAndando = naRua.filter((j) => j.status === "in_progress").length;
const naRuaSemGente = naRua.filter((j) => !j.partner_name && !["completed", "awaiting_payment"].includes(j.status)).length;

// ── Precisa de você ──────────────────────────────────────────────────────
const abertas = await q("invoices", `select=reference,job_reference,amount,amount_paid,due_date,status&status=in.("pending","overdue","partially_paid")&deleted_at=is.null&limit=500`);
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

let rpaCiclos = 0, rpaPerdidos = 0, rpaCards = 0, rpaBloqueios = 0;
for (const l of linhasDe("/Users/victorsouza/checkatrade-rpa/.logs/rpa.log")) {
  if (!l.startsWith("[" + hojeLdn)) continue;
  if (/Poll cycle:/.test(l)) rpaCiclos++;
  if (/LOST job/.test(l)) rpaPerdidos++;
  if (/Cloudflare|block #/i.test(l)) rpaBloqueios++;
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

// Zia carimba o turno com [zia] <ISO>; as contas do turno vêm nas linhas
// seguintes, então o corte é o mesmo do Harvey: só lê o que está dentro do dia.
let ziaTurnos = 0, ziaFaturas = 0, ziaSelfBills = 0, ziaIncoerencias = null, noTurno = false;
for (const l of linhasDe("/Users/victorsouza/master-os/.logs/finance.log")) {
  const c = /^\[zia\] (\d{4}-\d{2}-\d{2})T/.exec(l);
  if (c) { noTurno = c[1] === hojeLdn; if (noTurno && /turno iniciado/.test(l)) ziaTurnos++; continue; }
  if (!noTurno) continue;
  const a = /aplicado: (\d+) fatura\(s\) e (\d+) self-bill\(s\)/.exec(l);
  if (a) { ziaFaturas += Number(a[1]); ziaSelfBills += Number(a[2]); }
  const i = /^(\d+) incoerencia\(s\) no a receber/.exec(l);
  if (i) ziaIncoerencias = Number(i[1]);
}

// O log do Alex não carimba data em linha nenhuma. Contar o arquivo inteiro,
// que era o que este relatório fazia, somava todos os ciclos desde o começo do
// log: dava "134 vendas que não viraram job" num dia que teve uma, e essa
// mentira subia para o topo, em Precisa de você. Agora lê só o ÚLTIMO ciclo,
// que é o estado de agora, e o texto diz que é do último ciclo.
//
// O Alex fecha cada ciclo com duas linhas de resumo, e são elas que valem:
//   ── precisa de você (16) ──
//   vendas: 4  (jobs criados: 3 · já existiam: 0 · falharam: 1)
const alexLinhas = linhasDe("/Users/victorsouza/fixfy-sales/.logs/alex.log");
const ultima = (re, campo) => {
  let v = null;
  for (const l of alexLinhas) { const m = re.exec(l); if (m) v = Number(m[campo]); }
  return v;
};
const alexPendencias = ultima(/── precisa de você \((\d+)\)/, 1);
const alexVendas = ultima(/^vendas: (\d+)/, 1) ?? 0;
const alexJobs = ultima(/jobs criados: (\d+)/, 1) ?? 0;
const alexFalhas = ultima(/falharam: (\d+)/, 1) ?? 0;
const iUltimoCiclo = alexLinhas.reduce((acc, l, i) => (/── precisa de você/.test(l) ? i : acc), -1);
const alexHandoff = iUltimoCiclo < 0 ? 0 : alexLinhas.slice(iUltimoCiclo).filter((l) => /handoff:/.test(l)).length;
// O dispatch também não carimba data, e pelo mesmo motivo do Alex o relatório
// lê o ESTADO da última rodada em vez de somar o arquivo. Somando dava "rodou
// fora da janela 607x", que é o log inteiro do mês e não o dia de ninguém.
const mikeLinhas = linhasDe("/Users/victorsouza/fixfy-sales/.logs/sales-dispatch-novos.log");
const mikeUteis = mikeLinhas.filter((l) => /Fora da janela|leads do Checkatrade em clients:/.test(l));
const mikeUltima = mikeUteis[mikeUteis.length - 1] ?? "";
const mikeForaDeTurno = /Fora da janela/.test(mikeUltima);
let mikeLeads = null;
for (const l of mikeLinhas) { const m = /leads do Checkatrade em clients: (\d+)/.exec(l); if (m) mikeLeads = Number(m[1]); }

// ── Montagem ─────────────────────────────────────────────────────────────
const NAVY = "#020040", LARANJA = "#ED4B00", FUNDO = "#EFEFF3";
const TINTA = "#14142B", MUDO = "#9A9AA8", MEIO = "#55556A", BORDA = "#E8E8EE";
const VERDE = "#047857", VERMELHO = "#B91C1C", AMBAR = "#B45309";
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const corDaMargem = margemPct == null ? MUDO : margemPct >= META ? VERDE : margemPct >= META * 0.9 ? AMBAR : VERMELHO;
const selo = margemPct == null ? "sem entrega" : margemPct >= META ? "acima da meta" : margemPct >= META * 0.9 ? "perto da meta" : "abaixo da meta";
// A barra é a margem contra a meta, não contra 100%: 42% numa meta de 40 tem
// que encher a barra, senão o dia bom parece dia pela metade.
const barra = margemPct == null ? 0 : Math.max(2, Math.min(100, Math.round((margemPct / META) * 100)));

const ROTULO = {
  scheduled: ["Agendado", MEIO], in_progress: ["Em execução", "#1D4ED8"], late: ["Atrasado", VERMELHO],
  final_check: ["Revisão", AMBAR], awaiting_payment: ["A cobrar", VERDE], completed: ["Concluído", VERDE],
  on_hold: ["Em espera", AMBAR], unassigned: ["Sem parceiro", VERMELHO], auto_assigning: ["Em leilão", AMBAR],
  need_attention: ["Atenção", VERMELHO],
};
const pill = (st) => {
  const [txt, cor] = ROTULO[st] ?? [st, MUDO];
  return `<span style="display:inline-block;font:600 10.5px/1 ${F};color:${cor};background:${cor}14;border:1px solid ${cor}33;border-radius:20px;padding:4px 8px;white-space:nowrap;">${txt}</span>`;
};
const hora = (iso) => (iso ? String(iso).slice(11, 16) : "--:--");

const tile = (rot, val, sub) => `
  <td width="25%" valign="top" style="padding:16px 10px;border-left:1px solid ${BORDA};">
    <div style="font:600 9.5px/1 ${F};color:${MUDO};text-transform:uppercase;letter-spacing:.9px;">${rot}</div>
    <div style="font:700 21px/1.2 ${F};color:${TINTA};letter-spacing:-.4px;margin-top:8px;">${val}</div>
    <div style="font:400 11.5px/1.4 ${F};color:${MEIO};margin-top:3px;">${sub}</div>
  </td>`;

const linhaNaRua = (j) => `
  <tr>
    <td style="padding:11px 14px;border-top:1px solid ${BORDA};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="46" valign="top" style="font:700 12.5px/1.4 ${F};color:${TINTA};">${hora(j.scheduled_start_at)}</td>
        <td valign="top" style="padding-left:6px;">
          <div style="font:600 13px/1.4 ${F};color:${TINTA};">${esc(j.client_name || "Cliente")}</div>
          <div style="font:400 11.5px/1.5 ${F};color:${MUDO};margin-top:2px;">${esc(j.reference)} · ${esc(j.partner_name || "sem parceiro")}</div>
        </td>
        <td width="88" align="right" valign="top" style="font:700 13px/1.4 ${F};color:${TINTA};white-space:nowrap;">${lb0((Number(j.client_price) || 0) + (Number(j.extras_amount) || 0))}</td>
        <td width="96" align="right" valign="top" style="padding-left:8px;">${pill(j.status)}</td>
      </tr></table>
    </td>
  </tr>`;

const agente = (nome, papel, feito, cor) => `
  <tr>
    <td style="padding:11px 0;border-bottom:1px solid ${BORDA};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="3" bgcolor="${cor}" style="background:${cor};border-radius:2px;">&nbsp;</td>
        <td style="padding-left:12px;">
          <div style="font:700 13.5px/1.3 ${F};color:${TINTA};">${nome}<span style="font:400 11.5px/1.3 ${F};color:${MUDO};"> · ${papel}</span></div>
          <div style="font:400 12.5px/1.55 ${F};color:${MEIO};margin-top:3px;">${feito}</div>
        </td>
      </tr></table>
    </td>
  </tr>`;

const alerta = (titulo, detalhe, valor, cor) => `
  <tr>
    <td style="padding:11px 14px;border-bottom:1px solid ${BORDA};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:600 13px/1.4 ${F};color:${TINTA};">${titulo}
          <div style="font:400 12px/1.5 ${F};color:${MEIO};margin-top:2px;font-weight:400;">${detalhe}</div>
        </td>
        <td align="right" valign="top" style="font:700 14.5px/1.3 ${F};color:${cor};white-space:nowrap;padding-left:12px;">${valor}</td>
      </tr></table>
    </td>
  </tr>`;

const alertas = [];
if (vencidas.length) alertas.push(alerta("Faturas vencidas", `${vencidas.length} clientes passaram do prazo. A mais velha vence desde ${vencidas.map((i) => i.due_date).sort()[0]}.`, lb(vencidas.reduce((a, i) => a + falta(i), 0)), LARANJA));
if (travados.length) alertas.push(alerta("Esperando seu Finish work", `${travados.length} job(s) entregues, parados em revisão. Enquanto não aprova, a fatura não sai e o dinheiro não é cobrado.`, `${travados.length}`, LARANJA));
if (semParceiro.length) alertas.push(alerta("Sem parceiro designado", `${semParceiro.length} job(s) agendados de hoje em diante e ainda sem ninguém para executar.`, `${semParceiro.length}`, "#C2410C"));
if (atrasados.length) alertas.push(alerta("Passou da data e não foi concluído", `${atrasados.map((j) => j.reference).join(", ")}`, `${atrasados.length}`, VERMELHO));
if (alexFalhas) alertas.push(alerta("Venda fechada que não virou job", `No último ciclo do Alex, ${alexFalhas} venda(s) fecharam na conversa e a criação do job falhou. Cliente confirmou e ninguém foi agendado.`, `${alexFalhas}`, VERMELHO));
if (cancel.length) alertas.push(alerta("Cancelados hoje", cancel.map((j) => `${esc(j.reference)} · ${esc(String(j.cancellation_reason ?? "sem motivo").slice(0, 40))}`).join("<br>"), `${cancel.length}`, MUDO));

const linhasAgentes = [
  agente("Sam", "Entrada de jobs", criados.length ? `${criados.length} job(s) entraram no OS, ${lb(recVendido)} vendidos.` : "Nenhum job novo hoje.", "#EA580C"),
  agente("Ruben", "Checkatrade", rpaCiclos ? `${rpaCiclos} varreduras do board, ${rpaCards} cards lidos${rpaPerdidos ? `, ${rpaPerdidos} job(s) perdidos na disputa` : ""}${rpaBloqueios ? `, ${rpaBloqueios} bloqueio(s) do Cloudflare` : ""}.` : "Sem atividade registrada hoje.", "#2563EB"),
  agente("Harvey", "Quotes no Zendesk", hvCiclos ? `${hvCiclos} ciclos, ${hvRascunhos} rascunho(s) de quote${hvPendencias ? `, ${hvPendencias} pendência(s) na reconciliação` : ""}.` : "Sem ciclo registrado hoje.", "#DB2777"),
  agente("Alex", "WhatsApp", `Último ciclo: ${alexVendas} venda(s) fechadas, ${alexJobs} viraram job${alexFalhas ? `, ${alexFalhas} falhou na criação` : ""}. ${alexHandoff} handoff(s) esperando humano${alexPendencias != null ? `, ${alexPendencias} pendência(s) na fila dele` : ""}.`, "#0891B2"),
  agente("Mike", "Dispatch de leads", `Última rodada: ${mikeLeads == null ? "sem leitura de leads" : `${mikeLeads} lead(s) do Checkatrade nos últimos 2 dias`}. ${mikeForaDeTurno ? "Fora da janela de 8h-20h, nada enviado, como esperado." : "Dentro do turno."}`, "#CA8A04"),
  agente("Stefane", "Relatórios", reports.length ? `${reports.length} relatório(s) entregues na plataforma do cliente.` : "Nenhum relatório para entregar hoje.", "#7C3AED"),
  agente("Zia", "Financeiro", ziaTurnos
    ? `Turno rodou. ${ziaFaturas} fatura(s) e ${ziaSelfBills} self-bill(s) promovidos, ${pagos.length} pagamento(s) escriturados (${lb(soma(pagos, "payment_amount"))})${ziaIncoerencias != null ? `, ${ziaIncoerencias} incoerência(s) no a receber` : ""}.`
    : "Turno não rodou hoje.", "#059669"),
].join("");

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Fixfy Daily Report</title></head>
<body style="margin:0;padding:0;background:${FUNDO};font-family:${F};">
<div style="display:none;max-height:0;overflow:hidden;">Margem ${margemPct == null ? "sem entrega" : Math.round(margemPct) + "%"} · ${lb(margemGbp)} · ${naRua.length} job(s) na rua · ${alertas.length} para você</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FUNDO};"><tr><td align="center" style="padding:26px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(2,0,64,.08);">

  <tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:20px 26px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="82" style="display:block;width:82px;height:auto;"></td>
      <td align="right" style="font:600 11px/1.4 ${F};color:rgba(255,255,255,.62);text-transform:uppercase;letter-spacing:1.2px;">Daily Report</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${LARANJA};line-height:3px;font-size:3px;height:3px;">&nbsp;</td></tr>

  <!-- MARGEM: a manchete. Faturamento sem margem esconde dia ruim. -->
  <tr><td style="padding:24px 26px 0;">
    <div style="font:400 12.5px/1.5 ${F};color:${MUDO};">${dataBonita} · fechamento de 20h em Londres</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>
      <td valign="bottom">
        <div style="font:600 10px/1 ${F};color:${MUDO};text-transform:uppercase;letter-spacing:1px;">Margem do dia</div>
        <div style="font:700 38px/1.1 ${F};color:${TINTA};letter-spacing:-1.2px;margin-top:8px;">${lb(margemGbp)}</div>
      </td>
      <td align="right" valign="bottom">
        <div style="font:700 30px/1.1 ${F};color:${corDaMargem};letter-spacing:-.8px;">${margemPct == null ? "--" : Math.round(margemPct) + "%"}</div>
        <div style="font:600 11px/1.4 ${F};color:${corDaMargem};margin-top:4px;">${selo}</div>
      </td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${BORDA};border-radius:6px;"><tr>
      <td width="${barra}%" bgcolor="${corDaMargem}" style="background:${corDaMargem};line-height:6px;font-size:6px;border-radius:6px;">&nbsp;</td>
      <td style="line-height:6px;font-size:6px;">&nbsp;</td>
    </tr></table>
    <div style="font:400 11.5px/1.5 ${F};color:${MEIO};margin-top:8px;">
      ${lb(recEntregue)} entregues menos ${lb(custoEntregue)} de custo operacional (parceiro, material e despesas). Meta do Setup: ${META}%.
    </div>
  </td></tr>

  <!-- O DIA -->
  <tr><td style="padding:22px 20px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDA};border-radius:12px;overflow:hidden;"><tr>
      ${tile("Vendido", lb0(recVendido), `${criados.length} job(s)`).replace(`border-left:1px solid ${BORDA};`, "")}
      ${tile("Na rua", String(naRua.length), naRua.length ? `${lb0(recNaRua)} agendados` : "nada agendado")}
      ${tile("Entregue", lb0(recEntregue), `${feitos.length} job(s)`)}
      ${tile("Recebido", lb0(soma(pagos, "payment_amount")), `${pagos.length} baixa(s)`)}
    </tr></table>
  </td></tr>

  <tr><td style="padding:10px 26px 0;">
    <div style="font:400 11.5px/1.6 ${F};color:${MEIO};">
      <strong style="color:${TINTA};font-weight:600;">Volume de vendas:</strong> ${lb(recVendido)} em ${criados.length} job(s), margem prevista ${lb(margemVendidoGbp)}${margemVendidoPct == null ? "" : ` (${Math.round(margemVendidoPct)}%)`}.${semCusto ? ` ${semCusto} ainda sem custo de parceiro fechado, então a previsão está otimista.` : ""}
      ${aCobrar.length ? `<br><strong style="color:${TINTA};font-weight:600;">A receber:</strong> ${lb(aCobrar.reduce((a, i) => a + falta(i), 0))} em ${aCobrar.length} fatura(s).` : ""}
    </div>
  </td></tr>

  <!-- NA RUA -->
  <tr><td style="padding:24px 26px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:700 11.5px/1 ${F};color:${TINTA};text-transform:uppercase;letter-spacing:1px;">Na rua hoje</td>
      <td align="right" style="font:400 11.5px/1 ${F};color:${MUDO};">${naRua.length ? `${naRuaFeitos} entregues · ${naRuaAndando} em execução${naRuaSemGente ? ` · ${naRuaSemGente} sem parceiro` : ""}` : ""}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:10px 12px 0;">
    ${naRua.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDA};border-top:0;border-radius:12px;overflow:hidden;">${naRua.map(linhaNaRua).join("")}</table>`
      : `<div style="margin:0 14px;background:#F7F7FA;border-radius:10px;padding:14px 16px;font:400 12.5px/1.5 ${F};color:${MEIO};">Nenhum job agendado para hoje.</div>`}
  </td></tr>

  <!-- PRECISA DE VOCÊ -->
  ${alertas.length ? `
  <tr><td style="padding:24px 26px 0;">
    <div style="font:700 11.5px/1 ${F};color:${LARANJA};text-transform:uppercase;letter-spacing:1px;">Precisa de você</div>
  </td></tr>
  <tr><td style="padding:8px 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDA};border-radius:12px;overflow:hidden;">${alertas.join("")}</table>
  </td></tr>` : `
  <tr><td style="padding:20px 26px 0;">
    <div style="background:#ECFDF5;border-radius:10px;padding:14px 16px;font:600 13px/1.5 ${F};color:#065F46;">Nada preso hoje. Nenhuma fatura vencida, nenhum job sem parceiro, nada esperando aprovação.</div>
  </td></tr>`}

  <!-- OS AGENTES -->
  <tr><td style="padding:24px 26px 0;">
    <div style="font:700 11.5px/1 ${F};color:${MUDO};text-transform:uppercase;letter-spacing:1px;">O que cada um fez</div>
  </td></tr>
  <tr><td style="padding:4px 26px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhasAgentes}</table></td></tr>

  <tr><td style="padding:20px 26px 26px;">
    <div style="font:400 11px/1.6 ${F};color:${MUDO};border-top:1px solid ${BORDA};padding-top:14px;">
      Apurado direto do OS às 20h de Londres, no dia operacional de Londres e não no relógio do servidor. Quotes enviadas hoje: ${quotes.length}.${longe.length ? ` Fora da conta do a receber: ${lb(longe.reduce((a, i) => a + falta(i), 0))} em ${longe.length} fatura(s) que só vencem depois de ${HORIZONTE}.` : ""} A margem usa a mesma fórmula do Pulse.
    </div>
  </td></tr>

</table></td></tr></table></body></html>`;

console.log(`\nFixfy Daily Report · ${dataBonita}`);
console.log(`  margem ${lb(margemGbp)} (${margemPct == null ? "--" : Math.round(margemPct) + "%"}, meta ${META}%) sobre ${lb(recEntregue)} entregues`);
console.log(`  vendido ${lb(recVendido)} (${criados.length}) · na rua ${naRua.length} (${lb(recNaRua)}) · entregue ${lb(recEntregue)} (${feitos.length}) · recebido ${lb(soma(pagos, "payment_amount"))} (${pagos.length})`);
console.log(`  a receber ${lb(aCobrar.reduce((a, i) => a + falta(i), 0))} em ${aCobrar.length} faturas (+${lb(longe.reduce((a, i) => a + falta(i), 0))} fora do horizonte) · ${alertas.length} alerta(s)`);
console.log(`  ruben ${rpaCiclos} ciclos · harvey ${hvCiclos} ciclos · stefane ${reports.length} relatorios · zia ${ziaTurnos} turno(s) · quotes ${quotes.length}\n`);

if (HTML_OUT) { const { writeFileSync } = await import("node:fs"); writeFileSync(HTML_OUT, html); console.log("html em " + HTML_OUT); }
if (!ENVIAR) { console.log("(modo seco: nada enviado)\n"); process.exit(0); }

const cfg = await q("company_settings", "select=daily_brief_emails&limit=1");
const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
if (!para.length || !env.RESEND_API_KEY) { console.log("sem destinatario ou sem RESEND_API_KEY"); process.exit(0); }
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
  body: JSON.stringify({ from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>", to: para,
    subject: `Fixfy Daily Report · ${dataBonita} · margem ${margemPct == null ? "--" : Math.round(margemPct) + "%"}`, html }),
});
console.log(r.ok ? `enviado para ${para.join(", ")}` : `falhou: ${(await r.text()).slice(0, 200)}`);
