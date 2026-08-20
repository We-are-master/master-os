#!/usr/bin/env node
/**
 * Recebimentos do Checkatrade: lê o Zendesk, escritura no OS e manda as
 * exceções por email. Roda todo dia.
 *
 * O dinheiro chega em DUAS camadas, e tratá-las como uma só é o erro que faz
 * o caixa não fechar:
 *
 *   "You got paid by <nome>"   -> CRÉDITO no saldo. Discriminado: id do job,
 *                                 bruto, taxa, líquido, transaction id.
 *   "Your money is on the way" -> REPASSE do saldo para o banco. Só o total,
 *                                 sem quebra nenhuma. É a linha do extrato.
 *
 * Um repasse é a soma dos créditos desde o repasse anterior (verificado: o
 * repasse de 04/08 de £809,50 é exatamente £660,00 + £149,50, os dois créditos
 * do Hind Sebti). Por isso a baixa por job sai SEMPRE do crédito. O repasse
 * entra no email só para conferir contra o banco.
 *
 * Três coisas que este script não faz de propósito:
 *
 *   1. Não usa modelo de linguagem para ler valor. Os campos são rotulados
 *      ("Total you received", "Transaction ID"), então regex é exata e de
 *      graça. LLM em caminho de dinheiro é lento, custa e pode alucinar número.
 *   2. Não escolhe entre dois jobs quando o nome do cliente casa com mais de
 *      um. Isso vai para o email como exceção. Chutar aqui é lançar dinheiro
 *      no job errado com 50% de chance.
 *   3. Não marca pago por email recebido, e sim quando a SOMA dos créditos
 *      fecha com o client_price. Pagamento parcial existe.
 *
 *   node scripts/checkatrade-payments.mjs              # relatório, não escreve
 *   node scripts/checkatrade-payments.mjs --aplicar    # escritura e manda email
 *   node scripts/checkatrade-payments.mjs --aplicar --desde 2026-05-01
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const APLICAR = process.argv.includes("--aplicar");
const DESDE = (process.argv[process.argv.indexOf("--desde") + 1] ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
  ? process.argv[process.argv.indexOf("--desde") + 1]
  : null;

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const falta = ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "SERVICE_ROLE_KEY"]
  .filter((k) => !env[k]);
if (falta.length) {
  console.error("faltam variaveis no .env.local: " + falta.join(", "));
  process.exit(1);
}

const ZAUTH = "Basic " + Buffer.from(`${env.ZENDESK_EMAIL}/token:${env.ZENDESK_API_TOKEN}`).toString("base64");
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY };
const SHW = { ...SH, "content-type": "application/json", prefer: "return=representation" };

const zd = async (p) => (await fetch(`https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/${p}`, { headers: { authorization: ZAUTH } })).json();
const fmt = (v) => (v == null ? "?" : "£" + Number(v).toFixed(2));
const num = (s) => (s == null ? null : (Number.isFinite(parseFloat(String(s).replace(/[£,\s]/g, ""))) ? parseFloat(String(s).replace(/[£,\s]/g, "")) : null));

/**
 * A busca do Zendesk corta em 1000 resultados, e o Checkatrade manda centenas
 * de "job offer" por mês. Fatiar por mês mantém cada janela bem abaixo do teto.
 */
async function buscarPorAssunto(assunto, desde) {
  const inicio = new Date(desde + "T00:00:00Z");
  const hoje = new Date();
  const janelas = [];
  for (let d = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)); d <= hoje; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const a = new Date(d), b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    janelas.push([a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]);
  }
  const vistos = new Map();
  for (const [de, ate] of janelas) {
    for (let pag = 1; pag <= 10; pag++) {
      const q = `type:ticket subject:"${assunto}" created>${de} created<${ate}`;
      const r = await zd(`search.json?query=${encodeURIComponent(q)}&per_page=100&page=${pag}`);
      for (const t of r.results ?? []) vistos.set(t.id, t);
      if (!r.next_page) break;
    }
  }
  return [...vistos.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

const corpoDe = async (id) => {
  const c = await zd(`tickets/${id}/comments.json`);
  return String(c.comments?.[0]?.plain_body ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
};
const depois = (b, rot) => { const i = b.indexOf(rot); return i >= 0 ? b[i + 1] : null; };

async function main() {
  const desde = DESDE ?? new Date(Date.now() - 120 * 86400e3).toISOString().slice(0, 10);
  const aviso = [];

  // ─── Créditos ─────────────────────────────────────────────────────────────
  const creditos = [];
  for (const t of await buscarPorAssunto("You got paid by", desde)) {
    const b = await corpoDe(t.id);
    const j = b.join(" ");
    const iTaxa = b.findIndex((l) => /^Payment processing fee/i.test(l));
    creditos.push({
      ticket: String(t.id),
      criado: t.created_at,
      cliente: (/You got paid by\s+(.+?)\s*$/m.exec(b[0] ?? "")?.[1] ?? "").trim() || null,
      externo: /Payment for job\s+([a-z0-9]{18,})/i.exec(j)?.[1] ?? null,
      net: num(depois(b, "Total you received")) ?? num(/received\s*£\s*([\d,]+\.?\d*)/i.exec(j)?.[1]),
      gross: num(depois(b, "Customer paid")),
      fee: iTaxa >= 0 ? num(b[iTaxa + 1]) : null,
      txid: depois(b, "Transaction ID"),
      pagoEm: depois(b, "Paid on"),
    });
  }
  // Cada email chega repetido (já vimos o mesmo repasse em três tickets).
  const vistos = new Set();
  const unicos = creditos.filter((c) => {
    const k = c.txid || `${c.criado.slice(0, 10)}|${c.cliente}|${c.net}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    c.chave = k;
    return true;
  });

  // ─── Repasses ─────────────────────────────────────────────────────────────
  const repVistos = new Set();
  const repasses = [];
  for (const t of await buscarPorAssunto("Your money is on the way", desde)) {
    const valor = num(depois(await corpoDe(t.id), "Payout amount"));
    const k = `${t.created_at.slice(0, 10)}|${valor}`;
    if (repVistos.has(k)) continue;
    repVistos.add(k);
    repasses.push({ criado: t.created_at, valor });
  }

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  const jobs = await (await fetch(
    `${SB}/rest/v1/jobs?select=id,reference,client_name,client_price,payment_status,status,report_link,invoice_id&deleted_at=is.null&limit=3000`,
    { headers: SH },
  )).json();
  const porExterno = new Map();
  for (const j of jobs) {
    const id = /business-jobs\/([a-z0-9]+)/i.exec(j.report_link ?? "")?.[1];
    if (id) porExterno.set(id, j);
  }
  let seen = {};
  try { seen = JSON.parse(readFileSync("/Users/victorsouza/checkatrade-rpa/.state/seen.json", "utf8")); } catch {}
  const porId = new Map(jobs.map((j) => [j.id, j]));
  const chaveNome = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const porNome = new Map();
  for (const j of jobs) {
    const k = chaveNome(j.client_name);
    if (!k) continue;
    if (!porNome.has(k)) porNome.set(k, []);
    porNome.get(k).push(j);
  }

  for (const c of unicos) {
    c.job = null; c.via = null;
    if (c.externo) {
      c.job = porExterno.get(c.externo) ?? null;
      if (c.job) c.via = "id";
      if (!c.job) for (const [k, v] of porExterno) if (k.startsWith(c.externo.slice(0, 20))) { c.job = v; c.via = "id"; break; }
      if (!c.job && seen[c.externo]?.masterOsId) { c.job = porId.get(seen[c.externo].masterOsId) ?? null; if (c.job) c.via = "seen"; }
    }
    if (!c.job) {
      const cands = porNome.get(chaveNome(c.cliente)) ?? [];
      if (cands.length === 1) { c.job = cands[0]; c.via = "nome"; }
      else if (cands.length > 1) c.via = `${cands.length} jobs com esse nome`;
    }
  }

  // ─── Razão ────────────────────────────────────────────────────────────────
  // Grava no razão que o Financeiro já lê. `type: customer_final` é o que a
  // UI soma como pagamento do cliente, então o recebimento aparece nos painéis
  // existentes sem tocar em nenhum deles. `amount` é o LÍQUIDO (o que entrou
  // para nós), coerente com client_price; o bruto e a taxa vão em colunas
  // próprias, porque hoje essa informação se perde.
  if (APLICAR) {
    for (const c of unicos) {
      if (!c.job) continue; // órfão não vira lançamento: vai para o email.
      const r = await fetch(`${SB}/rest/v1/job_payments`, {
        method: "POST",
        headers: { ...SHW, prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          job_id: c.job.id,
          type: "customer_final",
          amount: c.net,
          payment_date: c.pagoEm ? new Date(c.pagoEm + " 12:00:00 UTC").toISOString().slice(0, 10) : c.criado.slice(0, 10),
          payment_method: "platform",
          platform: "checkatrade",
          external_txid: c.chave,
          gross: c.gross,
          fee: c.fee,
          zendesk_ticket_id: c.ticket,
          matched_by: c.via,
          note: `Checkatrade · ${c.cliente ?? "?"} · ticket ${c.ticket}`,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        if (/external_txid|platform|gross/.test(t) && /column|schema cache/.test(t)) {
          aviso.push("As colunas novas de job_payments nao existem: aplique supabase/migrations/257_job_payments.sql. A baixa nos jobs foi feita, mas o razao (bruto, taxa e idempotencia) nao esta sendo gravado.");
          break;
        }
        if (!/duplicate key|23505/.test(t)) aviso.push(`Falha ao gravar credito ${c.ticket}: ${t.slice(0, 120)}`);
      }
    }
  }

  // ─── Agrupar por job e decidir ────────────────────────────────────────────
  const grupos = new Map();
  const orfaos = [];
  for (const c of unicos) {
    if (!c.job) { orfaos.push(c); continue; }
    if (!grupos.has(c.job.reference)) grupos.set(c.job.reference, { job: c.job, cred: [] });
    grupos.get(c.job.reference).cred.push(c);
  }
  // ─── Só é pago quando saiu do saldo e foi para o banco ───────────────────
  // "You got paid by <nome>" credita o SALDO do Checkatrade, e saldo não é
  // conta bancária. O dinheiro só existe para nós quando vem o repasse ("Your
  // money is on the way to your bank account"), que varre o saldo acumulado.
  // Marcar pago no crédito antecipa dinheiro que ainda está na plataforma.
  //
  // Como o repasse leva TODO o saldo do período, qualquer crédito anterior ao
  // último repasse já foi para o banco. Crédito posterior fica esperando o
  // próximo, e aparece no email como recebido-mas-ainda-na-plataforma.
  const ultimoRepasse = repasses.map((r) => r.criado.slice(0, 10)).sort().pop() ?? null;
  const noBanco = (g) => {
    if (!ultimoRepasse) return false;
    const ult = g.cred.map((c) => (c.pagoEm ? new Date(c.pagoEm + " 12:00:00 UTC").toISOString().slice(0, 10) : c.criado.slice(0, 10))).sort().pop();
    return ult <= ultimoRepasse;
  };

  const aDar = [], divergem = [], jaOk = [], naPlataforma = [];
  for (const g of grupos.values()) {
    g.soma = g.cred.reduce((a, c) => a + (c.net ?? 0), 0);
    g.alvo = Number(g.job.client_price) || 0;
    g.fecha = Math.abs(g.alvo - g.soma) < 0.01;
    if (g.job.payment_status === "paid") { jaOk.push(g); continue; }
    if (!g.fecha) { divergem.push(g); continue; }
    (noBanco(g) ? aDar : naPlataforma).push(g);
  }

  // Fechar o job SEM fechar a invoice é o pior resultado possível: o dinheiro
  // some do "a receber" no job e continua no "Ready to receive" do Financeiro,
  // e alguém vai cobrar um cliente que já pagou. Por isso os dois andam juntos,
  // e a invoice só fecha quando o valor dela bate com o recebido — invoice
  // maior que o pagamento significa que ainda falta receber alguma coisa
  // (aconteceu no JOB-9278: invoice de £124,70 para £91 recebidos).
  const invoiceAberta = [];
  if (APLICAR) {
    for (const g of aDar) {
      const ult = g.cred[g.cred.length - 1];
      const quando = ult.pagoEm ? new Date(ult.pagoEm + " 12:00:00 UTC").toISOString() : ult.criado;
      // Recebido fecha o job NA HORA, e não só marca as colunas de dinheiro.
      // Sem esta linha o job ficava em `awaiting_payment` para sempre depois de
      // pago: em 20/08/2026 havia 29 assim, todos com a invoice já quitada,
      // entupindo a aba de quem procura o que ainda falta receber.
      //
      // Só de `awaiting_payment`. Job em `final_check` tem dinheiro dentro e
      // relatório pendente, e fechá-lo pularia a entrega que o cliente cobra.
      const fecha = g.job.status === "awaiting_payment" ? { status: "completed" } : {};
      await fetch(`${SB}/rest/v1/jobs?id=eq.${g.job.id}`, {
        method: "PATCH", headers: SHW,
        body: JSON.stringify({ ...fecha, payment_status: "paid", finance_status: "paid", payment_amount: g.soma, paid_at: quando }),
      });

      if (!g.job.invoice_id) continue;
      const inv = (await (await fetch(`${SB}/rest/v1/invoices?select=id,reference,status,amount&id=eq.${g.job.invoice_id}`, { headers: SH })).json())[0];
      if (!inv || inv.status === "paid") continue;
      if (Math.abs(Number(inv.amount) - g.soma) < 0.01) {
        await fetch(`${SB}/rest/v1/invoices?id=eq.${inv.id}`, {
          method: "PATCH", headers: SHW,
          body: JSON.stringify({ status: "paid", amount_paid: g.soma, paid_date: quando.slice(0, 10) }),
        });
      } else {
        invoiceAberta.push({ job: g.job.reference, inv: inv.reference, valor: Number(inv.amount), recebido: g.soma });
      }
    }
  }

  // ─── Sugestão do modelo, só para os órfãos ────────────────────────────────
  // Aqui o LLM é útil: o parser já falhou, e ele lê o email inteiro e propõe.
  // O que ele devolve entra no email como SUGESTÃO e nunca vira lançamento.
  if (orfaos.length && env.OPENAI_API_KEY) {
    const catalogo = jobs
      .filter((j) => j.payment_status !== "paid" && Number(j.client_price) > 0)
      .slice(0, 220)
      .map((j) => `${j.reference}|${j.client_name}|${j.client_price}`)
      .join("\n");
    for (const o of orfaos) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_API_KEY },
          body: JSON.stringify({
            model: "gpt-4o-mini", temperature: 0,
            messages: [{
              role: "user",
              content:
                "Um pagamento chegou sem identificacao de job. Diga qual job da lista mais provavelmente corresponde, " +
                "ou responda NENHUM se nao houver evidencia forte. Responda so: REFERENCIA|motivo curto.\n\n" +
                `PAGAMENTO: cliente="${o.cliente}" valor_liquido=${o.net} valor_bruto=${o.gross} data=${o.criado.slice(0, 10)}\n\n` +
                `JOBS EM ABERTO (referencia|cliente|preco):\n${catalogo}`,
            }],
          }),
        });
        const j = await r.json();
        o.sugestao = j.choices?.[0]?.message?.content?.trim()?.slice(0, 160) ?? null;
      } catch { o.sugestao = null; }
    }
  }

  // ─── Conferência de coerência ─────────────────────────────────────────────
  // Corrigir na escrita não basta: o desencontro também nasce da mão humana na
  // tela, marcando um lado e esquecendo o outro. Isto varre TODAS as invoices
  // vivas contra o estado do job, seja qual for a origem, e é o que garante que
  // o "Ready to receive" nunca cobre alguém que já pagou.
  const incoerentes = { pagoMasAberta: [], mortoMasViva: [], abertaSemJob: [] };
  {
    const abertas = await (await fetch(
      `${SB}/rest/v1/invoices?select=reference,job_reference,amount,due_date&status=neq.paid&status=neq.cancelled&status=neq.void&deleted_at=is.null&limit=500`,
      { headers: SH },
    )).json();
    const refs = [...new Set(abertas.map((i) => i.job_reference).filter(Boolean))];
    const mapa = new Map();
    for (let k = 0; k < refs.length; k += 60) {
      const p = refs.slice(k, k + 60).map((r) => `"${r}"`).join(",");
      const lote = await (await fetch(`${SB}/rest/v1/jobs?select=reference,status,payment_status,deleted_at&reference=in.(${encodeURIComponent(p)})`, { headers: SH })).json();
      for (const j of lote ?? []) mapa.set(j.reference, j);
    }
    for (const i of abertas) {
      const j = i.job_reference ? mapa.get(i.job_reference) : null;
      if (!j) { if (i.job_reference) incoerentes.abertaSemJob.push(i); continue; }
      if (j.deleted_at || j.status === "cancelled") incoerentes.mortoMasViva.push(i);
      else if (j.payment_status === "paid") incoerentes.pagoMasAberta.push(i);
    }
  }

  // ─── Saída ────────────────────────────────────────────────────────────────
  const somaNet = unicos.reduce((a, c) => a + (c.net ?? 0), 0);
  const somaGross = unicos.reduce((a, c) => a + (c.gross ?? 0), 0);
  const somaRep = repasses.reduce((a, r) => a + (r.valor ?? 0), 0);

  const L = [];
  L.push(`Periodo lido: desde ${desde}`);
  L.push(`Creditos: ${creditos.length} emails, ${unicos.length} reais (o Checkatrade repete cada email)`);
  L.push(`Baixa ${APLICAR ? "dada" : "a dar"}: ${aDar.length} job(s), ${fmt(aDar.reduce((a, g) => a + g.soma, 0))}`);
  L.push(`Ja estavam pagos: ${jaOk.length}`);
  L.push("");
  L.push(`Bruto do cliente: ${fmt(somaGross)}`);
  L.push(`Creditado a nos : ${fmt(somaNet)}  (taxa da plataforma ${fmt(somaGross - somaNet)}${somaGross ? " = " + ((1 - somaNet / somaGross) * 100).toFixed(1) + "%" : ""})`);
  L.push(`Repassado ao banco: ${fmt(somaRep)}  (diferenca contra o creditado: ${fmt(somaRep - somaNet)})`);

  L.push("", `Ultimo repasse ao banco: ${ultimoRepasse ?? "(nenhum no periodo lido)"}`);
  if (aDar.length) { L.push("", "BAIXA (credito ja varrido para o banco):"); for (const g of aDar) L.push(`  ${g.job.reference}  ${g.job.client_name}  ${fmt(g.soma)}`); }
  if (naPlataforma.length) {
    L.push("", "RECEBIDO MAS AINDA NA PLATAFORMA (nao dei baixa, espera o proximo repasse):");
    for (const g of naPlataforma) L.push(`  ${g.job.reference}  ${g.job.client_name}  ${fmt(g.soma)}`);
  }
  if (divergem.length) {
    L.push("", "DIVERGENCIAS (precisam de voce):");
    for (const g of divergem) L.push(`  ${g.job.reference}  ${g.job.client_name}  recebido ${fmt(g.soma)} contra ${fmt(g.alvo)} no OS  (diferenca ${fmt(g.alvo - g.soma)})`);
  }
  if (orfaos.length) {
    L.push("", "PAGAMENTOS SEM JOB (precisam de voce):");
    for (const o of orfaos) L.push(`  ${o.criado.slice(0, 10)} ticket ${o.ticket}  ${o.cliente}  ${fmt(o.net)}  [${o.via ?? "sem id no email"}]` + (o.sugestao ? `\n      sugestao do modelo (nao aplicada): ${o.sugestao}` : ""));
  }
  if (invoiceAberta.length) {
    L.push("", "JOB PAGO MAS INVOICE MAIOR QUE O RECEBIDO (fica em aberto, precisa de voce):");
    for (const i of invoiceAberta) L.push(`  ${i.job}  ${i.inv}  invoice ${fmt(i.valor)} contra ${fmt(i.recebido)} recebidos  (falta ${fmt(i.valor - i.recebido)})`);
  }
  const inc = incoerentes.pagoMasAberta.length + incoerentes.mortoMasViva.length + incoerentes.abertaSemJob.length;
  L.push("", `COERENCIA A RECEBER: ${inc === 0 ? "ok, nenhuma invoice discorda do job" : inc + " invoice(s) discordam do job"}`);
  for (const i of incoerentes.pagoMasAberta) L.push(`  COBRANCA FALSA: ${i.reference} (${i.job_reference}) ${fmt(i.amount)} — o job ja esta pago`);
  for (const i of incoerentes.mortoMasViva) L.push(`  JOB CANCELADO: ${i.reference} (${i.job_reference}) ${fmt(i.amount)} — invoice viva num job morto`);
  for (const i of incoerentes.abertaSemJob) L.push(`  SEM JOB: ${i.reference} (${i.job_reference}) ${fmt(i.amount)}`);

  if (aviso.length) { L.push("", "AVISOS:"); for (const a of aviso) L.push("  " + a); }
  if (!APLICAR) L.push("", "(modo seco: nada foi gravado)");

  const texto = L.join("\n");
  console.log("\n" + texto + "\n");

  // ─── Email ────────────────────────────────────────────────────────────────
  const temExcecao = divergem.length || orfaos.length || aviso.length || invoiceAberta.length || naPlataforma.length || inc > 0;
  if (APLICAR && env.RESEND_API_KEY && (temExcecao || aDar.length)) {
    const cfg = await (await fetch(`${SB}/rest/v1/company_settings?select=daily_brief_emails&limit=1`, { headers: SH })).json();
    const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
    if (para.length) {
      const assunto = temExcecao
        ? `Checkatrade: ${aDar.length} baixa(s), ${divergem.length + orfaos.length} pendencia(s)`
        : `Checkatrade: ${aDar.length} baixa(s), tudo conferido`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>",
          to: para, subject: assunto,
          text: texto + "\n\n-- \nAgente de recebimentos. As pendencias acima nao foram lancadas: elas esperam voce.",
        }),
      });
      console.log(r.ok ? `email enviado para ${para.join(", ")}` : `falha no email: ${(await r.text()).slice(0, 160)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
