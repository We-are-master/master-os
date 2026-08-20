#!/usr/bin/env node
/**
 * Recebimentos da Housekeep: lê o extrato quinzenal no Zendesk, escritura no OS
 * e manda as exceções por email.
 *
 * A Housekeep paga por quinzena, e manda UM email por período com o assunto
 * "Your past Housekeep jobs and earnings". Ele é muito melhor que o do
 * Checkatrade: já vem com a tabela item a item.
 *
 *   Hi Fixfy (Cleaning)
 *   ... work you completed in the period Mon 20 Jul – Sun 2 Aug
 *   You earned a total of £2,421.80
 *   You will be paid on Fri 7 Aug
 *   DATE | CUSTOMER | POSTCODE | JOB TYPE | TOTAL
 *   Tue 21 Jul | Marta | SE3 8DS | End-of-tenancy clean | £201.60
 *   ...
 *   Totals £2,401.80
 *   DATE | CUSTOMER | POSTCODE | DESCRIPTION       <- segunda tabela, ajustes
 *   ... SE1 3DN_adding payment for problems with access_230726 | £20.00
 *
 * Não há id de job no email, mas POSTCODE + VALOR EXATO identifica sozinho:
 * verificado nos 13 itens da quinzena de 20/07 a 02/08, 13 casaram com um
 * único job cada. Quando casar com mais de um, vai para o email em vez de
 * escolher.
 *
 * O total do cabeçalho é conferência embutida: soma dos itens mais os ajustes
 * tem que dar nele. Se não der, o parser perdeu linha e o email avisa.
 *
 *   node scripts/housekeep-earnings.mjs              # relatório, não escreve
 *   node scripts/housekeep-earnings.mjs --aplicar    # escritura e manda email
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const APLICAR = process.argv.includes("--aplicar");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const ZAUTH = "Basic " + Buffer.from(`${env.ZENDESK_EMAIL}/token:${env.ZENDESK_API_TOKEN}`).toString("base64");
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY };
const SHW = { ...SH, "content-type": "application/json", prefer: "return=representation" };

const zd = async (p) => (await fetch(`https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/${p}`, { headers: { authorization: ZAUTH } })).json();
const fmt = (v) => (v == null ? "?" : "£" + Number(v).toFixed(2));
const val = (s) => { const n = parseFloat(String(s ?? "").replace(/[£,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const semEspaco = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();
const PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** "Fri 7 Aug" + o ano do ticket -> 2026-08-07. */
function dataDe(txt, ano) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(String(txt ?? ""));
  if (!m) return null;
  const mes = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase().slice(0, 3));
  if (mes < 0) return null;
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

async function main() {
  const L = [];

  // ─── Extratos ─────────────────────────────────────────────────────────────
  const r = await zd(`search.json?query=${encodeURIComponent('type:ticket subject:"past Housekeep jobs and earnings"')}&per_page=100`);
  const vistos = new Set();
  const extratos = [];
  for (const t of (r.results ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const b = String((await zd(`tickets/${t.id}/comments.json`)).comments?.[0]?.plain_body ?? "")
      .split("\n").map((s) => s.trim()).filter((l) => l && !/^[͏\s‌­]+$/.test(l));
    const ano = t.created_at.slice(0, 4);
    const total = val(/total of\s*£\s*([\d,]+\.?\d*)/i.exec(b.join(" "))?.[1]);
    const pagoEm = dataDe(/paid on\s+(.+?)$/im.exec(b.join("\n"))?.[1], ano);
    // A Housekeep manda o mesmo extrato em dois tickets, igual ao Checkatrade.
    const chave = `${pagoEm}|${total}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const itens = [];
    let k = b.indexOf("TOTAL") + 1;
    for (; k > 0 && k + 4 < b.length; k += 5) {
      if (!PC.test(b[k + 2])) break;
      itens.push({ dia: b[k], cliente: b[k + 1], pc: semEspaco(b[k + 2]), tipo: b[k + 3], valor: val(b[k + 4]) });
    }
    // Segunda tabela: ajustes. Não têm job próprio — entram no valor pago mas
    // não dão baixa em nada. Podem somar (compensação por acesso, +£20) ou
    // subtrair (`Deduction (Quality issue)`, -£275), e o sinal vem no texto.
    //
    // As duas contas escrevem essa tabela de jeitos diferentes: a de limpeza
    // usa "SE1 3DN_adding payment..._230726" e a de trades usa
    // "Deduction (Quality issue)". Por isso o parser não procura formato de
    // descrição nenhum: pega toda linha que é dinheiro e usa a linha anterior
    // como rótulo, parando no "Total" que fecha a tabela.
    const ajustes = [];
    const iTot = b.indexOf("Totals", Math.max(k - 1, 0));
    if (iTot > 0) {
      for (let m = iTot + 2; m < b.length; m++) {
        if (b[m] === "Total") break;
        // Exigir o símbolo da moeda: a descrição da conta de limpeza termina
        // num carimbo de data ("..._230726") que, sem isto, entra como um
        // ajuste de duzentos e sessenta mil libras.
        if (!/£/.test(b[m])) continue;
        const v = val(b[m]);
        if (v == null || /£/.test(b[m - 1])) continue;
        ajustes.push({ texto: b[m - 1], valor: v });
      }
    }
    extratos.push({ ticket: String(t.id), periodo: b.slice(2, 5).join(" "), total, pagoEm, itens, ajustes });
  }

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  const jobs = await (await fetch(
    `${SB}/rest/v1/jobs?select=id,reference,client_name,property_address,scheduled_date,client_price,payment_status,status,invoice_id&deleted_at=is.null&limit=3000`,
    { headers: SH },
  )).json();

  let totalGeral = 0, baixas = 0, somaBaixas = 0;
  const pendentes = [], invoiceAberta = [], naoFecharam = [];

  for (const e of extratos) {
    const somaItens = e.itens.reduce((a, i) => a + (i.valor ?? 0), 0);
    const somaAjustes = e.ajustes.reduce((a, i) => a + (i.valor ?? 0), 0);
    const confere = e.total != null && Math.abs(somaItens + somaAjustes - e.total) < 0.02;
    totalGeral += e.total ?? 0;

    L.push("");
    L.push(`QUINZENA paga em ${e.pagoEm ?? "?"} — ${fmt(e.total)} (${e.itens.length} jobs ${fmt(somaItens)}${e.ajustes.length ? ` + ${e.ajustes.length} ajuste(s) ${fmt(somaAjustes)}` : ""})` +
      (confere ? "" : "   <<< NAO ESCRITURADA: a soma dos itens nao bate com o total do email"));

    // A aritmética do próprio extrato é a trava. Se a soma das linhas não dá o
    // total que a Housekeep declara, o parser perdeu ou inventou linha — e
    // escriturar a partir dali é marcar como pago um job cujo valor eu não sei
    // ler direito. Extrato que não fecha vira exceção, não lançamento.
    if (!confere) {
      naoFecharam.push({ pagoEm: e.pagoEm, total: e.total, itens: e.itens.length, soma: somaItens + somaAjustes });
      continue;
    }

    for (const it of e.itens) {
      const cand = jobs.filter((j) => semEspaco(j.property_address).includes(it.pc) && Math.abs(Number(j.client_price) - it.valor) < 0.01);
      if (cand.length !== 1) {
        pendentes.push({ ...it, pagoEm: e.pagoEm, quantos: cand.length });
        L.push(`  ${it.dia.padEnd(11)} ${it.pc.padEnd(9)} ${fmt(it.valor).padStart(9)}  ${cand.length ? cand.length + " candidatos" : "nao achou job"}`);
        continue;
      }
      const job = cand[0];
      if (job.payment_status === "paid") continue;

      // Se a invoice pede mais do que a Housekeep pagou, o job NÃO está pago —
      // está parcialmente pago, e o campo não tem esse estado (só unpaid/paid).
      // Marcar "paid" aqui apagaria a diferença do a receber e criaria a
      // cobrança falsa ao contrário: o job diz quitado, a invoice diz que falta.
      // Melhor deixar os dois abertos e mandar o caso, que é dinheiro de verdade
      // faltando, não ruído.
      if (job.invoice_id) {
        const pre = (await (await fetch(`${SB}/rest/v1/invoices?select=reference,status,amount&id=eq.${job.invoice_id}`, { headers: SH })).json())[0];
        if (pre && pre.status !== "paid" && Number(pre.amount) - it.valor > 0.01) {
          invoiceAberta.push({ job: job.reference, inv: pre.reference, valor: Number(pre.amount), recebido: it.valor });
          L.push(`  ${it.dia.padEnd(11)} ${it.pc.padEnd(9)} ${fmt(it.valor).padStart(9)}  ${job.reference}  PARCIAL: invoice pede ${fmt(pre.amount)}`);
          continue;
        }
      }

      if (APLICAR) {
        // Mesma regra do Checkatrade: recebido fecha o job na hora. Só de
        // `awaiting_payment`, nunca de `final_check`, que ainda deve relatório.
        const fecha = job.status === "awaiting_payment" ? { status: "completed" } : {};
        await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`, {
          method: "PATCH", headers: SHW,
          body: JSON.stringify({ ...fecha, payment_status: "paid", finance_status: "paid", payment_amount: it.valor, paid_at: (e.pagoEm ?? new Date().toISOString().slice(0, 10)) + "T12:00:00Z" }),
        });
        // A invoice fecha junto, sempre. Fechar o job e deixar a invoice viva
        // é o que faz o "Ready to receive" cobrar quem ja pagou.
        if (job.invoice_id) {
          const inv = (await (await fetch(`${SB}/rest/v1/invoices?select=id,reference,status,amount&id=eq.${job.invoice_id}`, { headers: SH })).json())[0];
          if (inv && inv.status !== "paid") {
            if (Math.abs(Number(inv.amount) - it.valor) < 0.01) {
              await fetch(`${SB}/rest/v1/invoices?id=eq.${inv.id}`, {
                method: "PATCH", headers: SHW,
                body: JSON.stringify({ status: "paid", amount_paid: it.valor, paid_date: e.pagoEm }),
              });
            } else {
              invoiceAberta.push({ job: job.reference, inv: inv.reference, valor: Number(inv.amount), recebido: it.valor });
            }
          }
        }
      }
      job.payment_status = "paid";
      baixas++; somaBaixas += it.valor;
      L.push(`  ${it.dia.padEnd(11)} ${it.pc.padEnd(9)} ${fmt(it.valor).padStart(9)}  ${job.reference}  ${APLICAR ? "BAIXA DADA" : "a dar baixa"}`);
    }
    for (const a of e.ajustes) L.push(`  ajuste: ${a.texto.slice(0, 66)} ${fmt(a.valor)}  (nao tem job proprio)`);
  }

  L.unshift(`Extratos lidos: ${extratos.length} quinzena(s), ${fmt(totalGeral)} no total`);
  L.unshift(`Baixa ${APLICAR ? "dada" : "a dar"}: ${baixas} job(s), ${fmt(somaBaixas)}`);

  if (naoFecharam.length) {
    L.push("", "EXTRATOS QUE NAO FECHAM (nao escriturados, precisam de voce):");
    for (const n of naoFecharam) L.push(`  pago em ${n.pagoEm}  o email diz ${fmt(n.total)} mas as ${n.itens} linhas somam ${fmt(n.soma)}  (diferenca ${fmt(n.total - n.soma)})`);
  }
  if (pendentes.length) {
    L.push("", "ITENS SEM JOB UNICO (precisam de voce):");
    for (const p of pendentes) L.push(`  pago em ${p.pagoEm}  ${p.dia}  ${p.pc}  ${fmt(p.valor)}  ${p.tipo}  [${p.quantos ? p.quantos + " candidatos" : "nenhum job com esse postcode e valor"}]`);
  }
  if (invoiceAberta.length) {
    L.push("", "JOB PAGO MAS INVOICE MAIOR (fica aberta, precisa de voce):");
    for (const i of invoiceAberta) L.push(`  ${i.job}  ${i.inv}  invoice ${fmt(i.valor)} contra ${fmt(i.recebido)}`);
  }
  if (!APLICAR) L.push("", "(modo seco: nada foi gravado)");

  const texto = L.join("\n");
  console.log("\n" + texto + "\n");

  if (APLICAR && env.RESEND_API_KEY && (baixas || pendentes.length || invoiceAberta.length)) {
    const cfg = await (await fetch(`${SB}/rest/v1/company_settings?select=daily_brief_emails&limit=1`, { headers: SH })).json();
    const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
    if (para.length) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>",
          to: para,
          subject: `Housekeep: ${baixas} baixa(s), ${pendentes.length + invoiceAberta.length} pendencia(s)`,
          text: texto + "\n\n-- \nAgente de recebimentos da Housekeep. As pendencias acima nao foram lancadas.",
        }),
      });
      console.log(res.ok ? `email enviado para ${para.join(", ")}` : `falha no email: ${(await res.text()).slice(0, 160)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
