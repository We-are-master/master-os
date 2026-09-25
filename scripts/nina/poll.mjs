/**
 * NINA — a agente da Fantastic Services.
 *
 * Ela faz o ciclo inteiro deles: pega o job que aceitamos, sobe no OS em
 * `unassigned`, e no dia seguinte fecha o que foi executado (checklist do dia,
 * check in, relatório, check out).
 *
 *   node scripts/nina/poll.mjs            uma passada
 *   node scripts/nina/poll.mjs --seco     decide e não escreve em lugar nenhum
 *
 * Chaves, todas desligadas por padrão, porque cada uma escreve fora daqui:
 *
 *   NINA_IMPORTAR=1    cria job no OS
 *   NINA_FECHAR=1      fecha job no app deles
 *   NINA_CHECKLIST=1   responde a checklist diária (selfie e veículo)
 *   NINA_PAUSADA=1     não faz nada, e diz que não fez
 *
 * **Ela é presa à máquina, e isso é natureza, não limitação.** Precisa do
 * emulador Android, que precisa de virtualização por hardware. Emulador sem
 * KVM não é lento, é imprevisível: os toques dependem de a tela mudar em
 * segundos, e em emulação por software esse tempo varia demais. Por isso ela
 * roda em launchd na máquina, como o bot do Checkatrade, e não na Railway como
 * o Harvey. O caminho para a nuvem passa por capturar a API do app deles, e é
 * para isso que `tela.mjs` e `app.mjs` são os únicos que sabem de pixel.
 *
 * **Sem arquivo de estado, de propósito.** Se já importamos um job, o OS sabe
 * (postcode + data); se já fechamos, o app sabe ("The job is done"). Um
 * `.seen.json` seria uma terceira versão da verdade para divergir das outras
 * duas, e é assim que agente aqui já errou antes.
 */
import { execSync } from "node:child_process";
import { saude, irPara, jobsDoDia, abrirJob, lerJob, jobFechado, horaReal, abrirApp, limparAvisos } from "./app.mjs";
import { importar } from "./importar.mjs";
import { achar, tocar } from "./tela.mjs";

const SECO = process.argv.includes("--seco");
const RAIZ = new URL("../..", import.meta.url).pathname;
const ligado = (k) => process.env[k]?.trim() === "1";
const hoje = new Date();
const dia = (d) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + d);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const linhas = [];
const diz = (s) => { console.log(s); linhas.push(s) };

if (ligado("NINA_PAUSADA")) {
  console.log("[nina] PAUSADA por NINA_PAUSADA=1 — nada lido, nada escrito.");
  process.exit(0);
}

// ── 1. o aparelho responde e o app está logado? ───────────────────────────
const s = saude();
if (s.ok) { const { esperarCarregar } = await import("./app.mjs"); esperarCarregar(); }
if (!s.ok) {
  diz(`✘ ${s.motivo}`);
  await reportar(true);
  process.exit(1);
}

// ── 1b. os avisos, que trancam a navegação ────────────────────────────────
/**
 * O app conversa por modal e não é um tipo só: "New job received", a oferta
 * on-demand, e diálogos de mudança ("EC2A 2FJ at 08:00 has been changed from
 * Cash to Card"). Enquanto um está na frente nada navega.
 *
 * Aceitar oferta NÃO é dela (dono, 16/09/2026: "a Nina não vai aceitar, depois
 * treino ela pra isso"). Ela lê, conta no brief, e sai pelo botão que não
 * compromete nada.
 */
const horasReais = new Map();
for (const a of limparAvisos()) {
  if (a.tipo === "job_novo") {
    diz(`✉ job novo: ${a.servico ?? "?"} · ${a.postcode ?? "?"} · ${a.data ?? "?"} ${a.hora ?? ""}`);
    if (a.postcode && a.hora) horasReais.set(a.postcode.replace(/\s+/g, ""), { data: a.data, hora: a.hora });
  } else if (a.tipo === "oferta") {
    diz(`◆ oferta: ${a.servico ?? "?"} · ${a.endereco ?? "?"} · £${a.preco ?? "?"} · ${a.comeca ?? "?"}`);
    diz(`   ${a.perdida ? "PERDIDA para outro" : (a.desfecho ?? "sem desfecho na tela")}`);
  } else {
    diz(`⚠ aviso do app: ${a.texto.slice(0, 120)}`);
  }
}

// ── 2. a checklist do dia, que bloqueia o app ─────────────────────────────
if (s.checklistPendente) {
  if (ligado("NINA_CHECKLIST") && !SECO) {
    diz("checklist diária pendente — respondendo");
    try {
      execSync("node scripts/nina/checklist-diaria.mjs --enviar", { cwd: RAIZ, stdio: "inherit" });
      diz("checklist diária enviada");
    } catch { diz("✘ a checklist diária falhou; o app segue bloqueado") }
  } else {
    diz("⚠ checklist diária pendente e ela BLOQUEIA o dia. Sem ela nenhum job abre.");
    diz("   (NINA_CHECKLIST=1 para eu responder, ou faça à mão)");
    await reportar(true);
    process.exit(0);
  }
  abrirApp();
}

// ── 3. importar o que foi aceito: hoje e amanhã ───────────────────────────
let importados = 0, jaTinha = 0, semDado = 0;
if (!irPara("History")) diz("✘ não cheguei no History");
else for (const desloc of [0, 1]) {
  const d = dia(desloc);
  const lista = jobsDoDia(d.getDate());
  if (!lista.ok) { diz(`(${iso(d)}: ${lista.motivo})`); continue }
  diz(`${iso(d)}: ${lista.jobs.length} job(s) no app`);
  for (const j of lista.jobs) {
    if (!abrirJob(d.getDate(), j)) { diz(`   ✘ não abri o job de ${j.hora}`); continue }
    const dados = lerJob(null);
    /**
     * O aviso ganha da conta do +4h quando ele existe para este postcode: ele
     * traz a hora escrita, sem conversão, e conversão é onde se erra.
     */
    const doAviso = dados.postcode ? horasReais.get(String(dados.postcode).replace(/\s+/g, "")) : null;
    const r = await importar(
      { ...dados, data: doAviso?.data ?? iso(d), horaApp: j.hora, horaReal: doAviso?.hora ?? horaReal(j.hora) },
      { postar: ligado("NINA_IMPORTAR") && !SECO },
    );
    if (doAviso) diz(`   (hora do aviso: ${doAviso.hora}, em vez da conta do +4h)`);
    if (r.status === "criado") { importados++; diz(`   + ${r.reference} · ${dados.cliente} · ${dados.postcode} · chegada ${horaReal(j.hora)}`) }
    else if (r.status === "ja_existe") { jaTinha++ }
    else if (r.status === "ensaio") { diz(`   [ensaio] criaria: ${dados.cliente} · ${dados.postcode} · £${r.corpo.client_price} · chegada ${r.corpo.arrival_time}`) }
    else if (r.status === "faltando") { semDado++; diz(`   ◐ ${dados.postcode ?? "?"}: ${r.nota}`) }
    else diz(`   ✘ ${dados.postcode ?? "?"}: ${r.erro ?? r.status}`);
    irPara("History"); jobsDoDia(d.getDate());
  }
}
if (jaTinha) diz(`${jaTinha} já estava(m) no OS`);

// ── 4. fechar o que foi executado ontem ───────────────────────────────────
let fechados = 0, abertos = 0;
const ontem = dia(-1);
if (irPara("History")) {
  const lista = jobsDoDia(ontem.getDate());
  if (lista.ok) {
    diz(`${iso(ontem)}: ${lista.jobs.length} job(s) para conferir`);
    for (const j of lista.jobs) {
      if (!abrirJob(ontem.getDate(), j)) { diz(`   ✘ não abri o job de ${j.hora}`); continue }
      const estado = jobFechado();
      if (estado === true) { fechados++; irPara("History"); jobsDoDia(ontem.getDate()); continue }
      if (estado === null) { diz(`   ? ${j.hora}: não consegui ler o estado desta tela`); irPara("History"); jobsDoDia(ontem.getDate()); continue }
      abertos++;
      if (!ligado("NINA_FECHAR") || SECO) { diz(`   ◐ ${j.hora} aberto (NINA_FECHAR=1 para eu fechar)`); irPara("History"); jobsDoDia(ontem.getDate()); continue }
      diz(`   fechando ${j.hora}…`);
      try {
        execSync("node scripts/nina/ciclo-job.mjs", { cwd: RAIZ, stdio: "inherit" });
        diz(`   ✔ ${j.hora} fechado`);
      } catch { diz(`   ✘ ${j.hora} não fechou`) }
      irPara("History"); jobsDoDia(ontem.getDate());
    }
  }
}

diz(`\nciclo: ${importados} importado(s), ${fechados} já fechado(s), ${abertos} aberto(s)`);
await reportar(abertos > 0 || semDado > 0);

/** A voz dela no e-mail único. Agente que roda calado é o erro que já custou caro aqui. */
async function reportar(precisaAcao) {
  if (SECO) return;
  try {
    const { entregar } = await import("../lib/brief.mjs");
    await entregar({
      secao: "nina",
      ordem: 60,
      titulo: "Nina · Fantastic Services",
      assunto: `${importados} importado(s) · ${fechados} fechado(s) · ${abertos} aberto(s)`,
      texto: linhas.join("\n"),
      precisaAcao,
    });
  } catch (e) {
    console.error("[nina] não consegui escrever no brief:", e.message);
  }
}
