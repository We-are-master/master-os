/**
 * Os cupons da temporada, num lugar só.
 *
 * Esta lista é a fonte da verdade para três coisas ao mesmo tempo:
 *
 *   1. o que a agenda de e-mails promete (`src/lib/email-sequences/agenda.ts`)
 *   2. o que o script cria na Stripe (`scripts/marketing-cupons.mts`)
 *   3. o que o site aceita no campo "Have a promo code?" do checkout
 *
 * Se o código aqui não existir na Stripe, o cliente lê a oferta no e-mail e
 * leva "Promo codes are not available right now" na cara do pagamento. Por
 * isso o script de criação sai do mesmo arquivo: não existe versão do cupom
 * que esteja só num dos lados.
 *
 * ── A conta da margem, para ninguém decidir desconto no escuro ──────────────
 *
 * Em limpeza B2C o parceiro leva 70% do preço cheio, então a margem bruta é
 * 30%. Ou seja: 10% de desconto come um terço da margem, 15% come metade, e
 * 30% zera. É por isso que quase tudo aqui é percentual de 10%, os 15% só
 * aparecem nas três viradas de estação, e valor fixo só existe onde o ticket é
 * grande (pintura) ou onde o desconto é indicação, que é custo de aquisição
 * assumido de propósito.
 *
 * A Stripe até guarda gasto mínimo no promotion code
 * (`restrictions.minimum_amount`), e o script o preenche, mas o `/api/b2c/promo`
 * do site ainda não lê essa restrição. Ou seja: hoje valor fixo em job barato
 * vira desconto enorme sem ninguém perceber, £25 num handyman de £90 é 28%.
 * Percentual não tem esse risco, e é essa a razão de ele ser o padrão aqui.
 */

export type Cupom = {
  /** O código que o cliente digita. Maiúsculas, sem espaço, fácil de ditar. */
  codigo: string;
  /**
   * O nome do cupom, EM INGLÊS.
   *
   * Não é rótulo interno: ele aparece na caixa da oferta dentro do e-mail e no
   * recibo da Stripe. Quem lê é cliente em Londres. O texto interno de cada
   * cupom fica em `proposito`.
   */
  nome: string;
  /** Percentual (1 a 100) ou valor fixo em pence. Um dos dois, nunca os dois. */
  percentual?: number;
  pence?: number;
  /** Último dia em que o código funciona (fim do dia, hora de Londres). */
  expiraEm: string;
  /** Teto de usos. Nulo = sem teto. Protege contra o código vazar em fórum. */
  maxUsos?: number;
  /**
   * Gasto mínimo, em pence, para o código valer.
   *
   * Só faz sentido em cupom de valor fixo: £50 de desconto num job de £90 é
   * metade do preço. A Stripe guarda isso em `restrictions.minimum_amount` no
   * promotion code. Atenção: o `/api/b2c/promo` do site ainda não lê essa
   * restrição, então hoje ela protege o lado da Stripe (links de pagamento,
   * checkout hospedado) e não o funil do site. Ler lá é um ajuste de uma linha.
   */
  minimoPence?: number;
  /** Para que serve, em uma linha. Vai na metadata da Stripe e no painel. */
  proposito: string;
};

/** O dia em que a temporada começa. Muda aqui, muda a agenda inteira. */
export const INICIO_DA_TEMPORADA = "2026-09-28";

/** Fim da temporada de seis meses. É o que os cupons usam como teto natural. */
export const FIM_DA_TEMPORADA = "2027-03-31";

export const CUPONS: Cupom[] = [
  /* ── Sempre válidos: entrada, indicação e volta ───────────────────────── */
  {
    codigo: "WELCOME10",
    nome: "Fixfy · your first booking",
    percentual: 10,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "Quem pediu preço e ainda não fechou. É o cupom do funil de 30 dias.",
  },
  {
    codigo: "REFER20",
    nome: "Fixfy · referral",
    pence: 2000,
    minimoPence: 10000,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "Indicação de cliente. £20 é custo de aquisição assumido, não é margem perdida por acaso.",
  },
  {
    codigo: "COMEBACK15",
    nome: "Fixfy · welcome back",
    percentual: 15,
    expiraEm: FIM_DA_TEMPORADA,
    maxUsos: 200,
    proposito: "Quem comprou uma vez e sumiu. Vale meia margem porque trazer de volta custa menos que achar novo.",
  },
  {
    codigo: "LOYAL15",
    nome: "Fixfy · thank you",
    percentual: 15,
    expiraEm: FIM_DA_TEMPORADA,
    maxUsos: 300,
    proposito: "Agradecimento de fim de temporada para quem já comprou mais de uma vez.",
  },

  /* ── Outubro: entrada da estação ──────────────────────────────────────── */
  {
    codigo: "AUTUMN15",
    nome: "Fixfy · autumn deep clean",
    percentual: 15,
    expiraEm: "2026-11-02",
    maxUsos: 150,
    proposito: "Virada de estação. Uma das três vezes no ano em que vale meia margem.",
  },
  {
    codigo: "OVEN10",
    nome: "Fixfy · oven clean",
    percentual: 10,
    expiraEm: "2027-01-15",
    proposito: "Forno é o serviço que ninguém quer fazer sozinho. Vale o ano inteiro de frio.",
  },
  {
    codigo: "MOVEOUT10",
    nome: "Fixfy · end of tenancy clean",
    percentual: 10,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "Saída de imóvel, o serviço âncora do B2C.",
  },

  /* ── Novembro: preparar para o frio ───────────────────────────────────── */
  {
    codigo: "WINTER10",
    nome: "Fixfy · winter prep visit",
    percentual: 10,
    expiraEm: "2026-12-15",
    proposito: "Calhas, radiadores, isolamento. Visita de manutenção antes do frio apertar.",
  },
  {
    codigo: "CARPET10",
    nome: "Fixfy · carpet clean",
    percentual: 10,
    expiraEm: "2027-03-01",
    proposito: "Carpete antes das visitas de fim de ano e depois do meio-termo de fevereiro.",
  },
  {
    codigo: "FIXFYFRIDAY15",
    nome: "Fixfy · Fixfy Friday week",
    percentual: 15,
    expiraEm: "2026-12-01",
    maxUsos: 200,
    proposito: "A semana em que o Reino Unido inteiro compra. A segunda das três meias margens.",
  },

  /* ── Dezembro: casa cheia ─────────────────────────────────────────────── */
  {
    codigo: "FESTIVE10",
    nome: "Fixfy · pre-Christmas clean",
    percentual: 10,
    expiraEm: "2026-12-23",
    proposito: "Casa pronta para receber. Semana de pico de limpeza doméstica.",
  },
  {
    codigo: "RESET10",
    nome: "Fixfy · new year reset clean",
    percentual: 10,
    expiraEm: "2027-01-05",
    proposito: "A semana morta do calendário, que é quando o parceiro tem agenda livre.",
  },

  /* ── Janeiro: recomeço ────────────────────────────────────────────────── */
  {
    codigo: "JANUARY15",
    nome: "Fixfy · January reset",
    percentual: 15,
    expiraEm: "2027-02-01",
    maxUsos: 200,
    proposito: "Terceira e última meia margem da temporada. Janeiro é o mês de maior intenção.",
  },
  {
    codigo: "REGULAR10",
    nome: "Fixfy · regular cleaning",
    percentual: 10,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "Quinzenal ou semanal. O desconto se paga na segunda visita, porque é receita recorrente.",
  },
  {
    codigo: "PAINT50",
    nome: "Fixfy · painting a room",
    pence: 5000,
    minimoPence: 30000,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "Valor fixo só aqui porque pintura tem ticket alto: £50 em £500 é 10%, não é metade da margem.",
  },

  /* ── Fevereiro: certificados e visitas ────────────────────────────────── */
  {
    codigo: "LANDLORD10",
    nome: "Fixfy · landlord certificate bundle",
    percentual: 10,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "EICR, gás e EPC no mesmo pedido. Cliente que volta todo ano.",
  },
  {
    codigo: "HANDY10",
    nome: "Fixfy · handyman half day",
    percentual: 10,
    expiraEm: FIM_DA_TEMPORADA,
    proposito: "A lista pequena da casa, resolvida numa visita só.",
  },
  {
    codigo: "WINDOW10",
    nome: "Fixfy · window clean",
    percentual: 10,
    expiraEm: "2027-03-31",
    proposito: "Sujeira de inverno nos vidros, serviço curto e fácil de encaixar em rota.",
  },

  /* ── Março: primavera ─────────────────────────────────────────────────── */
  {
    codigo: "SPRING15",
    nome: "Fixfy · spring clean",
    percentual: 15,
    expiraEm: "2027-04-15",
    maxUsos: 200,
    proposito: "Abertura da temporada de mudanças, que é quando o end of tenancy dispara.",
  },
];

export function acharCupom(codigo: string): Cupom | null {
  const c = codigo.trim().toUpperCase();
  return CUPONS.find((x) => x.codigo === c) ?? null;
}

/** "10% off" ou "£20 off", do jeito que vai no e-mail. */
export function comoSeLe(cupom: Cupom): string {
  return cupom.percentual ? `${cupom.percentual}% off` : `£${((cupom.pence ?? 0) / 100).toFixed(0)} off`;
}

/** "31 March" para o e-mail: dia e mês, sem ano, que é como se lê uma validade. */
export function validadeCurta(cupom: Cupom): string {
  return new Date(`${cupom.expiraEm}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });
}
