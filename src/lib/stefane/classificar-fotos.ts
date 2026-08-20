/**
 * STEFANE. Separa por cômodo um lote de fotos que chegou sem etiqueta.
 *
 * Existe por causa do JOB-9450. O parceiro preencheu o relatório no template
 * chapado, então as 40 fotos vieram como duas listas planas. O formulário de
 * limpeza da Housekeep tem treze campos, um por cômodo, cada um com o seu
 * mínimo, e uma lista plana não tem como entrar ali: não dá para saber qual
 * foto é a cozinha.
 *
 * Isto NÃO é a solução do problema, é o resgate de um lote específico. A
 * solução é o parceiro fotografar por cômodo desde o começo, que é o que a
 * conferência contra `slotsDeFoto` passa a exigir. Aqui só se recupera o que
 * já foi tirado, e o que sobra é a lista exata do que ainda falta pedir.
 *
 * Nunca escreve sozinho: quem chama decide se aplica, e o script que aplica
 * grava o envelope original em `.logs/` antes de trocar qualquer coisa. Foto de
 * parceiro é prova de serviço prestado, e prova não se sobrescreve sem cópia.
 */

import { HOUSEKEEP_COMODOS } from "./housekeep-report-form";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** `gpt-4o-mini` chega e sobra: a pergunta é "que cômodo é este", não leitura fina. */
const MODEL = () => process.env.OPENAI_FOTOS_MODEL?.trim() || "gpt-4o-mini";

/** As chaves válidas são as mesmas do formulário, mais `unknown`. */
export const COMODOS_VALIDOS = Object.keys(HOUSEKEEP_COMODOS);

const SYSTEM = `You label photos taken by a cleaner on a UK domestic cleaning job, so each photo can be filed under the right room on the client's report form.

Reply with JSON only: {"labels": {"0": "kitchen", "1": "bathrooms", ...}} with one entry for every photo index you were given.

Allowed labels, and nothing else:
- "kitchen": oven, hob, fridge, freezer, sink, worktops, kitchen floor, kitchen cupboards
- "bathrooms": toilet, shower, bath, basin, bathroom mirror, tiles, bathroom floor
- "bedrooms": bed, wardrobe, chest of drawers, bedroom window or skirting
- "living_room": sofa, armchairs, TV, dining table, lounge window or skirting
- "hallways": corridor, entrance hall, staircase, landing, internal doors
- "equipment": the cleaner's own kit. Vacuum, mop, bucket, sprays, cloths, caddy
- "steam_cleaning": a steam cleaner in use, or a surface visibly being steamed
- "unknown": you genuinely cannot tell which room it is

Rules:
- One label per photo. Never invent a label outside the list.
- A close-up of a single surface still belongs to the room that surface is in. A close-up of an oven door is "kitchen", not "unknown".
- Empty rooms with no distinguishing feature, exteriors, and photos of paperwork are "unknown".
- Prefer "unknown" over a guess. A photo filed in the wrong room is worse than a photo the office has to look at.`;

export type FotoClassificada = { url: string; comodo: string };

type Resposta = { labels?: Record<string, string> };

/**
 * Classifica um lote de fotos numa chamada só.
 *
 * Num lote só, e não uma por uma, porque o modelo vê o conjunto: quatro fotos
 * do mesmo banheiro em ângulos diferentes se sustentam, e uma foto ambígua
 * ganha contexto das vizinhas. `detail: low` porque identificar cômodo não
 * precisa de resolução, e é o que mantém 20 fotos numa requisição.
 *
 * As URLs precisam ser ASSINADAS: o bucket é privado e a OpenAI busca a
 * imagem pela rede, igual a qualquer outro cliente.
 */
export async function classificarFotos(
  urlsAssinadas: string[],
  opcoes?: {
    /**
     * `high` manda a imagem inteira em vez da miniatura de 512px.
     *
     * Custa mais e serve para o SEGUNDO passe: a primeira rodada em `low`
     * resolve a maioria barato, e quem sobra como "unknown" quase sempre é
     * close-up de superfície — uma torneira, um rodapé — onde a pista está no
     * detalhe que a miniatura apagou.
     */
    detalhe?: "low" | "high";
    modelo?: string;
    /** Contexto extra para o pedido. Usado para dizer que é uma segunda tentativa. */
    nota?: string;
  },
): Promise<{ ok: true; fotos: FotoClassificada[] } | { ok: false; motivo: string }> {
  if (urlsAssinadas.length === 0) return { ok: true, fotos: [] };

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, motivo: "OPENAI_API_KEY is not set" };

  const content = [
    ...urlsAssinadas.map((url) => ({ type: "input_image", image_url: url, detail: opcoes?.detalhe ?? "low" })),
    {
      type: "input_text",
      text:
        `Label these ${urlsAssinadas.length} photos. They are numbered 0 to ${urlsAssinadas.length - 1} ` +
        `in the order given. Return one label for every index.` +
        (opcoes?.nota ? `\n\n${opcoes.nota}` : ""),
    },
  ];

  /**
   * 429 é atraso, não erro: um lote de 70 fotos estoura o teto de tokens por
   * minuto da conta e a própria resposta diz quantos segundos esperar. Sem
   * isto, um lote grande morria no meio e levava junto os lotes já
   * classificados — que é como o JOB-9449 falhou na foto 60 de 72.
   */
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let res!: Response;
  type RespostaOpenAI = {
    error?: { message?: string };
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  let json: RespostaOpenAI | null = null;
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      res = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opcoes?.modelo ?? MODEL(),
          temperature: 0,
          max_output_tokens: 1200,
          instructions: SYSTEM,
          input: [{ role: "user", content }],
        }),
      });
    } catch (err) {
      return { ok: false, motivo: `OpenAI unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
    json = (await res.json().catch(() => null)) as RespostaOpenAI | null;
    if (res.status !== 429) break;
    // A mensagem deles traz "try again in 2.508s"; obedecer o número dito é
    // melhor que chutar, e o dobro do sugerido dá folga para o lote seguinte.
    const dito = /try again in ([\d.]+)s/.exec(json?.error?.message ?? "")?.[1];
    const ms = dito ? Math.ceil(Number(dito) * 1000) * 2 : (tentativa + 1) * 5000;
    await espera(Math.min(ms, 30000));
  }
  if (!res.ok) return { ok: false, motivo: json?.error?.message || `OpenAI HTTP ${res.status}` };

  const texto = (json?.output ?? [])
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  let parsed: Resposta;
  try {
    // O modelo às vezes embrulha em cerca de markdown, mesmo mandando JSON only.
    parsed = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Resposta;
  } catch {
    return { ok: false, motivo: `OpenAI did not answer with JSON: ${texto.slice(0, 120)}` };
  }

  const labels = parsed.labels ?? {};
  return {
    ok: true,
    fotos: urlsAssinadas.map((url, i) => {
      const bruto = String(labels[String(i)] ?? "unknown").trim();
      // Rótulo fora da lista vira `unknown` em vez de virar um cômodo inventado:
      // foto arquivada no cômodo errado é pior que foto que o escritório revisa.
      return { url, comodo: COMODOS_VALIDOS.includes(bruto) ? bruto : "unknown" };
    }),
  };
}

/**
 * Volta da lista classificada para o mapa por cômodo do nosso envelope.
 *
 * A duvidosa fica no mapa, sob `unknown`, e não é descartada. São duas coisas
 * diferentes: `unknown` não tem campo do lado da Housekeep e nunca vai ser
 * enviada para lugar nenhum, mas continua sendo foto que um parceiro tirou num
 * imóvel. Sumir com ela para "fechar a conta" perderia prova de serviço, e o
 * card do OS mostra o grupo `unknown` como qualquer outro, que é onde alguém
 * do escritório olha e resolve em dez segundos.
 *
 * O que NÃO se faz é enfiar a duvidosa num cômodo qualquer para bater o
 * mínimo: relatório com foto de banheiro no campo do quarto é o tipo de coisa
 * que o cliente desmente.
 *
 * `original` é a lista de URLs como estão gravadas no envelope, na mesma ordem
 * das assinadas: o mapa tem que guardar a URL guardável, não a assinada, que
 * vence em dez minutos.
 */
export function mapaPorComodo(
  fotos: FotoClassificada[],
  original: string[],
): { mapa: Record<string, string[]>; duvidosas: number } {
  const mapa: Record<string, string[]> = {};
  let duvidosas = 0;
  fotos.forEach((f, i) => {
    const url = original[i] ?? f.url;
    if (f.comodo === "unknown") duvidosas += 1;
    (mapa[f.comodo] ??= []).push(url);
  });
  return { mapa, duvidosas };
}
