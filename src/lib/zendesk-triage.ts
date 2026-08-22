/**
 * Triagem de ticket do Zendesk: o que é isto que chegou.
 *
 * O Harvey já sabia responder duas perguntas ("pede preço?", "é booking?") e
 * agia nas duas. Isto é a pergunta maior, a de antes: que espécie de ticket é
 * este. Classificar é livre; AGIR continua restrito ao que ele já fazia, e
 * `ACAO_POR_CLASSE` é onde essa fronteira está escrita.
 *
 * ─── Por que as regras de assunto vêm antes das tags do Zendesk ───
 *
 * O Zendesk classifica sozinho e escreve `intent__…` em cada ticket. É de
 * graça e cobre dois terços do volume, então a tentação é começar por ele.
 * Medido em 300 tickets de 14 dias (07-21/08/2026), não dá:
 *
 *   84 tickets marcados por ele como spam ou marketing
 *     51  eram OFERTA DE JOB de verdade  ("£122.90 job offer in W1W 6BT")
 *     30  eram código de verificação do Checkatrade
 *      3  eram ruído mesmo
 *
 * Confiar nessa tag para descartar teria jogado fora 51 ofertas de job, que é
 * o fluxo de leads inteiro. A confiança declarada por eles também não salva:
 * `intent_confidence__low` em 107 dos 300. Então a ordem é por PRECISÃO e não
 * por preço, e as duas primeiras camadas custam zero de qualquer jeito:
 *
 *   1. o formato dos e-mails que a operação recebe todo dia, que é fixo;
 *   2. a tag do Zendesk, só como pista, e só para classe que termina em nota;
 *   3. nada disso pegou: `indefinido`, e quem decide é o modelo, com contexto.
 *
 * Nenhuma classe daqui manda o Harvey descartar ticket. O pior que acontece é
 * ele não saber, e aí o fluxo antigo roda igual.
 */

export type ClasseDeTicket =
  /** Plataforma avisando que um job é nosso. Vira job no OS. */
  | "job_de_plataforma"
  /** Pedem preço para trabalho ainda não orçado. */
  | "pedido_de_quote"
  /** O parceiro que vai executar avisa que agendou. */
  | "confirmacao_de_parceiro"
  /** Plataforma cancelou um job que já era nosso. */
  | "cancelamento"
  /** Oferta aberta do Checkatrade, ainda não é nossa. Quem disputa é o RPA. */
  | "oferta_de_lead"
  /** Perguntam se atendemos a região, o serviço, ou se temos data. */
  | "disponibilidade"
  /** Comprovante, fatura, extrato, cobrança. */
  | "financeiro"
  /** Cliente insatisfeito. Nunca automático. */
  | "reclamacao"
  /** Ticket que o próprio OS abriu para um job nosso. */
  | "ticket_do_os"
  /** Lembrete diário da plataforma, sem nada a fazer. */
  | "lembrete_de_plataforma"
  /** Código de acesso de plataforma. */
  | "codigo_de_acesso"
  /** Ruído comercial de verdade. */
  | "ruido"
  /** Não deu para decidir sem ler o ticket inteiro. */
  | "indefinido";

/**
 * O que o Harvey pode fazer com cada classe.
 *
 *   "age"    o que ele já fazia antes desta triagem existir. Não muda nada.
 *   "nota"   classe nova: nota interna dizendo o que ele achou, e para aí.
 *            Fica assim até termos visto ele acertar o bastante (dono, 21/08).
 *   "passa"  não é para ele. Nem nota, nem ação.
 */
export type AcaoDaClasse = "age" | "nota" | "passa";

export const ACAO_POR_CLASSE: Readonly<Record<ClasseDeTicket, AcaoDaClasse>> = {
  job_de_plataforma: "age",
  pedido_de_quote: "age",
  confirmacao_de_parceiro: "age",
  cancelamento: "age",
  // O RPA (Ruben) é quem disputa oferta no board do Checkatrade. Se o Harvey
  // criasse job a partir do e-mail, os dois criariam o mesmo job.
  oferta_de_lead: "nota",
  disponibilidade: "nota",
  financeiro: "nota",
  reclamacao: "nota",
  ticket_do_os: "passa",
  lembrete_de_plataforma: "passa",
  codigo_de_acesso: "passa",
  ruido: "passa",
  indefinido: "age",
};

export const ROTULO_DA_CLASSE: Readonly<Record<ClasseDeTicket, string>> = {
  job_de_plataforma: "job da plataforma",
  pedido_de_quote: "pedido de quote",
  confirmacao_de_parceiro: "confirmação de parceiro",
  cancelamento: "cancelamento",
  oferta_de_lead: "oferta de lead",
  disponibilidade: "pergunta de disponibilidade",
  financeiro: "financeiro",
  reclamacao: "reclamação",
  ticket_do_os: "ticket do próprio OS",
  lembrete_de_plataforma: "lembrete de plataforma",
  codigo_de_acesso: "código de acesso",
  ruido: "ruído comercial",
  indefinido: "indefinido",
};

export interface Triagem {
  classe: ClasseDeTicket;
  /** Uma linha dizendo por que, para caber na nota interna sem explicação extra. */
  motivo: string;
  fonte: "assunto" | "tag_do_zendesk" | "nenhuma";
}

export interface TicketParaTriagem {
  subject?: string | null;
  description?: string | null;
  tags?: string[] | null;
}

/**
 * Camada 1: o formato dos e-mails que chegam todo dia.
 *
 * Cada linha aqui saiu de assunto real observado na fila, não de suposição. A
 * ordem importa: `JOB-####` é ticket nosso e tem que ganhar de tudo, senão um
 * "JOB-9484 · Cleaning · Michelle B" cai em job de plataforma.
 */
const REGRAS: ReadonlyArray<{ re: RegExp; classe: ClasseDeTicket; motivo: string }> = [
  { re: /^\s*JOB-\d+/i, classe: "ticket_do_os", motivo: "o assunto começa com a referência de um job nosso" },
  { re: /you have \d+ jobs? on /i, classe: "lembrete_de_plataforma", motivo: "lembrete diário da Housekeep dos jobs de amanhã" },
  { re: /verification code/i, classe: "codigo_de_acesso", motivo: "código de acesso de plataforma" },
  { re: /\bhas been cancelled\b/i, classe: "cancelamento", motivo: "a plataforma avisa que o job foi cancelado" },
  // Oferta ABERTA: ainda não é nossa, tem preço e postcode no assunto. Não
  // confundir com "Job Scheduled" e "booked in", que já são job nosso.
  { re: /£\s?[\d,.]+\s+job offer in\b/i, classe: "oferta_de_lead", motivo: "oferta aberta do Checkatrade, com preço e postcode no assunto" },
  { re: /new .* opportunity just [\d.]+ miles away/i, classe: "oferta_de_lead", motivo: "oferta aberta por proximidade" },
  { re: /^\s*job booked\b/i, classe: "job_de_plataforma", motivo: "a Housekeep confirma job agendado para nós" },
  { re: /^\s*job scheduled:/i, classe: "job_de_plataforma", motivo: "a plataforma agendou um job nosso" },
  { re: /you.{0,3}re booked in for/i, classe: "job_de_plataforma", motivo: "o Checkatrade confirma que o job é nosso" },
  // Reclamação vem com a palavra no assunto, e nas duas plataformas: visto na
  // fila viva como "[Housekeep] Complaint - E5 8QN" e "Complaint - UB1 2YQ".
  // Vem depois das regras de job para nunca roubar um "Job booked".
  { re: /\bcomplaints?\b/i, classe: "reclamacao", motivo: "o assunto diz que é uma reclamação" },
  { re: /quote request/i, classe: "pedido_de_quote", motivo: "o assunto pede orçamento" },
  { re: /your booking .{0,40}\bis confirmed\b/i, classe: "confirmacao_de_parceiro", motivo: "um parceiro confirma que agendou a visita" },
];

/**
 * Camada 2: a tag do Zendesk, como pista.
 *
 * Só entram intents cujo destino é NOTA. Nenhuma leva a descarte, justamente
 * porque a medição mostrou a tag deles errando feio no que mais importa.
 */
const POR_TAG: ReadonlyArray<{ marca: string; classe: ClasseDeTicket; motivo: string }> = [
  { marca: "intent__billing__", classe: "financeiro", motivo: "o Zendesk classificou como assunto financeiro" },
  { marca: "intent__misc__feedback__negative", classe: "reclamacao", motivo: "o Zendesk classificou como reclamação" },
  { marca: "intent__order__new__quote_request", classe: "pedido_de_quote", motivo: "o Zendesk classificou como pedido de orçamento" },
  { marca: "intent__service__appointment__new", classe: "disponibilidade", motivo: "o Zendesk classificou como pedido de novo agendamento" },
];

/** Perguntas de disponibilidade não têm formato fixo; estas frases aparecem nelas. */
const FRASES_DISPONIBILIDADE: readonly RegExp[] = [
  /\bdo you (cover|serve|work in|come out to)\b/i,
  /\bare you (available|free)\b/i,
  /\bany availability\b/i,
  /\bcan you (do|come|fit us in)\b.{0,40}\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week)\b/i,
  /\bdo you have (anyone|someone|availability)\b/i,
];

export function triarTicket(t: TicketParaTriagem): Triagem {
  const assunto = String(t.subject ?? "");
  for (const r of REGRAS) {
    if (r.re.test(assunto)) return { classe: r.classe, motivo: r.motivo, fonte: "assunto" };
  }

  // O corpo só é lido para disponibilidade: é a única classe sem formato de
  // assunto, e é a pergunta que o dono quer que ele passe a entender.
  const corpo = String(t.description ?? "").slice(0, 2000);
  for (const re of FRASES_DISPONIBILIDADE) {
    if (re.test(corpo) || re.test(assunto)) {
      return { classe: "disponibilidade", motivo: "o texto pergunta se atendemos ou se temos data", fonte: "assunto" };
    }
  }

  const tags = t.tags ?? [];
  for (const p of POR_TAG) {
    if (tags.some((g) => g.startsWith(p.marca))) {
      return { classe: p.classe, motivo: p.motivo, fonte: "tag_do_zendesk" };
    }
  }

  return { classe: "indefinido", motivo: "nenhum formato conhecido casou", fonte: "nenhuma" };
}

/** A tag que vai no ticket, para o escritório poder filtrar a fila por classe. */
export const tagDaClasse = (c: ClasseDeTicket): string => `harvey_class__${c}`;

/**
 * A nota interna das classes em observação.
 *
 * Ela diz o que ele achou, por quê, e que NÃO agiu. A última linha é o que
 * transforma a nota em treino: quem lê sabe que está avaliando um palpite, e
 * não recebendo um trabalho pronto.
 */
export function notaDeTriagem(tri: Triagem): string {
  return [
    `🤖 HARVEY — triagem: ${ROTULO_DA_CLASSE[tri.classe]}.`,
    "",
    `Por quê: ${tri.motivo}.`,
    "",
    "Não agi neste ticket. Classe nova, ainda em observação: por enquanto eu só digo o que acho que é, e a ação continua sendo de vocês.",
  ].join("\n");
}
