/**
 * O texto do job, limpo do que não é trabalho.
 *
 * Um scope é lido por três pessoas: o parceiro que vai executar, o escritório
 * que vai cobrar, e o cliente quando algo dá errado. Nenhuma delas ganha nada
 * com o resto: o horário solto que a plataforma imprime ao lado de uma
 * mensagem, a data da visita repetida de um campo que o job já tem, e o nome
 * de quem nos passou o trabalho.
 *
 * Roda no `/api/jobs`, que é por onde TODO agente cria job. Ser um ponto só é
 * de propósito. A regra vinha sendo aplicada em cada agente, e cada agente
 * novo tinha que lembrar dela sozinho: em 22/08/2026 havia 21 jobs com
 * horário solto no scope e 19 com o nome da conta, todos de agentes que
 * "sabiam" da regra. Aqui não há como esquecer.
 */

/**
 * Quem nos passa trabalho nunca aparece no texto do job.
 *
 * O parceiro que lê o scope não precisa saber de onde veio, e é a nossa
 * relação com a conta que está em jogo se souber. A lista é de nomes de
 * plataforma, não de clientes: o nome do morador é outro assunto, e quem
 * cuida dele é o agente que extrai o card.
 */
const PLATAFORMAS = [
  "checkatrade",
  "housekeep",
  "fantastic services",
  "fantastic",
  "homyze",
  "kvadrat",
  "li & fung",
  "li and fung",
  "good place lettings",
  "good place",
  "stylesmiths",
  "the stylesmiths",
];

/** `10:36`, `9:05 am`, `13.55`: hora que sobrou de um print de conversa. */
const SO_UM_HORARIO = /^\d{1,2}[:.]\d{2}(\s*(am|pm))?$/i;

/**
 * Data e janela já são campos do job (`scheduled_date`, `scheduled_start_at`).
 * Repetidas no texto elas envelhecem: quando o escritório remarca, o campo
 * muda e a linha do scope continua dizendo o dia velho. Uma remarcação e o
 * scope vira mentira, então a linha sai e o campo manda.
 */
const ROTULO_REPETIDO =
  /^(visit date|booked arrival time|arrival time|arrival window|arrival|date|time|scheduled(\s+(date|time))?)\s*[:\-]/i;

/** `checkatrade-lead:8827` prova cobertura no reconcile. Fica. */
const MARCADOR_DE_COBERTURA = /^[a-z-]+-lead:\s*\S+/i;

function citaPlataforma(linha: string, extras: string[]): boolean {
  const t = linha.toLowerCase();
  if (MARCADOR_DE_COBERTURA.test(linha.trim())) return false;
  return [...PLATAFORMAS, ...extras.map((e) => e.toLowerCase())].some((nome) => {
    const n = nome.trim();
    if (n.length < 3) return false;
    return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
  });
}

/**
 * Tira a linha inteira, não só a palavra.
 *
 * Apagar "Checkatrade" no meio de "This is a Checkatrade Express job. We told
 * the customer that..." deixa uma frase quebrada que o parceiro lê e não
 * entende. A linha que precisa nomear a plataforma é sempre linha de
 * plataforma, nunca descrição de trabalho: some inteira.
 */
export function limparScope(
  texto: string | null | undefined,
  opcoes?: {
    nomesProibidos?: string[];
    /**
     * Guarda as linhas de data e janela em vez de tirá-las.
     *
     * Serve para o backfill do que já está gravado, e não para job novo. Em
     * 22/08/2026, de 84 jobs antigos que tinham a janela escrita no scope, 46
     * discordavam do campo do job, 31 deles em exatamente uma hora. Enquanto
     * essa diferença não tiver explicação, aquela linha é o único registro do
     * que a plataforma prometeu ao morador, e apagá-la apaga a prova junto.
     */
    manterJanela?: boolean;
  },
): string | null {
  if (!texto) return texto ?? null;
  const extras = (opcoes?.nomesProibidos ?? []).filter((n) => n && n.trim().length >= 3);

  const mantidas = texto.split("\n").filter((linha) => {
    const t = linha.trim();
    if (!t) return true; // linha em branco decide parágrafo; o colapso vem depois
    if (SO_UM_HORARIO.test(t)) return false;
    if (!opcoes?.manterJanela && ROTULO_REPETIDO.test(t)) return false;
    if (citaPlataforma(t, extras)) return false;
    return true;
  });

  const limpo = mantidas
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return limpo || null;
}
