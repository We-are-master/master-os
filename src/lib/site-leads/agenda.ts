/**
 * Quando cada toque da reserva abandonada sai. Funções puras, tudo no relógio
 * de Londres (BST no verão, GMT no inverno).
 *
 *   E1  30 minutos depois que a pessoa parou. Caiu depois das 21h ou antes
 *       das 8h, vai para as 8h30.
 *   E2  9h30 do dia seguinte ao dia em que o E1 SAIU.
 *   E3  9h30 do dia seguinte ao dia em que o E2 saiu.
 *   WA  15h do dia em que o E3 saiu (só com telefone e WhatsApp configurado).
 *
 * Cada passo conta a partir do envio REAL do anterior, não do horário que
 * estava marcado. Foi o que faltou em 25/09/2026: com o envio parado (DKIM do
 * getfixfy.com fora do DNS), três leads ficaram com os três e-mails vencidos e,
 * na volta, cada um receberia o 1, o 2 e o 3 com dez minutos de diferença.
 * Contando do envio real, o atraso empurra a sequência inteira e dois toques
 * nunca caem no mesmo meio período.
 *
 * Duas folgas mínimas seguram o resto: e-mail nunca sai menos de 12 horas
 * depois do toque anterior, e o WhatsApp nunca menos de 5 horas depois do E3.
 * O WhatsApp é a exceção pedida (mesmo dia do E3, de manhã o e-mail e à tarde
 * a mensagem); se o E3 atrasou para depois das 10h, ele vai para as 15h do dia
 * seguinte.
 *
 * O modo rápido existe só para o teste de ponta a ponta do dono
 * (scripts/reserva-abandonada-teste.mts --rapido): cada passo vence logo que o
 * anterior sai, sem folga e sem janela.
 */

export type Passo = 1 | 2 | 3 | 4;
export const PASSOS: readonly Passo[] = [1, 2, 3, 4];

export const NOME_DO_PASSO: Record<Passo, string> = { 1: "Email 1", 2: "Email 2", 3: "Email 3", 4: "WhatsApp" };

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/** Janela de envio (e do E1): das 8h às 21h de Londres. */
export const JANELA_ABRE_MIN = 8 * 60;
export const JANELA_FECHA_MIN = 21 * 60;
/** E-mail nunca sai menos de 12 horas depois do toque anterior. */
export const FOLGA_EMAIL_HORAS = 12;
/** O WhatsApp nunca sai menos de 5 horas depois do E3 (9h30 → 15h). */
export const FOLGA_WHATSAPP_HORAS = 5;

const FORMATO_LONDRES = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Data e hora de Londres de um instante. */
export function partesDeLondres(d: Date): { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number } {
  const p = Object.fromEntries(FORMATO_LONDRES.formatToParts(d).map((x) => [x.type, x.value]));
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, minuto: +p.minute, segundo: +p.second };
}

/**
 * O instante de uma hora de Londres num dia de Londres. Chuta em UTC e corrige
 * pela diferença que o relógio de Londres mostra: resolve BST e GMT, inclusive
 * nos dias da troca (as horas usadas aqui, 8h30, 9h30 e 15h, nunca caem no
 * buraco da 1h às 2h da mudança de março).
 */
export function horaDeLondres(ano: number, mes: number, dia: number, hora: number, minuto = 0): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let t = alvo;
  for (let i = 0; i < 3; i++) {
    const p = partesDeLondres(new Date(t));
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
    if (visto === alvo) break;
    t += alvo - visto;
  }
  return new Date(t);
}

/** Minutos desde a meia-noite de Londres (com os segundos, para 21:00:30 já ser "depois das 21h"). */
export function minutosDoDia(d: Date): number {
  const p = partesDeLondres(d);
  return p.hora * 60 + p.minuto + p.segundo / 60;
}

/** O mesmo dia de Londres de `d`, às hh:mm. */
export function noMesmoDia(d: Date, hora: number, minuto = 0): Date {
  const p = partesDeLondres(d);
  return horaDeLondres(p.ano, p.mes, p.dia, hora, minuto);
}

/** O dia seguinte (em Londres) ao de `d`, às hh:mm. */
export function noDiaSeguinte(d: Date, hora: number, minuto = 0): Date {
  const p = partesDeLondres(d);
  const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
  return horaDeLondres(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), hora, minuto);
}

/** Das 8h às 21h de Londres: fora disso nada sai, nem atrasado. */
export function dentroDaJanelaDeEnvio(d: Date): boolean {
  const m = minutosDoDia(d);
  return m >= JANELA_ABRE_MIN && m <= JANELA_FECHA_MIN;
}

/** E1: 30 minutos depois de parar; depois das 21h ou antes das 8h, vai para as 8h30. */
export function vencimentoDoEmail1(parouEm: Date): Date {
  const alvo = new Date(parouEm.getTime() + 30 * MINUTO);
  const m = minutosDoDia(alvo);
  if (m < JANELA_ABRE_MIN) return noMesmoDia(alvo, 8, 30);
  if (m > JANELA_FECHA_MIN) return noDiaSeguinte(alvo, 8, 30);
  return alvo;
}

/** E2 e E3: 9h30 do dia seguinte ao toque anterior, e nunca menos de 12 horas depois dele. */
export function vencimentoDoProximoEmail(anterior: Date): Date {
  const manha = noDiaSeguinte(anterior, 9, 30);
  const folga = new Date(anterior.getTime() + FOLGA_EMAIL_HORAS * HORA);
  return manha.getTime() >= folga.getTime() ? manha : folga;
}

/** WhatsApp: 15h do dia do E3; se isso ficar a menos de 5 horas dele, 15h do dia seguinte. */
export function vencimentoDoWhatsApp(email3: Date): Date {
  const tarde = noMesmoDia(email3, 15, 0);
  if (tarde.getTime() - email3.getTime() >= FOLGA_WHATSAPP_HORAS * HORA) return tarde;
  return noDiaSeguinte(email3, 15, 0);
}

export type EstadoDaSequencia = {
  /** Último movimento da pessoa no site (`last_activity_at`). */
  parouEm: Date;
  /** O que já saiu, com a hora REAL do envio. */
  enviados: Partial<Record<Passo, Date | null>>;
  /** O passo 4 existe: telefone válido e WhatsApp configurado. */
  comWhatsApp: boolean;
  /** Teste do dono: sem folga, cada passo vence logo que o anterior sai. */
  rapido?: boolean;
};

export type Plano = Record<Passo, Date | null>;

/**
 * Quando vence cada passo que ainda não saiu (os que saíram ficam null).
 *
 * A âncora de cada passo é o toque anterior (enviado ou, se ainda não saiu, o
 * horário planejado dele) ou o último movimento no site, o que for mais tarde:
 * quem volta ao site depois do E1 e para de novo recomeça a contar dali, como
 * sempre foi (core.ts reagenda a cada passo do site).
 */
export function planoDaSequencia(s: EstadoDaSequencia): Plano {
  const plano: Plano = { 1: null, 2: null, 3: null, 4: null };
  let anterior: Date | null = null;
  for (const passo of PASSOS) {
    if (passo === 4 && !s.comWhatsApp) break;
    const enviado = s.enviados[passo];
    if (enviado) {
      anterior = enviado;
      continue;
    }
    const ancora = anterior && anterior.getTime() > s.parouEm.getTime() ? anterior : s.parouEm;
    let vence: Date;
    if (s.rapido) vence = ancora;
    else if (passo === 1) vence = vencimentoDoEmail1(s.parouEm);
    else if (passo === 4) vence = vencimentoDoWhatsApp(ancora);
    else vence = vencimentoDoProximoEmail(ancora);
    plano[passo] = vence;
    anterior = vence;
  }
  return plano;
}

/**
 * A trava de segurança na hora do envio, independente do horário gravado:
 * o passo anterior tem que ter saído, e há pelo menos 12 horas (e-mail) ou
 * 5 horas (WhatsApp). Horário gravado errado, lead antigo ou mão humana no
 * banco não furam isto; só o modo rápido do teste.
 */
export function folgaCumprida(passo: Passo, enviados: Partial<Record<Passo, Date | null>>, agora: Date, rapido = false): boolean {
  if (passo === 1) return true;
  const anterior = enviados[(passo - 1) as Passo];
  if (!anterior) return false;
  if (rapido) return true;
  const minimo = (passo === 4 ? FOLGA_WHATSAPP_HORAS : FOLGA_EMAIL_HORAS) * HORA;
  return agora.getTime() - anterior.getTime() >= minimo;
}
