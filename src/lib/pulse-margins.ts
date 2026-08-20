/**
 * As duas margens do Pulse em porcentagem, medidas contra a meta do Setup.
 *
 * Os cards mostravam só libras: £12.059 de receita, £7.420 de custo operacional
 * e £1.952 de margem líquida. Em libras não dá para saber se o mês foi bom sem
 * fazer a conta de cabeça, e é a porcentagem que se compara com a meta, com o
 * mês passado e com o resto do mercado.
 *
 * Duas margens, e elas medem coisas diferentes:
 *
 *   BRUTA    (receita − custo operacional) / receita. É o que sobra do trabalho
 *            em si, antes de pagar a estrutura. A meta mora em
 *            `target_margin_pct` do Setup (padrão 40%).
 *   LÍQUIDA  (receita − custo operacional − custo fixo) / receita. É o que
 *            sobra de verdade. A meta mora em `pulse_healthy_net_margin_pct`
 *            (padrão 30%).
 *
 * Função pura: recebe números, devolve números. Sem banco, sem rede.
 */

/**
 * A margem em porcentagem, ou `null` quando não existe conta a fazer.
 *
 * `null` e não zero: período sem receita não tem margem 0%, tem margem
 * nenhuma, e mostrar "0%" num período vazio faz o card parecer um alerta
 * quando ele só está esperando o primeiro job.
 */
export function margemPct(sobra: number, receita: number): number | null {
  if (!Number.isFinite(sobra) || !Number.isFinite(receita)) return null;
  if (receita <= 0) return null;
  return (sobra / receita) * 100;
}

export type MargemDoPeriodo = {
  /** A porcentagem, já arredondada para inteiro. `null` quando não há receita. */
  pct: number | null;
  /** A meta do Setup para esta margem. */
  alvo: number;
  /**
   * Como está contra a meta. `sem_dado` quando não há receita no período.
   *
   * `no_alvo` a partir de 90% da meta, e não só quando bate: uma margem de 38%
   * contra uma meta de 40 não é um problema, e pintar de vermelho todo mês que
   * chega perto ensina o time a ignorar a cor.
   */
  situacao: "acima" | "no_alvo" | "abaixo" | "sem_dado";
};

function situacaoDaMargem(pct: number | null, alvo: number): MargemDoPeriodo["situacao"] {
  if (pct == null) return "sem_dado";
  if (pct >= alvo) return "acima";
  if (alvo > 0 && pct >= alvo * 0.9) return "no_alvo";
  return "abaixo";
}

function montar(sobra: number, receita: number, alvo: number): MargemDoPeriodo {
  const bruto = margemPct(sobra, receita);
  const pct = bruto == null ? null : Math.round(bruto);
  // A situação sai do valor CRU, não do arredondado: 39,6% contra meta de 40
  // não deve virar "acima" só porque o card escreve 40%.
  return { pct, alvo, situacao: situacaoDaMargem(bruto, alvo) };
}

/** Margem bruta: o que sobra do trabalho antes da estrutura. */
export function margemBruta(input: {
  receita: number;
  custoOperacional: number;
  alvoPct?: number | null;
}): MargemDoPeriodo {
  return montar(input.receita - input.custoOperacional, input.receita, input.alvoPct ?? 40);
}

/** Margem líquida: o que sobra depois de tudo, inclusive o custo fixo. */
export function margemLiquida(input: {
  receita: number;
  margemLiquidaGbp: number;
  alvoPct?: number | null;
}): MargemDoPeriodo {
  return montar(input.margemLiquidaGbp, input.receita, input.alvoPct ?? 30);
}
