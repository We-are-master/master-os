/**
 * AGENDADOR DO FIXFY-WORKERS — um processo só, de pé o tempo todo, no Railway.
 *
 * Substitui oito jobs do launchd do Mac (lista em rotinas.mts). Cada passada
 * de cada rotina roda como PROCESSO FILHO, do jeito que o launchd chamava:
 * se uma rotina quebra, só aquela passada morre; as outras e o agendador
 * seguem. A mesma rotina nunca roda duas vezes ao mesmo tempo: se a hora dela
 * chega e a anterior ainda não acabou, a vez é pulada e fica no log.
 *
 *   node --import tsx scripts/workers/agendador.mts             # roda para sempre
 *   node --import tsx scripts/workers/agendador.mts --ensaio    # só mostra a próxima de cada uma
 *   node --import tsx scripts/workers/agendador.mts --ensaio --proximas=3 --desde=2026-10-24T12:00:00Z
 *
 * Variáveis do próprio agendador:
 *
 *   WORKERS_DESLIGAR   "stefane,daily-report" (ou "*") desliga rotinas sem
 *                      deploy. Nome desconhecido derruba o processo de
 *                      propósito: erro de digitação aqui é mensagem em dobro
 *                      para cliente (Mac e Railway mandando juntos).
 *   FIXFY_STATE_DIR    onde as rotinas guardam a trava de "já mandei hoje".
 *                      No Railway, /data/state (o volume). Sem ela, cada
 *                      script usa o caminho de sempre dentro de scripts/.
 *
 * O agendador NÃO lê .env.local: no Railway não existe, e no Mac cada script
 * continua lendo o seu. O ambiente do processo passa inteiro para o filho.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { descreverAgenda, formatarLondres, proximaExecucao } from "./agenda.mts";
import { ROTINAS, lerDesligadas, type Rotina } from "./rotinas.mts";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ENSAIO = process.argv.includes("--ensaio");
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=");

const agora = () => new Date();
const carimbo = (d = agora()) => `${d.toISOString()} (${formatarLondres(d)})`;
const log = (msg: string) => console.log(`${carimbo()} [agendador] ${msg}`);

let desligadas: Set<string>;
try {
  desligadas = lerDesligadas(process.env.WORKERS_DESLIGAR);
} catch (e) {
  console.error(`${carimbo()} [agendador] ${(e as Error).message}`);
  process.exit(1);
}

function comando(r: Rotina): { bin: string; args: string[] } {
  // `node --import tsx` em vez de `npx tsx`: um processo a menos por passada e
  // sem npx procurando pacote na rede. O efeito no script é o mesmo.
  if (r.runtime === "tsx") return { bin: process.execPath, args: ["--import", "tsx", r.script, ...r.args] };
  return { bin: process.execPath, args: [r.script, ...r.args] };
}

/** Avisos de ambiente que custam caro se passarem batido. Não derrubam nada. */
function conferirAmbiente() {
  const e = process.env;
  if (!e.NEXT_PUBLIC_SUPABASE_URL?.trim()) log("AVISO: NEXT_PUBLIC_SUPABASE_URL vazia; toda rotina vai falhar");
  if (!(e.SERVICE_ROLE_KEY?.trim() || e.SUPABASE_SERVICE_ROLE_KEY?.trim())) log("AVISO: SERVICE_ROLE_KEY vazia; toda rotina vai falhar");
  // Link que sai em e-mail/WhatsApp para parceiro e cliente. No Mac, o
  // NEXT_PUBLIC_PARTNER_APP_URL do .env.local aponta para o localhost (dev);
  // aqui isso viraria link quebrado na caixa do parceiro.
  for (const nome of ["NEXT_PUBLIC_PARTNER_APP_URL", "NEXT_PUBLIC_APP_URL", "MASTER_OS_BASE_URL"]) {
    const v = e[nome]?.trim();
    if (v && /localhost|127\.0\.0\.1|\[::1\]/i.test(v)) log(`AVISO: ${nome} aponta para localhost; links em e-mail vão sair quebrados`);
  }
  if (e.VERCEL) log("AVISO: VERCEL definida; a Stefane só enfileira com ela e nunca envia");
}

function ensaio() {
  const n = Math.max(1, Number(arg("proximas") ?? 1) || 1);
  const desdeTxt = arg("desde");
  const desde = desdeTxt ? new Date(desdeTxt) : agora();
  if (Number.isNaN(desde.getTime())) {
    console.error(`--desde inválido: ${desdeTxt}`);
    process.exit(1);
  }
  console.log(`ENSAIO · nada roda · a partir de ${carimbo(desde)}`);
  console.log(`FIXFY_STATE_DIR=${process.env.FIXFY_STATE_DIR?.trim() || "(vazio: cada script usa scripts/)"}`);
  console.log(`WORKERS_DESLIGAR=${process.env.WORKERS_DESLIGAR?.trim() || "(vazio)"}\n`);
  for (const r of ROTINAS) {
    const estado = desligadas.has(r.nome) ? "DESLIGADA" : "ligada";
    const { args } = comando(r);
    console.log(`${r.nome.padEnd(24)} ${estado.padEnd(9)} ${descreverAgenda(r.agenda)}`);
    console.log(`${"".padEnd(24)} comando: node ${args.join(" ")}`);
    let t = desde;
    for (let i = 0; i < n; i++) {
      t = proximaExecucao(r.agenda, t);
      console.log(`${"".padEnd(24)} próxima: ${formatarLondres(t)}  = ${t.toISOString()}`);
    }
    console.log("");
  }
}

if (ENSAIO) {
  ensaio();
  process.exit(0);
}

// ─── Modo de verdade ────────────────────────────────────────────────────────

type Estado = { rotina: Rotina; proxima: Date; filho: ChildProcess | null; inicio: number; timer: NodeJS.Timeout | null };

const dirEstado = process.env.FIXFY_STATE_DIR?.trim();
if (dirEstado) mkdirSync(dirEstado, { recursive: true });

conferirAmbiente();
const estados: Estado[] = ROTINAS.filter((r) => !desligadas.has(r.nome)).map((rotina) => ({
  rotina,
  proxima: proximaExecucao(rotina.agenda, agora()),
  filho: null,
  inicio: 0,
  timer: null,
}));

log(`de pé · raiz ${RAIZ} · estado ${dirEstado || "(scripts/)"} · pid ${process.pid}`);
for (const r of ROTINAS) {
  const e = estados.find((x) => x.rotina.nome === r.nome);
  log(`${r.nome}: ${e ? `ligada · ${descreverAgenda(r.agenda)} · próxima ${formatarLondres(e.proxima)}` : "DESLIGADA (WORKERS_DESLIGAR)"}`);
}
if (!estados.length) log("todas as rotinas desligadas; fico de pé esperando, sem rodar nada");

let encerrando = false;

function prefixar(fluxo: NodeJS.ReadableStream | null, nome: string, erro: boolean) {
  if (!fluxo) return;
  const rl = createInterface({ input: fluxo });
  rl.on("line", (linha) => (erro ? console.error : console.log)(`[${nome}] ${linha}`));
}

function disparar(e: Estado) {
  const r = e.rotina;
  if (e.filho) {
    const min = Math.round((Date.now() - e.inicio) / 60_000);
    log(`${r.nome}: PULADA, a passada anterior ainda roda (há ${min} min)`);
    return;
  }
  const { bin, args } = comando(r);
  e.inicio = Date.now();
  log(`${r.nome}: início · ${r.script} ${r.args.join(" ")}`.trimEnd());
  const filho = spawn(bin, args, { cwd: RAIZ, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  e.filho = filho;
  prefixar(filho.stdout, r.nome, false);
  prefixar(filho.stderr, r.nome, true);

  e.timer = setTimeout(() => {
    log(`${r.nome}: passou de ${r.limiteMinutos} min, mandando SIGTERM`);
    filho.kill("SIGTERM");
    setTimeout(() => filho.exitCode === null && filho.signalCode === null && filho.kill("SIGKILL"), 10_000).unref();
  }, r.limiteMinutos * 60_000);

  filho.on("error", (err) => log(`${r.nome}: não abriu o processo: ${err.message}`));
  filho.on("close", (codigo, sinal) => {
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    e.filho = null;
    const seg = ((Date.now() - e.inicio) / 1000).toFixed(1);
    const fim = sinal ? `sinal ${sinal}` : `código ${codigo}`;
    log(`${r.nome}: fim · ${fim} · ${seg}s${codigo === 0 ? "" : " · FALHOU"}`);
  });
}

let relogio: NodeJS.Timeout | null = null;

function agendar() {
  if (encerrando) return;
  const t = agora();
  for (const e of estados) {
    if (e.proxima.getTime() <= t.getTime()) {
      disparar(e);
      e.proxima = proximaExecucao(e.rotina.agenda, t);
    }
  }
  const menor = Math.min(...estados.map((e) => e.proxima.getTime()), t.getTime() + 60_000);
  // Acorda no máximo a cada minuto: relógio do contêiner que pula (NTP,
  // suspensão) não deixa uma rotina dormindo horas além da conta.
  relogio = setTimeout(agendar, Math.max(250, Math.min(menor - Date.now(), 60_000)));
}

function encerrar(sinal: NodeJS.Signals) {
  if (encerrando) return;
  encerrando = true;
  if (relogio) clearTimeout(relogio);
  const vivos = estados.filter((e) => e.filho);
  log(`${sinal} recebido · ${vivos.length} rotina(s) em andamento${vivos.length ? `: ${vivos.map((e) => e.rotina.nome).join(", ")}` : ""}`);
  if (!vivos.length) process.exit(0);
  for (const e of vivos) e.filho?.kill("SIGTERM");
  // O Railway espera um pouco antes do SIGKILL; damos 20 s para quem estiver
  // no meio de um envio terminar o que está fazendo.
  const prazo = setTimeout(() => {
    for (const e of estados) e.filho?.kill("SIGKILL");
    process.exit(0);
  }, 20_000);
  const espera = setInterval(() => {
    if (estados.every((e) => !e.filho)) {
      clearTimeout(prazo);
      clearInterval(espera);
      process.exit(0);
    }
  }, 250);
}

process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));

if (estados.length) agendar();
else setInterval(() => {}, 1 << 30);
