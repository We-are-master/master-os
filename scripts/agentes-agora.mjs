#!/usr/bin/env node
/**
 * O que cada agente está fazendo AGORA.
 *
 * O Daily Report conta o dia depois que ele acabou. Isto é a outra pergunta, a
 * que se faz tomando café: quem está de pé neste instante, quando cada um
 * rodou pela última vez, e o que ele disse na última linha que escreveu.
 *
 * De onde sai cada coisa, e por que assim:
 *
 *   ESTÁ DE PÉ?   do `launchctl list`: PID quando está rodando agora, e o
 *                 código da última saída quando não está. Perguntar ao launchd
 *                 em vez de procurar processo no `ps` é o que faz o painel
 *                 dizer "parado" em vez de "sumido" para agente de intervalo,
 *                 que passa a maior parte do tempo dormindo de propósito.
 *   O QUE FEZ     da ÚLTIMA linha reconhecida do log dele. Cada agente escreve
 *                 num formato próprio; aqui mora a tradução de cada um.
 *   ATRASADO?     mtime do log contra a cadência esperada. Agente de 5 min sem
 *                 escrever há 40 é notícia; agente diário, não.
 *
 * O log é a fonte porque nenhum agente precisa saber que este painel existe.
 *
 *   node scripts/agentes-agora.mjs            # imprime uma vez e sai
 *   node scripts/agentes-agora.mjs --serve    # http://localhost:4600, recarrega sozinho
 */
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASA = "/Users/victorsouza";
const SERVIR = process.argv.includes("--serve");
const PORTA = Number(process.argv[process.argv.indexOf("--serve") + 1]) || 4600;

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
const q = async (t, f) => {
  try {
    const r = await fetch(`${SB}/rest/v1/${t}?${f}`, { headers: SH });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
};

const lb = (v) => "£" + (Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 0 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** "há 3 min", "há 2 h", "há 4 d". Sem segundos: ninguém decide nada com eles. */
const faz = (seg) => {
  if (seg == null) return "nunca";
  if (seg < 90) return "agora";
  if (seg < 5400) return `há ${Math.round(seg / 60)} min`;
  if (seg < 172800) return `há ${Math.round(seg / 3600)} h`;
  return `há ${Math.round(seg / 86400)} d`;
};

/** Última linha do log que casa com a regex, já capturada. */
const ultima = (linhas, re) => {
  let m = null;
  for (const l of linhas) { const x = re.exec(l); if (x) m = x; }
  return m;
};

// ── Os agentes ───────────────────────────────────────────────────────────
// `conta(linhas)` devolve a frase do que ele fez por último. Devolver null faz
// o painel dizer "sem linha reconhecida no log", que é diferente de "parado":
// um é o agente calado, o outro é o painel que não entendeu.
const AGENTES = [
  {
    nome: "Ruben", papel: "Checkatrade RPA", label: "com.fixfy.checkatrade-rpa",
    log: `${CASA}/checkatrade-rpa/.logs/rpa.log`, cadencia: 300, sempreDePe: true,
    conta: (ls) => {
      const bloqueio = ultima(ls, /(Cloudflare|block #\d+)/i);
      const pass = ultima(ls, /Fast pass: (\d+) opportunities — (\d+) job\(s\), (\d+) lead\(s\)/);
      const board = ultima(ls, /Boards read: (\d+) cards/);
      const partes = [];
      if (pass) partes.push(`último pass: ${pass[1]} oportunidade(s), ${pass[2]} job(s) e ${pass[3]} lead(s)`);
      if (board) partes.push(`${board[1]} cards no board`);
      if (bloqueio && ls.slice(-40).some((l) => /Cloudflare|block #/i.test(l))) partes.push("levando bloqueio do Cloudflare agora");
      return partes.length ? partes.join(" · ") : null;
    },
  },
  {
    nome: "Harvey", papel: "Quotes no Zendesk", label: "com.fixfy.harvey",
    log: `${RAIZ}/.logs/harvey.log`, cadencia: 300,
    conta: (ls) => {
      const cand = ultima(ls, /candidatos apos filtros: (\d+)/);
      const ciclo = ultima(ls, /ciclo fechado: (\d+) rascunho\(s\), (\d+) booking/);
      if (!ciclo && !cand) return null;
      return `${cand ? `${cand[1]} candidato(s) no filtro` : "sem filtro lido"}, último ciclo fechou com ${ciclo ? `${ciclo[1]} rascunho(s) e ${ciclo[2]} booking(s)` : "nada"}`;
    },
  },
  {
    nome: "Alex", papel: "Vendas no WhatsApp", label: "com.fixfy.alex",
    log: `${CASA}/fixfy-sales/.logs/alex.log`, cadencia: 1800,
    conta: (ls) => {
      const v = ultima(ls, /^vendas: (\d+)\s+\(jobs criados: (\d+) · já existiam: (\d+) · falharam: (\d+)\)/);
      const p = ultima(ls, /── precisa de você \((\d+)\)/);
      if (!v) return p ? `${p[1]} pendência(s) na fila dele` : null;
      return `${v[1]} venda(s), ${v[2]} viraram job${Number(v[4]) ? `, ${v[4]} falhou na criação` : ""}${p ? ` · ${p[1]} pendência(s) na fila` : ""}`;
    },
  },
  {
    nome: "Mike", papel: "Dispatch de leads", label: "com.fixfy.sales-dispatch-novos",
    log: `${CASA}/fixfy-sales/.logs/sales-dispatch-novos.log`, cadencia: 1800,
    conta: (ls) => {
      const leads = ultima(ls, /leads do Checkatrade em clients: (\d+)/);
      const fora = ultima(ls, /São (\d+)h em Londres\. Fora da janela/);
      const uteis = ls.filter((l) => /Fora da janela|leads do Checkatrade em clients:/.test(l));
      const foraAgora = /Fora da janela/.test(uteis[uteis.length - 1] ?? "");
      if (!leads && !fora) return null;
      return `${leads ? `${leads[1]} lead(s) nos últimos 2 dias` : "sem leitura"}${foraAgora ? `, e parou por estar fora da janela de 8h-20h${fora ? ` (${fora[1]}h em Londres)` : ""}` : ", dentro do turno"}`;
    },
  },
  {
    nome: "Zia", papel: "Financeiro", label: "com.fixfy.finance",
    log: `${RAIZ}/.logs/finance.log`, cadencia: 86400,
    conta: (ls) => {
      const etapa = ultima(ls, /^\[zia\] \S+ (?:etapa: (.+)|turno (encerrado|iniciado))/);
      const inc = ultima(ls, /^(\d+) incoerencia\(s\) no a receber/);
      const apl = ultima(ls, /aplicado: (\d+) fatura\(s\) e (\d+) self-bill\(s\)/);
      if (!etapa) return null;
      const onde = etapa[1] ? `parou na etapa "${etapa[1]}"` : `turno ${etapa[2]}`;
      return `${onde}${apl ? ` · ${apl[1]} fatura(s) e ${apl[2]} self-bill(s) promovidos` : ""}${inc ? ` · ${inc[1]} incoerência(s) no a receber` : ""}`;
    },
  },
  {
    nome: "Daily Report", papel: "Relatório das 20h", label: "com.fixfy.daily-report",
    log: `${RAIZ}/.logs/daily-report.log`, cadencia: 86400,
    conta: (ls) => {
      const env = ultima(ls, /^enviado para (.+)$/);
      const marg = ultima(ls, /margem (£[\d,.]+) \((\d+)%/);
      const fora = ultima(ls, /agora sao (\d+)h em Londres/);
      if (!env) return fora ? `última chamada saiu calada: ${fora[1]}h em Londres, o relatório é das 20h` : null;
      return `último envio para ${env[1]}${marg ? ` · margem ${marg[1]} (${marg[2]}%)` : ""}`;
    },
  },
  {
    nome: "Daily Brief", papel: "Brief de IA, 8h e 18h", label: "com.fixfy.daily-brief",
    log: `${RAIZ}/.logs/daily-brief.log`, cadencia: 1800,
    conta: (ls) => {
      const ok = ultima(ls, /"kinds":\["(\w+)"\].*"recipients":(\d+)/);
      const pulou = ultima(ls, /"reason":"(\w+)"/);
      if (ok) return `último envio: brief da ${ok[1] === "morning" ? "manhã" : "tarde"} para ${ok[2]} destinatário(s)`;
      return pulou ? `batendo e passando reto (${pulou[1]}), que é o esperado fora das janelas` : null;
    },
  },
  {
    nome: "OS", papel: "Servidor em :3000", label: "com.fixfy.masteros-dev",
    log: `${CASA}/Library/Logs/masteros-dev.log`, cadencia: 600, sempreDePe: true,
    conta: (ls) => {
      const ultimas = ls.slice(-400).filter((l) => /\b(GET|POST|PATCH|DELETE)\b/.test(l));
      const erros = ultimas.filter((l) => / 5\d\d in /.test(l)).length;
      if (!ultimas.length) return null;
      return `${ultimas.length} requisição(ões) nas últimas linhas do log${erros ? `, ${erros} com erro 5xx` : ", nenhum erro 5xx"}`;
    },
  },
  {
    nome: "Office TV", papel: "Escritório 3D em :4545", label: "com.fixfy.office",
    log: `${CASA}/fixfy-office/.server.log`, cadencia: 86400, sempreDePe: true,
    conta: () => "servindo a cena do escritório",
  },
];

/** PID e último código de saída de cada Label, direto do launchd. */
function estadoDoLaunchd() {
  const mapa = {};
  try {
    for (const l of execFileSync("/bin/launchctl", ["list"], { encoding: "utf8" }).split("\n")) {
      const [pid, saida, label] = l.split("\t");
      if (label?.startsWith("com.fixfy.")) mapa[label] = { pid: pid === "-" ? null : Number(pid), saida: Number(saida) };
    }
  } catch {}
  return mapa;
}

async function coletar() {
  const launchd = estadoDoLaunchd();
  const agora = Date.now();

  const linhas = AGENTES.map((a) => {
    const st = launchd[a.label];
    let mtime = null, ls = [];
    try {
      mtime = statSync(a.log).mtimeMs;
      ls = readFileSync(a.log, "utf8").split("\n");
    } catch {}
    const idade = mtime == null ? null : Math.round((agora - mtime) / 1000);
    // Tolerância generosa de propósito: o alarme é para agente que MORREU, e
    // agente que atrasou um ciclo não morreu. Duas cadências mais um minuto.
    const atrasado = idade != null && idade > a.cadencia * 2 + 60;
    const rodando = Boolean(st?.pid);
    const cor = !st ? "cinza" : rodando ? "verde" : atrasado ? "vermelho" : "ambar";
    return {
      nome: a.nome, papel: a.papel, cor, rodando, idade,
      registrado: Boolean(st),
      saida: st?.saida ?? null,
      esperaSempre: Boolean(a.sempreDePe),
      fez: (ls.length ? a.conta(ls) : null) ?? "sem linha reconhecida no log",
    };
  });

  // O que está acontecendo na operação neste instante, para o painel não ser só
  // sobre robô: agente de pé com a rua parada não é boa notícia.
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const agenda = await q("jobs", `select=reference,client_name,partner_name,status,scheduled_start_at,client_price&scheduled_date=eq.${hoje}&deleted_at=is.null&order=scheduled_start_at.asc&limit=40`);
  const naRua = agenda.filter((j) => j.status !== "cancelled");
  const operacao = {
    hoje,
    total: naRua.length,
    andando: naRua.filter((j) => j.status === "in_progress").length,
    fechados: naRua.filter((j) => ["completed", "awaiting_payment", "final_check"].includes(j.status)).length,
    valor: naRua.reduce((a, j) => a + (Number(j.client_price) || 0), 0),
    proximo: naRua.find((j) => ["scheduled", "late", "unassigned", "auto_assigning"].includes(j.status)) ?? null,
  };

  return { linhas, operacao, hora: new Intl.DateTimeFormat("pt-BR", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()) };
}

// ── Saída no terminal ────────────────────────────────────────────────────
const PONTO = { verde: "\x1b[32m●\x1b[0m", ambar: "\x1b[33m●\x1b[0m", vermelho: "\x1b[31m●\x1b[0m", cinza: "\x1b[90m●\x1b[0m" };

function noTerminal({ linhas, operacao, hora }) {
  console.log(`\n  AGENTES AGORA · ${hora} em Londres\n`);
  for (const l of linhas) {
    const estado = l.rodando ? "rodando" : l.registrado ? `dormindo (saída ${l.saida})` : "não registrado";
    console.log(`  ${PONTO[l.cor]} ${l.nome.padEnd(14)} ${estado.padEnd(22)} ${faz(l.idade).padEnd(10)} ${l.papel}`);
    console.log(`    ${l.fez}`);
  }
  console.log(`\n  Na rua hoje: ${operacao.total} job(s), ${operacao.fechados} fechados, ${operacao.andando} em execução, ${lb(operacao.valor)}.`);
  if (operacao.proximo) console.log(`  Próximo: ${String(operacao.proximo.scheduled_start_at ?? "").slice(11, 16)} ${operacao.proximo.reference} · ${operacao.proximo.client_name ?? ""} · ${operacao.proximo.partner_name ?? "sem parceiro"}`);
  console.log("");
}

// ── Painel no navegador ──────────────────────────────────────────────────
const CORES = { verde: "#22C55E", ambar: "#F59E0B", vermelho: "#EF4444", cinza: "#6B7280" };

function pagina({ linhas, operacao, hora }) {
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const cards = linhas.map((l) => `
    <div class="card">
      <div class="topo">
        <span class="ponto" style="background:${CORES[l.cor]};box-shadow:0 0 0 4px ${CORES[l.cor]}22;"></span>
        <span class="nome">${esc(l.nome)}</span>
        <span class="papel">${esc(l.papel)}</span>
        <span class="quando">${esc(faz(l.idade))}</span>
      </div>
      <div class="estado" style="color:${CORES[l.cor]};">${l.rodando ? "rodando agora" : l.registrado ? `dormindo até o próximo ciclo · última saída ${l.saida}` : "não registrado no launchd"}</div>
      <div class="fez">${esc(l.fez)}</div>
    </div>`).join("");

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Agentes agora</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#08081A;color:#EDEDF5;font-family:${F};padding:26px 20px 40px}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:15px;letter-spacing:1.4px;text-transform:uppercase;color:#9A9AB8;font-weight:600;margin:0}
  .hora{font-size:12px;color:#6B6B85;margin-top:5px}
  .rua{margin:18px 0 22px;padding:16px 18px;background:linear-gradient(135deg,#12123A,#0C0C26);border:1px solid #22224A;border-radius:14px}
  .rua .n{font-size:26px;font-weight:700;letter-spacing:-.5px}
  .rua .d{font-size:13px;color:#9A9AB8;margin-top:4px;line-height:1.6}
  .grade{display:grid;gap:10px}
  .card{background:#0E0E28;border:1px solid #1E1E42;border-radius:12px;padding:13px 16px}
  .topo{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .ponto{width:9px;height:9px;border-radius:50%;flex:none}
  .nome{font-weight:700;font-size:14.5px}
  .papel{font-size:12px;color:#6B6B85}
  .quando{margin-left:auto;font-size:11.5px;color:#6B6B85;font-variant-numeric:tabular-nums}
  .estado{font-size:11.5px;font-weight:600;margin-top:7px}
  .fez{font-size:13px;color:#B8B8CE;margin-top:4px;line-height:1.55}
  .rodape{margin-top:22px;font-size:11.5px;color:#4A4A66;line-height:1.6}
  @media(max-width:520px){.quando{margin-left:0;width:100%}}
</style></head><body><div class="wrap">
  <h1>Agentes agora</h1>
  <div class="hora">${esc(hora)} em Londres · a página se atualiza sozinha a cada 15 segundos</div>

  <div class="rua">
    <div class="n">${operacao.total} job(s) na rua hoje</div>
    <div class="d">${operacao.fechados} já fechados, ${operacao.andando} em execução, ${lb(operacao.valor)} agendados.${
      operacao.proximo ? `<br>Próximo: ${esc(String(operacao.proximo.scheduled_start_at ?? "").slice(11, 16))} · ${esc(operacao.proximo.reference)} · ${esc(operacao.proximo.client_name ?? "")} · ${esc(operacao.proximo.partner_name ?? "sem parceiro")}` : ""
    }</div>
  </div>

  <div class="grade">${cards}</div>

  <div class="rodape">
    Verde é processo de pé neste instante. Âmbar é agente de intervalo dormindo entre um ciclo e outro, que é o normal dele.
    Vermelho é log parado por mais de duas cadências: aí sim é notícia.
    Tudo lido do launchd e do log de cada agente, sem nenhum deles precisar saber que este painel existe.
  </div>
</div></body></html>`;
}

if (!SERVIR) {
  noTerminal(await coletar());
  process.exit(0);
}

createServer(async (req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204).end(); return; }
  try {
    const dados = await coletar();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(req.url === "/json" ? JSON.stringify(dados, null, 2) : pagina(dados));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("falhou: " + String(e?.message ?? e));
  }
}).listen(PORTA, () => console.log(`agentes agora em http://localhost:${PORTA}`));
