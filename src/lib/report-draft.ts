/**
 * Rascunho do relatório digitado, guardado no próprio navegador.
 *
 * Um relatório de limpeza tem quatro perguntas de chegada, sete blocos de foto
 * e a conclusão inteira: são vários minutos de digitação que existiam só na
 * memória da aba. Em 14/08/2026 a aba travou no meio de um e o trabalho se
 * perdeu inteiro, sem nada em lugar nenhum para recuperar.
 *
 * `localStorage` e não o servidor: o que precisa sobreviver é justamente o caso
 * em que a aba morre, e um POST a cada tecla não sobreviveria a isso nem seria
 * barato. O texto de um relatório cabe folgado na cota do domínio.
 *
 * As fotos ficam de fora, e não por esquecimento: são `File` de câmera, vários
 * MB cada, e estourariam a cota na primeira. Quem chama avisa isso na tela em
 * vez de deixar quem lê supor que voltaram.
 *
 * Toda função aqui engole o próprio erro. Modo privado, cota cheia e JSON
 * corrompido são todos possíveis, e nenhum deles pode derrubar o formulário:
 * ficar sem rascunho é ruim, não abrir o modal é pior.
 */

const PREFIXO = "fixfy:report-draft:";

/** Uma semana. Depois disso o job quase certamente já foi resolvido de outro jeito. */
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

export type RascunhoRelatorio = {
  template: string;
  data: Record<string, unknown>;
  visitYmd: string;
  startTime: string;
  finishTime: string;
  salvoEm: number;
};

export type CorpoDoRascunho = Omit<RascunhoRelatorio, "salvoEm" | "template">;

export function chaveDoRascunho(jobId: string): string {
  return PREFIXO + jobId;
}

/** Só vale a pena guardar o que tem alguma coisa digitada. */
export function temConteudo(corpo: CorpoDoRascunho): boolean {
  return Object.keys(corpo.data ?? {}).length > 0 || !!corpo.startTime || !!corpo.finishTime;
}

export function salvarRascunho(
  jobId: string,
  template: string,
  corpo: CorpoDoRascunho,
  agora: number = Date.now(),
): void {
  if (!temConteudo(corpo)) return;
  try {
    const r: RascunhoRelatorio = { ...corpo, template, salvoEm: agora };
    localStorage.setItem(chaveDoRascunho(jobId), JSON.stringify(r));
  } catch {
    /* cota cheia ou modo privado */
  }
}

export function lerRascunho(
  jobId: string,
  template: string,
  agora: number = Date.now(),
): RascunhoRelatorio | null {
  try {
    const cru = localStorage.getItem(chaveDoRascunho(jobId));
    if (!cru) return null;
    const r = JSON.parse(cru) as RascunhoRelatorio;
    if (!r || typeof r !== "object") return null;
    if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) return null;
    // Template diferente quer dizer que o job mudou de forma desde o rascunho e
    // os campos antigos não têm mais onde entrar. Ignorar inteiro é melhor do
    // que aplicar metade e deixar o resto parecendo resposta.
    if (r.template !== template) return null;
    if (typeof r.salvoEm !== "number" || agora - r.salvoEm > VALIDADE_MS) return null;
    return r;
  } catch {
    return null;
  }
}

export function apagarRascunho(jobId: string): void {
  try {
    localStorage.removeItem(chaveDoRascunho(jobId));
  } catch {
    /* idem */
  }
}
