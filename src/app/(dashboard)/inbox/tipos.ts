/**
 * O que a página (servidor) entrega à caixa (cliente), e as etapas de cotação e
 * job que viram o funil da lateral. Sem JSX: os ícones moram na caixa.
 */

export type MensagemDaCaixa = {
  id: string;
  direcao: "entrada" | "saida";
  origem: "contato" | "celular" | "os";
  tipo: string;
  texto: string | null;
  midiaUrl: string | null;
  status: string | null;
  erro: string | null;
  quem: string | null;
  criadoEm: string;
};

export type JobDaCaixa = {
  id: string;
  ref: string;
  titulo: string | null;
  data: string | null;
  inicio: string | null;
  endereco: string | null;
  ticket: string | null;
  status: string;
  parceiro: string | null;
  cliente: string | null;
  /** Fim da janela de chegada. */
  fim: string | null;
  /** De onde veio: Housekeep, Checkatrade, ou null (Fixfy direct). */
  origem: string | null;
};

export type DocumentoDoParceiro = { id: string; nome: string; tipo: string | null; status: string | null; expira: string | null };
export type SelfBillDaCaixa = { id: string; ref: string; valor: number; jobs: number; vence: string | null; status: string; semana: string | null };

export type QuoteDaCaixa = { id: string; ref: string; titulo: string | null; status: string; total: number };
export type FaturaDaCaixa = { id: string; ref: string; job: string | null; status: string; valor: number; pago: number };

/** Job sem parceiro que dá para oferecer a quem está na conversa. */
export type JobParaOferecer = {
  id: string;
  ref: string;
  titulo: string | null;
  data: string | null;
  inicio: string | null;
  endereco: string | null;
  cliente: string | null;
  custoParceiro: number | null;
  porHora: boolean;
  scope: string | null;
};

/**
 * parceiro: o número está em `partners`.
 * cliente:  está em `clients` e já teve job. Só esses entram em Clients.
 * outro:    o resto (lead, cadastro sem job, número novo). Fica em All.
 */
export type TipoDeContato = "conta" | "parceiro" | "cliente" | "outro";

export type EtapaDaConversa = { grupo: "quote" | "job"; status: string; ref: string; id: string };

export type ConversaDaCaixa = {
  contato: string;
  nome: string;
  perfil: string | null;
  tipo: TipoDeContato;
  ultimaEntradaEm: string | null;
  mensagens: MensagemDaCaixa[];
  resolvidaEm: string | null;
  /** Fora da caixa até desarquivar. */
  arquivadaEm: string | null;
  /** Fora da caixa até o contato escrever de novo (as mensagens ficam). */
  excluidaEm: string | null;
  tags: string[];
  presenca: string | null;
  presencaEm: string | null;
  /** Até quando a equipe leu: o contador conta as entradas depois disso. */
  lidaEm: string | null;
  /** "Mark as unread": mostra o ponto mesmo sem mensagem nova. */
  naoLida: boolean;
  /** Fixada no topo da lista. */
  fixadaEm: string | null;
  /** A empresa a que o contato pertence (parceiro ou conta): nome e logo. O avatar segue ela. */
  org: { nome: string; logo: string | null } | null;
  parceiro: {
    id: string;
    empresa: string | null;
    oficio: string | null;
    email: string | null;
    status: string | null;
    nota: number | null;
    jobsFeitos: number;
    area: string | null;
    documentos: DocumentoDoParceiro[];
    /** Jobs dele já feitos sem relatório. */
    semRelatorio: { id: string; ref: string }[];
    /** O self-bill em aberto mais recente. */
    selfBill: SelfBillDaCaixa | null;
  } | null;
  cliente: {
    id: string;
    nome: string;
    email: string | null;
    endereco: string | null;
    postcode: string | null;
    contaId: string | null;
    conta: string | null;
    origem: string | null;
  } | null;
  /** Parceiro: os próximos alocados a ele. Cliente: os dele, do mais novo. */
  jobs: JobDaCaixa[];
  /** Algum job desta pessoa marcado para hoje (Londres). */
  jobHoje: JobDaCaixa | null;
  etapa: EtapaDaConversa | null;
  quotes: QuoteDaCaixa[];
  faturas: FaturaDaCaixa[];
};

export type TagDaCaixa = { nome: string; cor: string };

/** Funil: a ordem é a do trabalho andando. */
export const ETAPAS_DE_QUOTE: { status: string; rotulo: string }[] = [
  { status: "draft", rotulo: "New request" },
  { status: "in_survey", rotulo: "Survey" },
  { status: "bidding", rotulo: "Bidding" },
  { status: "quote_ready", rotulo: "Quote ready" },
  { status: "awaiting_customer", rotulo: "Quote sent" },
  { status: "awaiting_payment", rotulo: "Awaiting deposit" },
  { status: "rejected", rotulo: "Lost" },
];

export const ETAPAS_DE_JOB: { status: string; rotulo: string }[] = [
  { status: "unassigned", rotulo: "Unassigned" },
  { status: "auto_assigning", rotulo: "Finding partner" },
  { status: "scheduled", rotulo: "Scheduled" },
  { status: "late", rotulo: "Late" },
  { status: "in_progress", rotulo: "In progress" },
  { status: "on_hold", rotulo: "On hold" },
  { status: "need_attention", rotulo: "Needs attention" },
  { status: "final_check", rotulo: "Final check" },
  { status: "awaiting_payment", rotulo: "Awaiting payment" },
  { status: "completed", rotulo: "Completed" },
  { status: "cancelled", rotulo: "Cancelled" },
];

export const JOB_FECHADO = new Set(["completed", "cancelled", "deleted"]);
export const QUOTE_FECHADA = new Set(["rejected", "converted_to_job"]);

export function rotuloDaEtapa(e: Pick<EtapaDaConversa, "grupo" | "status">): string {
  const lista = e.grupo === "quote" ? ETAPAS_DE_QUOTE : ETAPAS_DE_JOB;
  return lista.find((x) => x.status === e.status)?.rotulo ?? e.status.replace(/_/g, " ");
}
