/**
 * O melhor lance de uma quote, e o preço que sai dele.
 *
 * O lance chegava e morria no banco. O `submit-bid` grava e retorna: não manda
 * e-mail, não escreve no Zendesk, não avisa ninguém. Quem quisesse saber tinha
 * que abrir a tela de Quotes e reparar num ponto verde. A QT-2026-1139 recebeu
 * £380 do G&M Services às 21:43 de 07/09/2026 e ficou dois dias parada ali.
 *
 * Esta parte é pura de propósito: escolher não depende de banco, e é a decisão
 * que vira dinheiro. Quem varre é outro arquivo.
 */
import { sellFromMargin } from "@/lib/catalog-pricing-floor-ceiling";

/** A margem padrão do OS sobre lance de parceiro (dono, 09/09/2026). */
export const MARGEM_PADRAO = 40;

export type Lance = {
  id: string;
  partner_id: string | null;
  partner_name: string | null;
  bid_amount: number | string | null;
  status: string | null;
  created_at: string;
};

export type LanceValido = Lance & { valor: number };

export type Escolha = {
  melhor: LanceValido;
  /** Todos os válidos, do menor para o maior. A nota mostra o leque inteiro. */
  ordenados: LanceValido[];
  descartados: Array<{ lance: Lance; motivo: "nao_submetido" | "valor_invalido" }>;
  /** Preço ao cliente com a margem aplicada. */
  precoAoCliente: number;
  margem: number;
};

function comoNumero(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * O menor lance válido ganha.
 *
 * Menor, e não uma média: a média sobe o preço ao cliente sem nos dar nada, e
 * um lance perdido no meio a envenena. A QT-2026-1122 tem £220 e £4.999,97 no
 * mesmo trabalho; a média seria £2.610 e o menor é o único número honesto ali.
 *
 * Empate vai para quem respondeu primeiro. Ele já provou que estava atento.
 *
 * O que esta função NÃO faz: julgar se o menor é barato demais. Não há piso
 * confiável para isso, e inventar um esconderia o problema. O leque inteiro vai
 * na nota, e quem clica enviar vê os dois extremos antes de clicar.
 */
export function escolherMelhorLance(
  lances: Lance[],
  opcoes?: { margem?: number },
): Escolha | null {
  const margem = opcoes?.margem ?? MARGEM_PADRAO;
  const descartados: Escolha["descartados"] = [];
  const validos: LanceValido[] = [];

  for (const l of lances) {
    if ((l.status ?? "").toLowerCase() !== "submitted") {
      descartados.push({ lance: l, motivo: "nao_submetido" });
      continue;
    }
    const valor = comoNumero(l.bid_amount);
    if (valor === null) {
      descartados.push({ lance: l, motivo: "valor_invalido" });
      continue;
    }
    validos.push({ ...l, valor });
  }

  if (validos.length === 0) return null;

  validos.sort((a, b) => (a.valor !== b.valor ? a.valor - b.valor : a.created_at.localeCompare(b.created_at)));
  const melhor = validos[0]!;
  const preco = sellFromMargin(melhor.valor, margem);
  if (preco === null) return null;

  return { melhor, ordenados: validos, descartados, precoAoCliente: preco, margem };
}
