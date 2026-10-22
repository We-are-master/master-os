/**
 * Contas de origem que são cliente DIRETO nosso, além da conta "Fixfy".
 *
 * Decisão do dono em 13/10/2026: o lead comprado no Checkatrade que fecha e paga
 * direto com a gente fica numa conta própria, "Checkatrade", separada da
 * "Express" (as reservas que a plataforma agenda e paga). O contrato é entre o
 * morador e nós, então para documento, VAT e relatório ele é B2C igual ao site.
 *
 * Está escrito aqui, e não só numa variável de ambiente, para a decisão ficar
 * visível a quem lê o código. `DIRECT_CONSUMER_ACCOUNT_IDS` abre exceção por id,
 * separado por vírgula.
 *
 * 22/10/2026: a conta "Checkatrade" foi arquivada (migration 350). O lead da
 * Checkatrade é cliente da conta Fixfy com origem `checkatrade`, e a lista ficou
 * vazia. A Express continua conta de plataforma.
 */
const CONTAS_DIRETAS: string[] = [];

export function directConsumerAccountIds(): Set<string> {
  const ids = [...CONTAS_DIRETAS, ...(process.env.DIRECT_CONSUMER_ACCOUNT_IDS ?? "").split(",")];
  return new Set(ids.map((i) => i.trim().toLowerCase()).filter(Boolean));
}

export function isDirectConsumerAccount(accountId: string | null | undefined): boolean {
  const id = String(accountId ?? "").trim().toLowerCase();
  return id !== "" && directConsumerAccountIds().has(id);
}
