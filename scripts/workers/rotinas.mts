/**
 * As rotinas que saíram do launchd do Mac para o serviço "fixfy-workers".
 *
 * Os horários são de LONDRES e são os que cada script ESPERA, não a cópia
 * literal do plist. Os plists foram escritos com o Mac em UTC-3 (13h no Mac =
 * 17h em Londres no verão); com o Mac em Londres, o e-mail "amanhã" passou a
 * disparar às 13h e o de reports às 16h/17h, os dois fora da própria janela, e
 * nada saía. O guarda de janela de cada script continua valendo: se um horário
 * daqui estiver errado, o script lista e não manda.
 *
 *   rotina                    janela do próprio script         agenda aqui
 *   lembrete-24h              9h-17h Londres                   10, 12, 14, 16h
 *   aviso-job-confirmado      (sem janela)                     a cada 10 min
 *   partner-tomorrow          16h-20h Londres ("o disparo é 17h")  17h
 *   partner-missing-reports   20h-22h Londres                  20h e 21h (trava de 1 por dia)
 *   harvey-leads-7h           janela do Harvey (padrão 8h-20h) 08:02
 *   daily-report              (sem janela; "fecha às 18h")     18h seg-sex
 *   weekly-report             (sem janela)                     18h sáb
 *   stefane                   (sem janela)                     a cada 2 min
 *   clube-lista               (sem janela; antes das 8h do cron) 07:30
 *
 * Para mudar um horário, é aqui. Para desligar uma rotina sem deploy, é a
 * variável WORKERS_DESLIGAR (ver agendador.mts).
 */
import type { Agenda } from "./agenda.mts";

export type Rotina = {
  /** Nome curto, o que vai no WORKERS_DESLIGAR e no prefixo do log. */
  nome: string;
  /** O label do launchd que esta rotina substitui (também aceito no WORKERS_DESLIGAR). */
  rotulo: string;
  agenda: Agenda;
  /** Script relativo à raiz do repo. */
  script: string;
  args: string[];
  /** `tsx` para .mts/.ts; `node` para .mjs puro (como o launchd chamava). */
  runtime: "tsx" | "node";
  /** Passou disso, a passada é morta: rotina presa não pode travar a próxima para sempre. */
  limiteMinutos: number;
};

export const ROTINAS: Rotina[] = [
  {
    nome: "lembrete-24h",
    rotulo: "com.fixfy.lembrete-24h",
    agenda: { tipo: "diario", horarios: ["10:00", "12:00", "14:00", "16:00"] },
    script: "scripts/confirmacao-24h.mts",
    args: ["--enviar"],
    runtime: "tsx",
    limiteMinutos: 20,
  },
  {
    nome: "aviso-job-confirmado",
    rotulo: "com.fixfy.aviso-job-confirmado",
    agenda: { tipo: "intervalo", minutos: 10 },
    script: "scripts/aviso-job-confirmado.mts",
    args: ["--aplicar"],
    runtime: "tsx",
    limiteMinutos: 9,
  },
  {
    nome: "partner-tomorrow",
    rotulo: "com.fixfy.partner-tomorrow",
    agenda: { tipo: "diario", horarios: ["17:00"] },
    script: "scripts/partner-tomorrow-email.mts",
    args: ["--enviar"],
    runtime: "tsx",
    limiteMinutos: 30,
  },
  {
    nome: "partner-missing-reports",
    rotulo: "com.fixfy.partner-missing-reports",
    agenda: { tipo: "diario", horarios: ["20:00", "21:00"] },
    script: "scripts/partner-missing-reports-email.mts",
    args: ["--enviar"],
    runtime: "tsx",
    limiteMinutos: 30,
  },
  {
    nome: "harvey-leads-7h",
    rotulo: "com.fixfy.harvey-leads-7h",
    agenda: { tipo: "diario", horarios: ["08:02"] },
    script: "scripts/harvey-wa/leads-checkatrade.mts",
    args: ["--enviar", "--dias=3", "--limite=50"],
    runtime: "tsx",
    // 50 leads com 20 s de intervalo entre eles são ~17 min.
    limiteMinutos: 40,
  },
  {
    nome: "daily-report",
    rotulo: "com.fixfy.daily-report",
    agenda: { tipo: "diario", horarios: ["18:00"], diasDaSemana: [1, 2, 3, 4, 5] },
    script: "scripts/fixfy-report.mjs",
    args: ["--enviar"],
    runtime: "node",
    limiteMinutos: 15,
  },
  {
    nome: "weekly-report",
    rotulo: "com.fixfy.weekly-report",
    agenda: { tipo: "diario", horarios: ["18:00"], diasDaSemana: [6] },
    script: "scripts/fixfy-report.mjs",
    args: ["--semana", "--enviar"],
    runtime: "node",
    limiteMinutos: 15,
  },
  {
    // A lista do clube B2C na Resend (dono, 16/10/2026): 1.000 contatos por dia
    // não cabem nos 300 s da Vercel. Roda antes do cron das 8h, que só agenda.
    nome: "clube-lista",
    rotulo: "com.fixfy.clube-lista",
    agenda: { tipo: "diario", horarios: ["07:30"] },
    script: "scripts/agente-marketing.mts",
    args: ["--lista", "--aplicar"],
    runtime: "tsx",
    limiteMinutos: 50,
  },
  {
    nome: "stefane",
    rotulo: "com.fixfy.stefane-worker",
    agenda: { tipo: "intervalo", minutos: 2 },
    script: "scripts/stefane-worker.mts",
    args: [],
    runtime: "tsx",
    // Até 10 envios por passada, cada um de 10 a 35 s com Chromium.
    limiteMinutos: 15,
  },
];

/**
 * Lê WORKERS_DESLIGAR ("stefane,daily-report", "*" para todas). Aceita o nome
 * curto, o label do launchd ou o label sem "com.fixfy.".
 *
 * Nome desconhecido é ERRO, não aviso: um erro de digitação deixaria ligada
 * justamente a rotina que se queria desligar, e o resultado é mensagem em
 * dobro para cliente e parceiro (Mac e Railway mandando juntos).
 */
export function lerDesligadas(valor: string | undefined, rotinas: Rotina[] = ROTINAS): Set<string> {
  const pedidos = (valor ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const fora = new Set<string>();
  const desconhecidos: string[] = [];
  for (const p of pedidos) {
    if (p === "*" || p === "todas" || p === "todos" || p === "all") {
      for (const r of rotinas) fora.add(r.nome);
      continue;
    }
    const r = rotinas.find((x) => x.nome === p || x.rotulo === p || x.rotulo.replace(/^com\.fixfy\./, "") === p);
    if (r) fora.add(r.nome);
    else desconhecidos.push(p);
  }
  if (desconhecidos.length) {
    throw new Error(
      `WORKERS_DESLIGAR tem nome(s) desconhecido(s): ${desconhecidos.join(", ")}. Válidos: ${rotinas.map((r) => r.nome).join(", ")} ou *`,
    );
  }
  return fora;
}
