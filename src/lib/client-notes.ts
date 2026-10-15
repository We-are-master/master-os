/**
 * Notas do cliente lidas para a ficha (15/10/2026).
 *
 * O Ruben (Checkatrade) grava cada pedido como linhas soltas:
 *   checkatrade-lead:<uuid> / checkatrade-account:<conta> / Enquiry · <serviço> / <pedido> / <disponibilidade>
 * A ficha mostrava tudo num parágrafo só, com as etiquetas técnicas no meio do texto.
 * Aqui cada pedido vira um bloco: origem, título, texto e disponibilidade. Nota escrita
 * à mão (sem etiqueta) segue como texto, com as quebras de linha.
 */

export type ClientNoteBlock = {
  /** "Checkatrade · main" quando a nota veio de um lead. */
  source: string | null;
  /** Id curto do lead, para quem precisa achar no Checkatrade. */
  leadId: string | null;
  /** "Enquiry · General Maintenance". */
  title: string | null;
  paragraphs: string[];
  /** "The customer is flexible on the start date." */
  availability: string | null;
};

const TAG = /^([a-z][a-z0-9-]*):\s*(\S+)$/i;
const AVAILABILITY = /^the customer (is|would|wants|needs)\b.*\b(start|date|asap|soon|weeks?|days?|flexible)\b/i;

function novoBloco(): ClientNoteBlock {
  return { source: null, leadId: null, title: null, paragraphs: [], availability: null };
}

function vazio(b: ClientNoteBlock): boolean {
  return !b.source && !b.leadId && !b.title && b.paragraphs.length === 0 && !b.availability;
}

export function parseClientNotes(notes: string | null | undefined): ClientNoteBlock[] {
  const linhas = String(notes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const blocos: ClientNoteBlock[] = [];
  let atual = novoBloco();

  for (const linha of linhas) {
    const tag = TAG.exec(linha);
    if (tag) {
      const chave = tag[1]!.toLowerCase();
      const valor = tag[2]!;
      if (chave === "checkatrade-lead") {
        // Lead novo: fecha o bloco anterior.
        if (!vazio(atual)) blocos.push(atual);
        atual = novoBloco();
        atual.leadId = valor.slice(0, 8);
        atual.source = atual.source ?? "Checkatrade";
        continue;
      }
      if (chave === "checkatrade-account") {
        atual.source = `Checkatrade · ${valor.toLowerCase()}`;
        continue;
      }
      // Outra etiqueta técnica (chave:valor sem espaço): não é texto para gente ler.
      continue;
    }
    if (!atual.title && /^enquiry\s*·/i.test(linha)) {
      atual.title = linha;
      continue;
    }
    if (AVAILABILITY.test(linha)) {
      atual.availability = linha;
      continue;
    }
    atual.paragraphs.push(linha);
  }
  if (!vazio(atual)) blocos.push(atual);
  return blocos;
}
