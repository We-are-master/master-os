/**
 * De qual JOB este e-mail está falando.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * Existiam três respostas para esta pergunta, uma por arquivo, e as três
 * discordavam:
 *
 *   cancelamentos.ts  link → postcode(+data) → nome     (só job vivo)
 *   reclamacoes.ts    link → postcode(+data) → nome     (vivo ou 30 dias)
 *   quoter.ts         parceiro → NOME DO CLIENTE NO ASSUNTO, e só
 *
 * O terceiro custou os tickets 50069 e 50072 em 05/09/2026: a Landlord
 * Certification mandou dois EICR prontos, em PDF, e o Harvey achou o parceiro,
 * procurou nome de cliente, não achou nenhum, e escreveu "não soube qual job
 * é". O e-mail não tem nome de cliente — tem o ENDEREÇO, no corpo e no nome do
 * arquivo:
 *
 *   "Please find attached the EICR report for the property at:
 *    31 Ardleigh Road London E17 5BU"
 *   📎 31 Ardleigh Road London E17 5BU (K88078).pdf
 *
 * A regra que faltava não era esperteza, era olhar a prova que estava lá.
 *
 * ─── A ordem, e por que ela é essa ───────────────────────────────────────
 *
 * De cima para baixo, cada degrau é menos específico que o de cima. O primeiro
 * que devolver UM job só ganha; dois ou mais é ambiguidade e ambiguidade nunca
 * vira ação. Job errado marcado como concluído, cancelado ou em hold custa
 * mais caro que job nenhum: o primeiro some da vista de todo mundo, o segundo
 * fica na fila incomodando até alguém resolver.
 */
import type { Job } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";

/** O que o e-mail entregou. Tudo opcional: quase nunca vêm todos. */
export interface PistasDoTicket {
  /** Texto do thread, para achar `JOB-####` e endereço solto. */
  texto?: string | null;
  /** HTML do thread, onde vivem os links da plataforma. */
  html?: string | null;
  /** Nome dos anexos: o PDF do certificado carrega o endereço no nome. */
  anexos?: readonly string[];
  postcode?: string | null;
  /** Endereço como o e-mail escreveu, sem normalizar. */
  endereco?: string | null;
  clientName?: string | null;
  /** `YYYY-MM-DD`. */
  date?: string | null;
  /** Quando se sabe de qual parceiro veio o e-mail. */
  partnerId?: string | null;
  /** Quando se sabe de qual organização (conta) veio. */
  organizacaoId?: string | null;
}

export interface AchadoDeJob {
  job: Job | null;
  /** Como achou, em inglês, para entrar direto na nota interna do ticket. */
  como: string;
  /**
   * Os candidatos quando houve mais de um. Vai na nota para o humano decidir
   * em dez segundos em vez de procurar do zero.
   */
  ambiguos?: Job[];
}

/**
 * Quanto tempo para trás olhar.
 *
 * `vivo` para cancelamento (não se cancela job concluído). `recente` para
 * reclamação e certificado, que chegam DEPOIS do trabalho — o EICR de sexta
 * chega na segunda, e o job já está concluído.
 */
export type Janela = "vivo" | "recente";

const DIAS_RECENTE = 45;

/** `E17 5BU`, `e175bu`, `E175BU` viram a mesma coisa. */
const chavePostcode = (s: string): string => s.replace(/\s+/g, "").toUpperCase();

/**
 * Postcode do Reino Unido dentro de qualquer texto.
 *
 * Serve para o assunto ("[Housekeep] Reschedule Carpenter: E1 3AQ"), para o
 * corpo e para o nome do anexo. Formato oficial: 1-2 letras, dígito, letra ou
 * dígito opcional, espaço opcional, dígito, duas letras.
 */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/gi;

export function postcodesNoTexto(texto: string | null | undefined): string[] {
  const achados = new Set<string>();
  for (const m of String(texto ?? "").matchAll(POSTCODE)) {
    achados.add(chavePostcode(`${m[1]}${m[2]}`));
  }
  return [...achados];
}

/** `JOB-9617` em qualquer lugar do texto. */
export function referenciasNoTexto(texto: string | null | undefined): string[] {
  return [...new Set(String(texto ?? "").match(/JOB-\d+/gi)?.map((r) => r.toUpperCase()) ?? [])];
}

async function candidatos(janela: Janela): Promise<Job[]> {
  const supabase = createServiceClient();
  let q = supabase.from("jobs").select("*").is("deleted_at", null);
  if (janela === "vivo") {
    q = q.not("status", "in", "(cancelled,completed,deleted)");
  } else {
    const corte = new Date(Date.now() - DIAS_RECENTE * 864e5).toISOString().slice(0, 10);
    q = q.not("status", "in", "(cancelled,deleted)").gte("scheduled_date", corte);
  }
  const { data } = await q;
  return (data ?? []) as Job[];
}

const um = (hits: Job[], como: string): AchadoDeJob | null =>
  hits.length === 1 ? { job: hits[0]!, como } : null;

/**
 * O job de que este e-mail fala, ou nenhum.
 *
 * Nunca devolve "o mais provável". Ou a prova aponta para um só, ou o humano
 * decide — e nesse caso `ambiguos` traz a lista curta para ele.
 */
export async function acharJobDoTicket(
  pistas: PistasDoTicket,
  janela: Janela = "recente",
): Promise<AchadoDeJob> {
  const texto = `${pistas.texto ?? ""}\n${(pistas.anexos ?? []).join("\n")}`;
  const supabase = createServiceClient();

  // ── 1. A referência escrita ────────────────────────────────────────────
  // `JOB-9617` no assunto é o próprio OS falando com ele mesmo. Não há
  // interpretação possível.
  const refs = referenciasNoTexto(texto);
  if (refs.length === 1) {
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .ilike("reference", refs[0]!)
      .is("deleted_at", null);
    const achado = um((data ?? []) as Job[], `reference ${refs[0]}`);
    if (achado) return achado;
  }

  // ── 2. O link da plataforma ────────────────────────────────────────────
  // O id do card do Checkatrade é gravado em dois lugares desde origens
  // diferentes; os dois contam.
  const link = String(pistas.html ?? "").match(/business-jobs\/([a-z0-9]{10,})/i)?.[1];
  if (link) {
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .or(`internal_notes.ilike.%checkatrade-lead:${link}%,report_link.ilike.%business-jobs/${link}%`)
      .is("deleted_at", null);
    const achado = um((data ?? []) as Job[], `platform link (${link})`);
    if (achado) return achado;
  }

  // O card da Housekeep tem uuid próprio, gravado no report_link.
  const card = String(pistas.html ?? "").match(/job-reports\/([a-f0-9]{16,})/i)?.[1];
  if (card) {
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .ilike("report_link", `%job-reports/${card}%`)
      .is("deleted_at", null);
    const achado = um((data ?? []) as Job[], `platform card (${card.slice(0, 10)}…)`);
    if (achado) return achado;
  }

  const pool = await candidatos(janela);

  /** Estreita por parceiro ou organização quando se sabe de quem veio. */
  const doRemetente = (lista: Job[]): Job[] => {
    if (pistas.partnerId) {
      const meus = lista.filter((j) => j.partner_id === pistas.partnerId);
      if (meus.length > 0) return meus;
    }
    return lista;
  };

  // ── 3. O postcode ──────────────────────────────────────────────────────
  // A prova mais barata e mais presente. Está no assunto do reschedule
  // ("Reschedule Carpenter: E1 3AQ"), no corpo do certificado, e no nome do
  // PDF anexado. Procura em TUDO, não só no campo que o modelo extraiu.
  const pcs = new Set<string>([
    ...(pistas.postcode ? [chavePostcode(pistas.postcode)] : []),
    ...postcodesNoTexto(texto),
    ...postcodesNoTexto(pistas.endereco),
  ]);
  for (const pc of pcs) {
    const hits = doRemetente(
      pool.filter((j) => chavePostcode(`${j.property_address ?? ""}`).includes(pc)),
    );
    const achado = um(hits, `postcode ${pc}`);
    if (achado) return achado;
    if (hits.length > 1 && pistas.date) {
      const doDia = hits.filter((j) => j.scheduled_date === pistas.date);
      const porData = um(doDia, `postcode ${pc} + date ${pistas.date}`);
      if (porData) return porData;
    }
    if (hits.length > 1) {
      // Guardado para a nota: o humano vê a lista curta em vez de caçar.
      return { job: null, como: `postcode ${pc} matched ${hits.length} jobs`, ambiguos: hits.slice(0, 5) };
    }
  }

  // ── 4. A rua ───────────────────────────────────────────────────────────
  // Endereço sem postcode legível acontece: "Flat 52 Basildon Court 28
  // Devonshire Street". Casa pelo número + primeira palavra forte da rua, que
  // é o que sobrevive a abreviação e vírgula fora do lugar.
  const ruaAlvo = `${pistas.endereco ?? ""} ${texto}`.toLowerCase();
  const numeros = [...new Set(ruaAlvo.match(/\b\d{1,4}\b/g) ?? [])];
  if (numeros.length > 0) {
    const hits = doRemetente(
      pool.filter((j) => {
        const end = `${j.property_address ?? ""}`.toLowerCase();
        if (!end) return false;
        const palavras = end.split(/[\s,]+/).filter((p) => p.length >= 5 && /^[a-z]+$/.test(p));
        const temPalavra = palavras.some((p) => ruaAlvo.includes(p));
        const temNumero = numeros.some((n) => new RegExp(`\\b${n}\\b`).test(end));
        return temPalavra && temNumero;
      }),
    );
    const achado = um(hits, "street address");
    if (achado) return achado;
  }

  // ── 5. O nome do cliente ───────────────────────────────────────────────
  // Por último de propósito: nome repete (dois "Smith" no mesmo mês) e chega
  // escrito de jeitos diferentes. Só decide quando nada acima decidiu.
  if (pistas.clientName && pistas.clientName.trim().length >= 4) {
    const alvo = pistas.clientName.trim().toLowerCase();
    const hits = doRemetente(pool.filter((j) => `${j.client_name ?? ""}`.toLowerCase().includes(alvo)));
    const achado = um(hits, `client name "${pistas.clientName}"`);
    if (achado) return achado;
    if (hits.length > 1) {
      return { job: null, como: `client name matched ${hits.length} jobs`, ambiguos: hits.slice(0, 5) };
    }
  }

  return { job: null, como: "no unambiguous match" };
}
