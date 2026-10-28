/**
 * O scope formal da fatura (dono, 28/10/2026: as contas reclamavam que a fatura
 * não dizia o trabalho feito). A fatura mostra o bloco WORK do job, uma tarefa
 * por linha, como o parceiro recebeu.
 *
 * Só o WORK: PROPERTY, ACCESS e NOTES são para quem vai ao imóvel (chave,
 * telefone, "In the customer's words"), não para o financeiro de quem paga.
 * Job antigo, de antes do padrão (scope-padrao.ts), entra linha a linha, sem
 * as linhas de acesso e contato.
 *
 * Puro: o loadInvoicePdfData chama com o scope do job.
 */
import { limparScope } from "@/lib/scope-limpo";

const MAX_TAREFAS = 12;
const MAX_CHARS = 220;

const BLOCO = /^(WORK|PROPERTY|ACCESS|MATERIALS|NOTES)$/;

/** Linha de quem vai ao imóvel, não de quem paga. */
const SO_PARA_O_IMOVEL =
  /customer'?s words|\b(access|entrance|parking|key ?safe|keys?|lockbox|code|door code|on-site contact|contact|phone|tel|mobile|call)\b\s*[:\-]|\b0\d{3}\s?\d{3}\s?\d{3,4}\b|\+44/i;

/** Referência interna ("(merged from JOB-9717)") não vai para quem paga. */
const REFERENCIA_INTERNA = /\s*\((?:merged|moved|copied) from [^)]*\)/gi;

const tarefa = (linha: string) => {
  const t = linha.replace(/^[-•*]\s*/, "").replace(REFERENCIA_INTERNA, "").replace(/\s+/g, " ").trim();
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS - 1).trimEnd()}…` : t;
};

/** As tarefas do job, para a seção "Scope of work" da fatura. Vazio = a fatura não mostra a seção. */
export function escopoDaFatura(scope: string | null | undefined): string[] {
  const limpo = limparScope(String(scope ?? "").replace(/\r\n/g, "\n"));
  if (!limpo) return [];
  const linhas = limpo.split("\n").map((l) => l.trim());

  let tarefas: string[];
  if (linhas.some((l) => BLOCO.test(l))) {
    const inicio = linhas.indexOf("WORK");
    if (inicio < 0) return [];
    const fim = linhas.findIndex((l, i) => i > inicio && BLOCO.test(l));
    tarefas = linhas.slice(inicio + 1, fim < 0 ? undefined : fim);
  } else {
    tarefas = linhas.filter((l) => !SO_PARA_O_IMOVEL.test(l));
  }

  return [...new Set(tarefas.map(tarefa).filter(Boolean))].slice(0, MAX_TAREFAS);
}
