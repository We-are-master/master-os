/**
 * De quem é este e-mail: a organização, ou ninguém.
 *
 * O Harvey só age quando sabe de qual organização veio o pedido (dono,
 * 03/09/2026). Esta é a única função que responde isso, e ela responde pelo
 * DOMÍNIO do remetente — não pelo nome da empresa escrito no texto.
 *
 * ─── Por que domínio e não nome no texto ────────────────────────────────
 *
 * O `acharConta` do quoter procura o nome da empresa dentro do assunto e do
 * corpo. Funciona para plataforma, que assina tudo, e falha para gente: os
 * assuntos reais da Kvadrat em agosto foram "Couple of lights to replace",
 * "Door handle + Painter" e "Cupboard fix". Nenhum diz Kvadrat. Todos vieram
 * de `mase@kvadrat.org`.
 *
 * O domínio está no cadastro, não muda, e é o mesmo dado que o Zendesk usa
 * para colar usuário em organização. Uma fonte, dois sistemas.
 */

/**
 * Domínio de e-mail pessoal nunca prova organização (dono, 03/09/2026:
 * "nunca age").
 *
 * Uma pessoa da Kvadrat escrevendo do gmail continua sendo uma pessoa da
 * Kvadrat, e o pedido dela continua valendo — o que não vale é o robô
 * assumir isso sozinho. Cai em nota interna e um humano decide.
 */
const DOMINIOS_PESSOAIS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "outlook.co.uk",
  "live.com",
  "live.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aol.co.uk",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.co.uk",
  "msn.com",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
]);

/** O nosso próprio domínio: e-mail encaminhado por nós não é do cliente. */
const DOMINIOS_DA_CASA = new Set(["getfixfy.com", "fixfy.com"]);

export type OrganizacaoConhecida = {
  id: string;
  nome: string;
  /** Domínios que provam esta organização. Já em minúsculas, sem `@`. */
  dominios: string[];
};

export type Reconhecimento =
  | { tipo: "organizacao"; id: string; nome: string; dominio: string }
  /** Domínio pessoal, nosso, ou e-mail inválido: não prova nada. */
  | { tipo: "sem_prova"; motivo: string }
  /** Domínio de empresa que não é organização nossa. */
  | { tipo: "desconhecida"; dominio: string };

/**
 * O domínio de um endereço, tolerando o que está cadastrado errado.
 *
 * Duas organizações do Zendesk têm um e-mail INTEIRO no campo de domínio
 * (`alice.pilmoor@homyze.com`, `madeniyan@crownworthydiy.co.uk`). Casar por
 * igualdade contra isso falha calado, que é o pior jeito de falhar: parece
 * que a organização não existe. Aqui o `@` é sempre cortado, dos dois lados.
 */
export function dominioDe(email: string | null | undefined): string | null {
  const bruto = String(email ?? "").trim().toLowerCase();
  if (!bruto) return null;
  const depoisDoArroba = bruto.includes("@") ? bruto.split("@").pop()! : bruto;
  const limpo = depoisDoArroba.replace(/^www\./, "").replace(/[>,;\s]+$/, "").trim();
  // Um domínio tem ponto e nada de espaço. "n/a" e "0" chegam da macro do
  // Zendesk quando o campo fica em branco.
  if (!limpo.includes(".") || /\s/.test(limpo)) return null;
  return limpo;
}

/**
 * Sufixo conta como o mesmo domínio: `email.checkatrade.com` é Checkatrade.
 *
 * Eles mandam de cinco subdomínios diferentes (clicks., email., services.,
 * updates.) e cadastrar um por um é lista que envelhece sozinha.
 */
function mesmoDominio(dominioDoEmail: string, dominioDaOrg: string): boolean {
  if (dominioDoEmail === dominioDaOrg) return true;
  return dominioDoEmail.endsWith(`.${dominioDaOrg}`);
}

/**
 * Quem mandou este e-mail.
 *
 * `organizacoes` vem do banco já normalizado (ver `carregarOrganizacoes`).
 * Ordem de decisão, e ela importa:
 *
 *   1. sem domínio legível  → sem prova
 *   2. domínio nosso        → sem prova (encaminhamento do escritório)
 *   3. domínio pessoal      → sem prova (regra do dono)
 *   4. casa com organização → organização
 *   5. resto                → desconhecida
 *
 * "sem prova" e "desconhecida" terminam no mesmo lugar hoje (nota interna e
 * para), mas são coisas diferentes e a nota diz qual foi: uma pede que
 * alguém confirme a pessoa, a outra pede que alguém cadastre a empresa.
 */
export function reconhecerOrganizacao(
  email: string | null | undefined,
  organizacoes: readonly OrganizacaoConhecida[],
): Reconhecimento {
  const dominio = dominioDe(email);
  if (!dominio) return { tipo: "sem_prova", motivo: "no readable email domain" };
  if (DOMINIOS_DA_CASA.has(dominio)) {
    return { tipo: "sem_prova", motivo: "sent from our own domain (forwarded by the office)" };
  }
  if (DOMINIOS_PESSOAIS.has(dominio)) {
    return { tipo: "sem_prova", motivo: `personal email domain (${dominio})` };
  }

  /**
   * O mais específico ganha.
   *
   * Sem isto, uma organização cadastrada com um domínio curto engoliria a de
   * um subdomínio dela. Ordenar por tamanho do domínio casado resolve sem
   * precisar de prioridade escrita à mão em lugar nenhum.
   */
  let melhor: { org: OrganizacaoConhecida; dominio: string } | null = null;
  for (const org of organizacoes) {
    for (const d of org.dominios) {
      if (!mesmoDominio(dominio, d)) continue;
      if (!melhor || d.length > melhor.dominio.length) melhor = { org, dominio: d };
    }
  }
  if (melhor) {
    return { tipo: "organizacao", id: melhor.org.id, nome: melhor.org.nome, dominio: melhor.dominio };
  }
  return { tipo: "desconhecida", dominio };
}

/** `true` quando o Harvey pode agir sozinho neste e-mail. */
export const podeAgir = (r: Reconhecimento): boolean => r.tipo === "organizacao";

/**
 * Este domínio pode ser cadastrado como prova de uma organização?
 *
 * Serve ao CADASTRO, não à leitura: o reconhecedor já recusa pessoal e nosso
 * antes de casar, mas gravar `gmail.com` na lista de domínios de uma conta
 * seria uma bomba esperando alguém tirar o guarda. A conta interna Fixfy tem
 * gmail no contato, e é exatamente esse o caso.
 */
export function dominioProvaOrganizacao(dominio: string | null | undefined): boolean {
  const d = dominioDe(dominio);
  if (!d) return false;
  return !DOMINIOS_PESSOAIS.has(d) && !DOMINIOS_DA_CASA.has(d);
}
