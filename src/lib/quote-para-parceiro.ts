/**
 * O que o parceiro pode ler de uma quote.
 *
 * Quem nos passa o trabalho nunca aparece para quem executa. Vale para o nome
 * da conta ("Housekeep"), para o nome de quem atende por ela ("Yosheeta
 * (Housekeep Support)") e para o assunto que o e-mail deles carimba
 * ("[Housekeep] Quote Request – Wallpapering Feature Wall").
 *
 * A regra mora aqui e não em cada porta, pela mesma razão do `limparScope`: em
 * 09/09/2026 as três superfícies de parceiro discordavam entre si. O portal já
 * mandava "Customer", e as outras duas mandavam o nome da conta cru. Uma
 * delas, a QT-2026-1139, já tinha saído para seis parceiros.
 *
 * O nome do cliente não é filtrado: ele simplesmente não existe nesta saída.
 * Filtrar exige uma lista, e lista esquece a conta que entrou ontem. No
 * estágio de bid o parceiro ainda não vai à casa, então não há nada a perder:
 * quem ganha o bid vira job, e é o job que carrega o nome do morador.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { limparScope } from "@/lib/scope-limpo";
import { resolveQuoteTypeOfWorkLabel } from "@/lib/quote-type-of-work-label";

/** O que vai no lugar do nome. Um só, para as três portas dizerem o mesmo. */
export const CLIENTE_PARA_PARCEIRO = "Customer";

/** Quando não sobra tipo de trabalho legível depois da limpeza. */
const TIPO_DE_ULTIMO_CASO = "Quote";

/** `[Housekeep]`, `(Checkatrade)`: carimbo de origem no assunto do e-mail. */
const SEGMENTO_ENTRE_SINAIS = /[[(]([^\])]*)[\])]/g;

function citaAlgumNome(texto: string, nomes: string[]): boolean {
  const t = texto.toLowerCase();
  return nomes.some((nome) => {
    const n = nome.trim();
    if (n.length < 3) return false;
    return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
  });
}

/**
 * Tira o nome do título sem matar o título.
 *
 * Aqui a linha NÃO some inteira, ao contrário do scope: o título é uma linha
 * só, e apagá-la deixa o parceiro sem saber o que está orçando. Some o
 * carimbo entre colchetes, some a palavra solta, e o trabalho fica.
 */
function limparTipoDeTrabalho(bruto: string, nomes: string[]): string {
  if (!bruto.trim()) return TIPO_DE_ULTIMO_CASO;
  if (!citaAlgumNome(bruto, nomes)) return bruto.trim();

  let t = bruto.replace(SEGMENTO_ENTRE_SINAIS, (inteiro, dentro: string) =>
    citaAlgumNome(dentro, nomes) ? " " : inteiro,
  );

  for (const nome of nomes) {
    const n = nome.trim();
    if (n.length < 3) continue;
    t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }

  // Sobras de pontuação de onde o nome saiu: " - Wall", "· Wall", "  Wall".
  t = t
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:·,|/]+/, "")
    .replace(/[\s\-–—:·,|/]+$/, "")
    .trim();

  return t || TIPO_DE_ULTIMO_CASO;
}

export type EntradaDaQuote = {
  service_type?: string | null;
  title?: string | null;
  scope?: string | null;
};

export type QuoteParaParceiro = {
  /** Sempre `CLIENTE_PARA_PARCEIRO`. Não há entrada que mude isto. */
  clientName: string;
  typeOfWork: string;
  scope: string;
};

/**
 * A visão da quote que pode sair para um parceiro.
 *
 * `scope` entra como opção porque cada porta resolve o dela: o convite usa o
 * scope da quote OU a descrição do request, e a página de bid usa o mesmo
 * encadeamento. Quem resolve passa o resultado; a limpeza é uma só.
 */
export function quoteParaParceiro(
  quote: EntradaDaQuote,
  opcoes?: { scope?: string | null; nomesProibidos?: string[] },
): QuoteParaParceiro {
  const nomes = (opcoes?.nomesProibidos ?? []).filter((n) => n && n.trim().length >= 3);
  const scopeBruto = opcoes?.scope !== undefined ? opcoes.scope : quote.scope;

  return {
    clientName: CLIENTE_PARA_PARCEIRO,
    typeOfWork: limparTipoDeTrabalho(resolveQuoteTypeOfWorkLabel(quote), nomes),
    scope: limparScope(scopeBruto, { nomesProibidos: nomes }) ?? "",
  };
}

/**
 * Os nomes que não podem sair, lidos das contas.
 *
 * Vem do banco e não de uma constante para a conta que entrar amanhã já
 * nascer protegida. A lista fixa de plataformas dentro do `limparScope`
 * continua valendo por baixo: esta soma, não substitui.
 */
export async function nomesDeContas(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("accounts").select("company_name").is("deleted_at", null);
  if (error) {
    console.error("[quote-para-parceiro] nao consegui ler as contas:", error.message);
    return [];
  }
  return (data ?? [])
    .map((a) => (a as { company_name?: string | null }).company_name?.trim() ?? "")
    .filter((n) => n.length >= 3);
}
