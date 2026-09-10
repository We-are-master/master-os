/**
 * Uma chamada à OpenAI que não desiste no primeiro tropeço.
 *
 * Nenhum dos seis pontos do Harvey re-tentava. Ele logava e abandonava o
 * ticket, e o ciclo fechava com `0, 0, 0` — que na tela é indistinguível de um
 * dia calmo. É a falha que já custou 2 jobs da Housekeep em 09/09/2026, e num
 * servidor sem ninguém olhando o log ela é a falha que importa.
 *
 * Só re-tenta o que faz sentido re-tentar:
 *
 *   429 rate_limit   pico de requisições ou tokens. Espera e vai.
 *   500 502 503 504  problema do outro lado. Espera e vai.
 *   429 insufficient_quota   SEM SALDO. Não é pico: re-tentar só queima tempo
 *                            e esconde o motivo. Falha na hora, com o motivo
 *                            no texto do erro, para o log dizer a verdade.
 *
 * Espera com jitter porque um ciclo do Harvey dispara várias chamadas juntas:
 * sem jitter, todas voltam no mesmo instante e reconstroem o pico que causou
 * o 429.
 */

const TENTATIVAS = 3;
const BASE_MS = 800;

export class SemSaldoOpenAI extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SemSaldoOpenAI";
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** `Retry-After` em segundos, quando o servidor diz quanto esperar. */
function esperaPedida(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const s = Number(h);
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 20_000) : null;
}

/**
 * `insufficient_quota` vem com 429, o mesmo código do pico de tráfego.
 * Distinguir os dois é o ponto: um espera, o outro precisa de cartão.
 */
function semSaldo(corpo: string): boolean {
  return /insufficient_quota|no credits remaining|exceeded your current quota/i.test(corpo);
}

export async function chamarOpenAI(
  url: string,
  init: RequestInit,
  opcoes?: { tentativas?: number; rotulo?: string },
): Promise<Response> {
  const max = Math.max(1, opcoes?.tentativas ?? TENTATIVAS);
  const rotulo = opcoes?.rotulo ?? "openai";
  let ultimoErro: unknown = null;

  for (let tentativa = 1; tentativa <= max; tentativa++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Rede caiu no meio. Vale tentar de novo; a última vez propaga.
      ultimoErro = err;
      if (tentativa === max) break;
      await esperar(BASE_MS * 2 ** (tentativa - 1) + Math.random() * 400);
      continue;
    }

    if (res.ok) return res;

    const status = res.status;
    const daPraTentar = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
    if (!daPraTentar) return res;

    // O corpo só é lido quando há motivo: um clone, para quem chama ainda poder ler.
    const corpo = await res.clone().text().catch(() => "");
    if (status === 429 && semSaldo(corpo)) {
      throw new SemSaldoOpenAI(
        `${rotulo}: sem saldo na OpenAI (insufficient_quota). Não é pico de tráfego — recarregue e confira o teto DO PROJETO da chave.`,
      );
    }
    if (tentativa === max) return res;

    const espera = esperaPedida(res) ?? BASE_MS * 2 ** (tentativa - 1) + Math.random() * 400;
    console.warn(`[${rotulo}] HTTP ${status}, tentativa ${tentativa}/${max}, esperando ${Math.round(espera)}ms`);
    await esperar(espera);
  }

  throw ultimoErro instanceof Error ? ultimoErro : new Error(`${rotulo}: falhou depois de ${max} tentativas`);
}
