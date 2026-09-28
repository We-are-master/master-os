/**
 * O ritmo da campanha, sempre em hora de Londres (decisão do dono em 28/09/2026).
 *
 *   e-mail     só de manhã, 9h às 12h
 *   whatsapp   só de tarde, 15h às 18h. O follow-up sai às 15h do MESMO dia
 *              em que o e-mail daquela pessoa saiu: como o e-mail só sai até
 *              12h, são sempre 3 horas ou mais depois
 *   lembrete   "WEEK10 ends tomorrow" na véspera do fim da oferta, 9h30
 *
 * A conta passa pelo Intl com Europe/London: o horário de verão (BST, UTC+1)
 * vale até 25/10 e depois vira GMT. Conta feita direto em UTC erraria uma hora
 * num dos dois lados, e o erro só aparece na semana da troca.
 *
 * As janelas mudam por variável de ambiente, em horas cheias:
 * MARKETING_EMAIL_ABRE/FECHA (9/12) e MARKETING_WA_ABRE/FECHA (15/18).
 */

import { WEEK10 } from "./week10-copy";

const HORA_MS = 60 * 60 * 1000;

function horaDoEnv(nome: string, padrao: number): number {
  const bruto = process.env[nome]?.trim();
  const n = bruto ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : padrao;
}

/** Lidas na hora da chamada: o disparador carrega o .env.local antes de importar. */
export function janelas() {
  return {
    emailAbre: horaDoEnv("MARKETING_EMAIL_ABRE", 9),
    emailFecha: horaDoEnv("MARKETING_EMAIL_FECHA", 12),
    waAbre: horaDoEnv("MARKETING_WA_ABRE", 15),
    waFecha: horaDoEnv("MARKETING_WA_FECHA", 18),
  };
}

const PARTES = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const DIA_DA_SEMANA = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });

/** O relógio de Londres naquele instante. */
export function emLondres(d: Date) {
  const p: Record<string, string> = {};
  for (const x of PARTES.formatToParts(d)) p[x.type] = x.value;
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour), minuto: Number(p.minute), segundo: Number(p.second) };
}

/** Quanto Londres está à frente do UTC naquele instante: 0 no GMT, 1 hora no BST. */
function desvioDeLondres(t: number): number {
  const l = emLondres(new Date(t));
  return Date.UTC(l.ano, l.mes - 1, l.dia, l.hora, l.minuto, l.segundo) - Math.floor(t / 1000) * 1000;
}

/**
 * O instante de hh:mm em Londres no dia (de Londres) de `d`, somando dias se
 * pedir. Confere o fuso duas vezes porque, perto da troca de horário, o fuso
 * do palpite pode ser o do outro lado da troca.
 */
export function naHoraDeLondres(d: Date, hora: number, minuto = 0, somaDias = 0): Date {
  const l = emLondres(d);
  const palpite = Date.UTC(l.ano, l.mes - 1, l.dia + somaDias, hora, minuto);
  let t = palpite - desvioDeLondres(palpite);
  const conferido = palpite - desvioDeLondres(t);
  if (conferido !== t) t = conferido;
  return new Date(t);
}

/** "2026-10-01": o dia do calendário de Londres, pronto para comparar como texto. */
export function diaDeLondres(d: Date): string {
  const l = emLondres(d);
  return `${l.ano}-${String(l.mes).padStart(2, "0")}-${String(l.dia).padStart(2, "0")}`;
}

/** "Tue 29/09 09:15", para nota de ticket e log. */
export function quandoEmLondres(d: Date): string {
  const l = emLondres(d);
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${DIA_DA_SEMANA.format(d)} ${dd(l.dia)}/${dd(l.mes)} ${dd(l.hora)}:${dd(l.minuto)}`;
}

function naFaixa(d: Date, abre: number, fecha: number): boolean {
  const h = emLondres(d).hora;
  return h >= abre && h < fecha;
}

/** E-mail só de manhã: 9h às 12h de Londres, todo dia. */
export function emailNaJanela(d = new Date()): boolean {
  const j = janelas();
  return naFaixa(d, j.emailAbre, j.emailFecha);
}

/** WhatsApp só de tarde: 15h às 18h de Londres, todo dia. */
export function whatsappNaJanela(d = new Date()): boolean {
  const j = janelas();
  return naFaixa(d, j.waAbre, j.waFecha);
}

/**
 * Quando sai o WhatsApp de follow-up de quem recebeu o e-mail em `emailSaiuEm`:
 * 15h de Londres do mesmo dia. Se o e-mail saiu tarde demais para isso (só
 * acontece em envio forçado fora da janela), 15h do dia seguinte, para nunca
 * ficar a menos de 3 horas do e-mail.
 */
export function horarioDoFollowup(emailSaiuEm: Date): Date {
  const { waAbre } = janelas();
  const mesmoDia = naHoraDeLondres(emailSaiuEm, waAbre);
  if (mesmoDia.getTime() - emailSaiuEm.getTime() >= 3 * HORA_MS) return mesmoDia;
  return naHoraDeLondres(emailSaiuEm, waAbre, 0, 1);
}

/**
 * A abertura do WhatsApp que vale agora: 15h de hoje enquanto a janela de hoje
 * não fechou (dentro dela, já venceu e sai na próxima leva), senão 15h de amanhã.
 */
export function aberturaDoWhatsApp(agora = new Date()): Date {
  const { waAbre, waFecha } = janelas();
  if (agora.getTime() < naHoraDeLondres(agora, waFecha).getTime()) return naHoraDeLondres(agora, waAbre);
  return naHoraDeLondres(agora, waAbre, 0, 1);
}

/* ═══════════════════ Lembrete de véspera ═══════════════════ */

const fimDaOferta = () => new Date(WEEK10.expiraEm);

/** A véspera do fim da oferta, no calendário de Londres: quinta 01/10 na WEEK10. */
export function diaDoLembrete(): string {
  return diaDeLondres(naHoraDeLondres(fimDaOferta(), 12, 0, -1));
}

/** Quando o lembrete fica pronto para sair: 9h30 de Londres da véspera. */
export function horarioDoLembrete(): Date {
  return naHoraDeLondres(fimDaOferta(), 9, 30, -1);
}

export function ehDiaDoLembrete(d = new Date()): boolean {
  return diaDeLondres(d) === diaDoLembrete();
}

/** Passada a véspera, "ends tomorrow" vira mentira: o lembrete que sobrou não sai mais. */
export function lembretePassou(d = new Date()): boolean {
  return diaDeLondres(d) > diaDoLembrete();
}
