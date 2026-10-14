/**
 * A conta do "quando roda", no relógio de LONDRES, sem biblioteca.
 *
 * Duas formas de agenda, as mesmas duas que o launchd usava:
 *
 *   intervalo  a cada N minutos, alinhado ao relógio (de 10 em 10 = :00, :10,
 *              :20...). Alinhar em vez de contar "desde que subiu" deixa o log
 *              previsível e não muda nada a cada redeploy.
 *   diario     horários "HH:MM" de Londres, opcionalmente só em alguns dias
 *              da semana (0 = domingo ... 6 = sábado, como o Date).
 *
 * Por que Londres e não o relógio da máquina: o Railway roda em UTC, o Mac já
 * rodou em UTC-3 e hoje roda em Londres. Cada troca dessas escorregou um
 * horário fixo (é o que aconteceu com o e-mail das 17h, que passou a disparar
 * às 13h de Londres e cair fora da própria janela). Aqui o horário é sempre de
 * parede em Londres, e a virada de horário (BST <-> GMT) muda o instante UTC,
 * não a hora que a rotina vê.
 *
 * Horário que não existe (a hora pulada na virada de março) é saltado naquele
 * dia. Horário que existe duas vezes (a hora repetida de outubro) roda uma vez
 * só. Nenhuma rotina de hoje cai entre 1h e 2h da manhã, mas a conta é honesta.
 */

export type Agenda =
  | { tipo: "intervalo"; minutos: number }
  | { tipo: "diario"; horarios: string[]; diasDaSemana?: number[] };

const FUSO = "Europe/London";

const formatador = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number; segundo: number };

/** O instante visto da parede de Londres. */
export function partesEmLondres(d: Date): Partes {
  const p = Object.fromEntries(formatador.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

/** Quanto Londres está à frente do UTC neste instante, em ms (0 no GMT, 1h no BST). */
function deslocamentoMs(d: Date): number {
  const p = partesEmLondres(d);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * O instante UTC de uma hora de parede em Londres. `null` quando essa hora não
 * existe naquele dia (a hora pulada da virada de março).
 */
export function londresParaUtc(ano: number, mes: number, dia: number, hora: number, minuto: number): Date | null {
  const ingenuo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let t = ingenuo - deslocamentoMs(new Date(ingenuo));
  t = ingenuo - deslocamentoMs(new Date(t));
  const p = partesEmLondres(new Date(t));
  if (p.ano !== ano || p.mes !== mes || p.dia !== dia || p.hora !== hora || p.minuto !== minuto) return null;
  return new Date(t);
}

function lerHorario(h: string): { hora: number; minuto: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
  if (!m) throw new Error(`horário inválido: "${h}" (use HH:MM)`);
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) throw new Error(`horário inválido: "${h}"`);
  return { hora, minuto };
}

/** A próxima execução ESTRITAMENTE depois de `depois`. */
export function proximaExecucao(agenda: Agenda, depois: Date): Date {
  if (agenda.tipo === "intervalo") {
    if (!(agenda.minutos > 0)) throw new Error("intervalo precisa de minutos > 0");
    const passo = agenda.minutos * 60_000;
    return new Date((Math.floor(depois.getTime() / passo) + 1) * passo);
  }

  const horarios = agenda.horarios.map(lerHorario).sort((a, b) => a.hora - b.hora || a.minuto - b.minuto);
  if (!horarios.length) throw new Error("agenda diária sem horários");
  const dias = agenda.diasDaSemana;
  const hoje = partesEmLondres(depois);

  // Oito dias cobrem qualquer combinação de dias da semana.
  for (let i = 0; i <= 8; i++) {
    const base = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + i));
    const ano = base.getUTCFullYear();
    const mes = base.getUTCMonth() + 1;
    const dia = base.getUTCDate();
    if (dias && !dias.includes(base.getUTCDay())) continue;
    for (const { hora, minuto } of horarios) {
      const t = londresParaUtc(ano, mes, dia, hora, minuto);
      if (t && t.getTime() > depois.getTime()) return t;
    }
  }
  throw new Error("agenda sem próxima execução em 8 dias (dias da semana vazios?)");
}

const NOMES_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Uma linha legível da agenda, para o log e o --ensaio. */
export function descreverAgenda(agenda: Agenda): string {
  if (agenda.tipo === "intervalo") return `a cada ${agenda.minutos} min`;
  const dias = agenda.diasDaSemana ? ` (${agenda.diasDaSemana.map((d) => NOMES_DIAS[d]).join(",")})` : " (todo dia)";
  return `${agenda.horarios.join(", ")} Londres${dias}`;
}

/** "2026-10-25 07:02 GMT" — a data na parede de Londres, com o fuso do dia. */
export function formatarLondres(d: Date): string {
  const p = partesEmLondres(d);
  const zona = deslocamentoMs(d) === 0 ? "GMT" : "BST";
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${p.ano}-${dd(p.mes)}-${dd(p.dia)} ${dd(p.hora)}:${dd(p.minuto)} ${zona}`;
}
