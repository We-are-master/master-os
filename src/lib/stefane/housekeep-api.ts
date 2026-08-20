/**
 * STEFANE. O formulário da Housekeep lido da fonte, sem browser.
 *
 * A página de job report é um Angular que chama
 * `GET /api/v1/work/job-reports/<uuid>/`, e essa resposta é o formulário
 * inteiro: id e tipo de cada pergunta, os limites (mínimo e máximo de fotos por
 * campo), a regra condicional que revela cada campo, as respostas já salvas e,
 * o mais importante, `submitted_at`.
 *
 * Existe por três motivos, todos aprendidos no JOB-9450 em 20/08/2026:
 *
 * 1. `submitted_at` é a ÚNICA prova de que o relatório entrou. Até aqui a
 *    Stefane concluía "enviado" por ausência de campo na tela, e a tela leva
 *    uns 10 segundos para renderizar quando renderiza. Ou seja: o relatório
 *    que demorava a aparecer era carimbado como entregue e saía da fila para
 *    sempre.
 *
 * 2. Os mínimos são POR CAMPO e a gente não sabia. O formulário de limpeza
 *    pede 5 fotos de sala, 3 de corredor, 5 de cozinha, 5 de banheiro, 5 de
 *    quarto e 1 a 2 de equipamento. O nosso piso era um número só, e era
 *    aviso. Um relatório com 20 fotos soltas não passa nesse formulário, e
 *    descobrir isso depois do Submit custa o dia do parceiro.
 *
 * 3. Quem manda no formato é a PÁGINA, não o template que alguém digitou.
 *    O JOB-9450 tinha relatório `general` num job de limpeza, e o transporte
 *    preencheu o formulário de limpeza com o payload de trade.
 */

import { formaDoFormulario, HOUSEKEEP_COMODOS } from "./housekeep-report-form";

const BASE = "https://housekeep.com/api/v1/work/job-reports";
const TIMEOUT_MS = 20_000;

export type PerguntaHousekeep = {
  id: string;
  secao: string;
  texto: string;
  /** `time`, `boolean`, `string`, `document`, `calculated_value`. */
  tipo: string;
  resposta: unknown;
  /** `min_length`/`max_length` em texto, `min_num_documents`/`max` em foto. */
  min: number | null;
  max: number | null;
  /** A condição que revela este campo, quando existe. */
  mostrarSe: { pergunta: string; operador: string; valor: string } | null;
};

export type FormularioHousekeep = {
  /** A URL canônica, com o link de rastreio já resolvido. */
  url: string;
  uuid: string;
  status: string;
  submetidoEm: string | null;
  perguntas: PerguntaHousekeep[];
};

export type BuscaFormulario =
  | { ok: true; form: FormularioHousekeep }
  /** `sumiu` = a Housekeep respondeu 404: o relatório não existe mais lá. */
  | { ok: false; motivo: string; sumiu: boolean };

/**
 * Resolve o link guardado no job até a URL de verdade.
 *
 * Seis jobs da base guardam `links.housekeep.com/ls/click?upn=...`, que é o
 * rastreador de email deles. Esse endereço não casa com nenhuma regex de
 * `job-reports`, então esses jobs eram reportados como "plataforma ainda não
 * automatizada" e ninguém nunca enviou nada. Um GET seguindo redirect resolve.
 */
export async function resolverLinkHousekeep(link: string): Promise<string> {
  const url = String(link ?? "").trim();
  if (/housekeep\.com\/job-reports\//i.test(url)) return url.split("?")[0];
  if (!/links\.housekeep\.com/i.test(url)) return url;
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.url.split("?")[0];
  } catch {
    return url;
  }
}

/** O identificador do relatório dentro da URL, ou null se não for uma. */
export function uuidDoLink(url: string): string | null {
  const m = /housekeep\.com\/job-reports\/([0-9a-f]{8,})/i.exec(String(url ?? ""));
  return m ? m[1] : null;
}

/** True para qualquer link de relatório da Housekeep, resolvido ou não. */
export function ehLinkHousekeep(link: string | null | undefined): boolean {
  const s = String(link ?? "");
  return /housekeep\.com\/job-reports/i.test(s) || /links\.housekeep\.com/i.test(s);
}

function normalizarPergunta(q: Record<string, unknown>, secao: string): PerguntaHousekeep {
  const c = (q.constraints ?? {}) as Record<string, number | undefined>;
  const min = c.min_num_documents ?? c.min_length ?? null;
  const max = c.max_num_documents ?? c.max_length ?? null;
  const alvo = q.display_if_question_id as string | null;
  return {
    id: String(q.id ?? ""),
    secao,
    texto: String(q.text ?? ""),
    tipo: String(q.data_type ?? ""),
    resposta: q.answer ?? null,
    min: typeof min === "number" ? min : null,
    max: typeof max === "number" ? max : null,
    mostrarSe: alvo
      ? {
          pergunta: alvo,
          operador: String(q.display_if_operator ?? "=="),
          valor: String(q.display_if_value ?? ""),
        }
      : null,
  };
}

/**
 * Busca o formulário. Uma retentativa, porque a resposta deles às vezes demora.
 *
 * 404 não é erro de rede: é relatório que a Housekeep não serve mais (fechado,
 * arquivado, ou link vencido). Quem chama precisa distinguir os dois, porque um
 * pede retry e o outro pede uma pessoa.
 */
export async function buscarFormulario(link: string): Promise<BuscaFormulario> {
  const url = await resolverLinkHousekeep(link);
  const uuid = uuidDoLink(url);
  if (!uuid) {
    return { ok: false, motivo: `not a Housekeep report link: ${url.slice(0, 80)}`, sumiu: false };
  }

  let ultimo = "";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(`${BASE}/${uuid}/`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.status === 404) {
        return {
          ok: false,
          motivo: "the report no longer exists on the client platform (their link returns 404)",
          sumiu: true,
        };
      }
      if (!r.ok) {
        ultimo = `the client platform answered ${r.status}`;
        continue;
      }
      const corpo = (await r.json()) as Record<string, unknown>;
      const secoes = Array.isArray(corpo.form) ? (corpo.form as Record<string, unknown>[]) : [];
      const perguntas = secoes.flatMap((s) => {
        const titulo = String(s.title ?? "");
        const qs = Array.isArray(s.questions) ? (s.questions as Record<string, unknown>[]) : [];
        return qs.map((q) => normalizarPergunta(q, titulo));
      });
      return {
        ok: true,
        form: {
          url,
          uuid,
          status: String(corpo.status ?? ""),
          submetidoEm: (corpo.submitted_at as string | null) ?? null,
          perguntas,
        },
      };
    } catch (err) {
      ultimo = err instanceof Error ? err.message : "unknown error";
    }
  }
  return { ok: false, motivo: `could not read the client platform form: ${ultimo}`, sumiu: false };
}

/**
 * Qual dos dois formulários é, decidido pelos ids que a própria API lista.
 *
 * Reusa `formaDoFormulario` de propósito: o detector do browser e o da API
 * precisam concordar, e duas listas de id em dois arquivos é exatamente o
 * defeito que fez End of Tenancy cair no template errado.
 */
export function formaDoFormularioAPI(form: FormularioHousekeep): "trade" | "limpeza" | null {
  return formaDoFormulario(form.perguntas.map((q) => q.id));
}

/**
 * Se a pergunta está à vista com as respostas de agora.
 *
 * Campo escondido não é exigido, e exigir foto de dano num job sem dano
 * recusaria todo relatório por um motivo que não existe.
 */
export function perguntaVisivel(form: FormularioHousekeep, q: PerguntaHousekeep): boolean {
  if (!q.mostrarSe) return true;
  const alvo = form.perguntas.find((p) => p.id === q.mostrarSe!.pergunta);
  if (!alvo) return false;
  const atual = String(alvo.resposta ?? "");
  return q.mostrarSe.operador === "==" ? atual === q.mostrarSe.valor : atual !== q.mostrarSe.valor;
}

export type SlotDeFoto = {
  id: string;
  /** "antes" ou "depois": qual metade do relatório alimenta este campo. */
  metade: "antes" | "depois";
  rotulo: string;
  /**
   * A chave do nosso lado (`kitchen`, `bedrooms`...), ou `all` quando o
   * formulário tem um balde só por metade, que é o caso do de trade.
   */
  chave: string;
  min: number;
  max: number;
  /** Quantas fotos a Housekeep já tem neste campo. */
  temLa: number;
};

/** "antes" ou "depois", pela seção e pelo rótulo, como a página deles escreve. */
function metadeDoSlot(q: PerguntaHousekeep): "antes" | "depois" {
  const s = `${q.secao} ${q.texto}`.toLowerCase();
  return /after|finish/.test(s) ? "depois" : "antes";
}

/** A chave do nosso lado para o rótulo do campo deles, ou `all`. */
function chaveDoSlot(q: PerguntaHousekeep): string {
  const texto = q.texto.toLowerCase();
  for (const [chave, rotulo] of Object.entries(HOUSEKEEP_COMODOS)) {
    if (texto.startsWith(rotulo.toLowerCase())) return chave;
  }
  return "all";
}

/**
 * Os campos de foto que este relatório exige AGORA, com os limites deles.
 *
 * Só os visíveis. Se o parceiro marcou que o cliente recusou fotos, os treze
 * campos somem do formulário e a exigência some junto.
 */
export function slotsDeFoto(form: FormularioHousekeep): SlotDeFoto[] {
  return form.perguntas
    .filter((q) => q.tipo === "document" && perguntaVisivel(form, q))
    .map((q) => ({
      id: q.id,
      metade: metadeDoSlot(q),
      rotulo: q.texto.replace(/\s*\(include:.*$/i, "").trim(),
      chave: chaveDoSlot(q),
      min: q.min ?? 0,
      max: q.max ?? 20,
      temLa: Array.isArray(q.resposta) ? q.resposta.length : 0,
    }));
}

/**
 * O que falta de foto para este relatório passar na validação DELES.
 *
 * Devolve frases prontas para a tela, em inglês, porque é o que aparece no
 * card e no email. Conta o que a Housekeep já tem somado ao que temos para
 * subir: reenvio de um relatório meio subido não deve pedir de novo o que já
 * está lá.
 */
export function faltasDeFoto(
  form: FormularioHousekeep,
  temos: { antes: Record<string, number>; depois: Record<string, number> },
): string[] {
  const faltas: string[] = [];
  for (const slot of slotsDeFoto(form)) {
    if (slot.min <= 0) continue;
    const nossas = temos[slot.metade]?.[slot.chave] ?? 0;
    const total = slot.temLa + nossas;
    if (total < slot.min) {
      const metade = slot.metade === "antes" ? "before" : "after";
      faltas.push(`${metade} · ${slot.rotulo}: ${total} of ${slot.min} photos`);
    }
  }
  return faltas;
}

/**
 * Confirma na fonte se o relatório entrou. É o único veredito de sucesso.
 *
 * Devolve `null` quando não deu para saber, que é diferente de "não entrou":
 * quem chama não pode tratar dúvida como sucesso, e também não deveria contar
 * uma tentativa por causa de rede ruim.
 */
export async function confirmarSubmissao(link: string): Promise<string | null> {
  const r = await buscarFormulario(link);
  return r.ok ? r.form.submetidoEm : null;
}
