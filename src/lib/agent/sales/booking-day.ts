/**
 * Lê a data que o Mike gravou em `booking_day`.
 *
 * O campo é texto livre no respond.io, e quem preenche é um agente conversando
 * em inglês com um cliente em Londres. Então chega "Tuesday", "15 Aug",
 * "tomorrow", "15/08" e "2026-08-15" — tudo misturado.
 *
 * A regra que governa este módulo: **na dúvida, devolve null.** Um job criado
 * com a data errada manda um parceiro para a casa do cliente no dia errado, o
 * que custa o job e a reputação. Um null vira pendência para o Victor olhar, o
 * que custa dois minutos. Os custos não se comparam, então o parser é
 * deliberadamente covarde: só aceita o que reconhece sem ambiguidade.
 *
 * Timezone: tudo é Europe/London, porque é onde o cliente e o parceiro estão.
 */

const MESES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DIAS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function valida(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rejeita 31 de fevereiro e afins: o Date normaliza em silêncio para 3 de
  // março, e uma data normalizada em silêncio é exatamente o erro caro.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return iso(y, m, d);
}

/**
 * `hoje` é injetado em vez de lido do relógio para que o teste seja determinístico
 * e para que "Tuesday" signifique a mesma coisa toda vez.
 */
export function parseBookingDay(raw: string | null | undefined, hoje: Date): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;

  const hojeY = hoje.getUTCFullYear();
  const hojeM = hoje.getUTCMonth() + 1;
  const hojeD = hoje.getUTCDate();

  // ── ISO, o caso feliz ────────────────────────────────────────────────────
  const isoM = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) return valida(+isoM[1], +isoM[2], +isoM[3]);

  // ── relativo ─────────────────────────────────────────────────────────────
  if (/^(today|hoje)\b/.test(t)) return iso(hojeY, hojeM, hojeD);
  if (/^(tomorrow|amanh[ãa])\b/.test(t)) {
    const d = new Date(Date.UTC(hojeY, hojeM - 1, hojeD + 1));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // ── dia/mês numérico ─────────────────────────────────────────────────────
  // UK lê 08/09 como 8 de setembro. Um cliente americano leria 9 de agosto, e
  // não há como distinguir, mas o negócio é em Londres: dia primeiro.
  const dm = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (dm) {
    const dia = +dm[1];
    const mes = +dm[2];
    let ano = dm[3] ? +dm[3] : hojeY;
    if (ano < 100) ano += 2000;
    const r = valida(ano, mes, dia);
    // Sem ano explícito e a data já passou: o cliente quer o ano que vem.
    if (r && !dm[3] && r < iso(hojeY, hojeM, hojeD)) return valida(ano + 1, mes, dia);
    return r;
  }

  // ── "15 Aug" / "Aug 15" / "15 August 2026" ───────────────────────────────
  const mesNome = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (mesNome) {
    const mes = MESES[mesNome[1]];
    const numeros = [...t.matchAll(/\b(\d{1,4})\b/g)].map((m) => +m[1]);
    const dia = numeros.find((n) => n >= 1 && n <= 31);
    const anoExplicito = numeros.find((n) => n >= 2020 && n <= 2100);
    if (dia !== undefined) {
      const ano = anoExplicito ?? hojeY;
      const r = valida(ano, mes, dia);
      if (r && !anoExplicito && r < iso(hojeY, hojeM, hojeD)) return valida(ano + 1, mes, dia);
      return r;
    }
  }

  // ── nome do dia da semana ────────────────────────────────────────────────
  // "Tuesday" significa a próxima terça, nunca hoje: quem diz o nome do dia
  // está marcando o futuro. Se fosse hoje, teria dito "today".
  const diaNome = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (diaNome) {
    const alvo = DIAS[diaNome[1]];
    const atual = new Date(Date.UTC(hojeY, hojeM - 1, hojeD)).getUTCDay();
    const delta = ((alvo - atual + 7) % 7) || 7;
    const d = new Date(Date.UTC(hojeY, hojeM - 1, hojeD + delta));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // "next week", "asap", "when you're free": não é data. Vira pendência.
  return null;
}

/**
 * As janelas de chegada que a operação oferece. O campo `Booking_Window` no
 * respond.io é uma **lista fechada** com exatamente estes valores, e é de
 * propósito: janela livre faria o Mike prometer horário que o parceiro não
 * atende, e ainda traria de volta o problema de parsing que a lista elimina.
 */
export const JANELAS = ["08:00 - 12:00", "12:00 - 16:00", "16:00 - 20:00", "08:00 - 17:00"] as const;

/**
 * Normaliza a janela de chegada para o formato que o OS espera ("HH:MM - HH:MM").
 *
 * O caminho normal é o Mike escolher da lista, e aí isto só valida. O resto do
 * parser existe porque o campo pode ser preenchido à mão no painel, e porque
 * "morning" é o que um cliente responde quando perguntado.
 */
export function parseArrivalWindow(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;

  if (/\ball\s*day\b|\bfull\s*day\b/.test(t)) return "08:00 - 17:00";
  if (/\bmorning\b|\bmanh[ãa]\b|\bam\b$/.test(t)) return "08:00 - 12:00";
  if (/\bafternoon\b|\btarde\b/.test(t)) return "12:00 - 16:00";
  if (/\bevening\b|\bnoite\b/.test(t)) return "16:00 - 20:00";

  // "08:00 - 12:00", "8-12", "8am - 12pm", "08.00–12.00"
  const m = t.match(/\b(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\s*(?:-|–|—|to|até|as)\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?/);
  if (!m) return null;

  const hora = (h: string, min: string | undefined, sufixo: string | undefined): number | null => {
    let n = Number(h);
    if (Number.isNaN(n) || n < 0 || n > 24) return null;
    if (sufixo === "pm" && n < 12) n += 12;
    if (sufixo === "am" && n === 12) n = 0;
    const mm = min ? Number(min) : 0;
    if (mm > 59) return null;
    return n * 60 + mm;
  };

  const ini = hora(m[1], m[2], m[3]);
  const fim = hora(m[4], m[5], m[6]);
  if (ini === null || fim === null) return null;

  // Sem sufixo, "8 - 5" quer dizer 08:00–17:00, não 08:00–05:00. Um horário que
  // termina antes de começar é quase sempre isso.
  const fimCorrigido = fim <= ini && !m[6] && fim + 12 * 60 > ini ? fim + 12 * 60 : fim;
  if (fimCorrigido <= ini) return null;

  const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return `${fmt(ini)} - ${fmt(fimCorrigido)}`;
}
