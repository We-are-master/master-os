/**
 * Quem pode receber um job, e quantas vagas tem no dia. Função pura: recebe
 * parceiros, jobs e catálogo já carregados, para os testes e o ensaio rodarem
 * sem banco. Quem carrega do Supabase é `src/lib/capacity.ts`.
 *
 * Regras (plano de 29/09/2026):
 *  - serviço: pelo catálogo, exato. Degrau 2 aceita a mesma CATEGORIA.
 *  - disponibilidade: o parceiro precisa trabalhar naquele dia e horário, sem
 *    folga na data. Sem disponibilidade preenchida = indisponível.
 *  - máx. de jobs no dia, valor mínimo do job e máx. de jobs ativos (portal).
 *  - capacidade do dia na categoria = soma das vagas dos parceiros livres
 *    menos os jobs da categoria no dia que ainda não têm parceiro.
 */

import { partnerAvailableForSlot, type JobSlot } from "@/lib/partner-availability";

export type DiaDaSemana = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Disponibilidade = {
  days?: Partial<Record<DiaDaSemana, { on?: boolean; start?: string | null; end?: string | null }>>;
  maxJobsPerDay?: number | null;
  /** Folgas por data, "YYYY-MM-DD". */
  daysOff?: string[] | null;
  [k: string]: unknown;
};

export type PreferenciasDoParceiro = {
  minJobValue?: number | null;
  maxActiveJobs?: number | null;
  autoAccept?: { on?: boolean; acceptedAt?: string | null; termsVersion?: string | null } | null;
  [k: string]: unknown;
};

export type ParceiroParaEscala = {
  id: string;
  status?: string | null;
  catalog_service_ids?: string[] | null;
  availability?: Disponibilidade | null;
  job_preferences?: PreferenciasDoParceiro | null;
};

export type JobParaEscala = {
  id?: string;
  status: string;
  partner_id?: string | null;
  catalog_service_id?: string | null;
  /** YYYY-MM-DD (dia do job em Londres). */
  data: string | null;
  startAt?: string | null;
  endAt?: string | null;
  /** O que o parceiro recebe. */
  partner_cost?: number | null;
};

/** Status que não ocupam vaga nem contam como job ativo. */
const FORA_DA_CONTA = new Set(["cancelled", "deleted"]);
/** Status de job ainda por fazer (contam em "jobs ativos"). */
const ATIVOS = new Set(["unassigned", "auto_assigning", "scheduled", "late", "in_progress", "on_hold", "need_attention"]);

export const MAX_JOBS_POR_DIA_PADRAO = 5;

export type Motivo =
  | "inativo"
  | "sem_o_servico"
  | "sem_disponibilidade"
  | "nao_trabalha_nesse_dia_ou_horario"
  | "folga"
  | "dia_cheio"
  | "valor_abaixo_do_minimo"
  | "jobs_ativos_demais";

export type Avaliacao = { ok: true } | { ok: false; motivo: Motivo };

export type Catalogo = Map<string, { category_id: string | null }>;

function diaTemConfig(d: Disponibilidade | null | undefined): boolean {
  const days = d?.days;
  return !!days && Object.values(days).some((x) => x && x.on === true);
}

export function maxPorDia(p: ParceiroParaEscala): number {
  const n = Number(p.availability?.maxJobsPerDay);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : MAX_JOBS_POR_DIA_PADRAO;
}

/** Faz o serviço do job? `categoria` = degrau 2: qualquer serviço da mesma categoria. */
export function fazOServico(p: ParceiroParaEscala, catalogServiceId: string, catalogo: Catalogo, degrau: "servico" | "categoria"): boolean {
  const meus = p.catalog_service_ids ?? [];
  if (meus.includes(catalogServiceId)) return true;
  if (degrau === "servico") return false;
  const cat = catalogo.get(catalogServiceId)?.category_id;
  return !!cat && meus.some((id) => catalogo.get(id)?.category_id === cat);
}

/** Jobs do parceiro na data (sem cancelado) e jobs ativos dele no total. */
export function cargaDoParceiro(partnerId: string, jobs: JobParaEscala[], data: string | null) {
  let noDia = 0;
  let ativos = 0;
  for (const j of jobs) {
    if (j.partner_id !== partnerId || FORA_DA_CONTA.has(j.status)) continue;
    if (data && j.data === data) noDia++;
    if (ATIVOS.has(j.status)) ativos++;
  }
  return { noDia, ativos };
}

/** O parceiro pode receber este job? Se não, o primeiro motivo. */
export function avaliarParceiro(
  p: ParceiroParaEscala,
  job: JobParaEscala,
  jobs: JobParaEscala[],
  catalogo: Catalogo,
  degrau: "servico" | "categoria" = "servico",
): Avaliacao {
  if ((p.status ?? "active") !== "active") return { ok: false, motivo: "inativo" };
  if (!job.catalog_service_id || !fazOServico(p, job.catalog_service_id, catalogo, degrau)) return { ok: false, motivo: "sem_o_servico" };
  if (!diaTemConfig(p.availability)) return { ok: false, motivo: "sem_disponibilidade" };
  if (job.data && (p.availability?.daysOff ?? []).includes(job.data)) return { ok: false, motivo: "folga" };
  const slot: JobSlot = job.startAt ? { startAt: job.startAt, endAt: job.endAt ?? null } : { scheduledDate: job.data };
  if (!partnerAvailableForSlot(p.availability as never, slot)) return { ok: false, motivo: "nao_trabalha_nesse_dia_ou_horario" };
  const carga = cargaDoParceiro(p.id, jobs, job.data);
  if (carga.noDia >= maxPorDia(p)) return { ok: false, motivo: "dia_cheio" };
  const minimo = Number(p.job_preferences?.minJobValue);
  if (Number.isFinite(minimo) && minimo > 0 && job.partner_cost != null && job.partner_cost < minimo) return { ok: false, motivo: "valor_abaixo_do_minimo" };
  const maxAtivos = Number(p.job_preferences?.maxActiveJobs);
  if (Number.isFinite(maxAtivos) && maxAtivos > 0 && carga.ativos >= maxAtivos) return { ok: false, motivo: "jobs_ativos_demais" };
  return { ok: true };
}

/** Dia da semana (Londres) de uma data YYYY-MM-DD. */
export function diaDaSemana(data: string): DiaDaSemana {
  const d = new Date(`${data}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" }).format(d).toLowerCase().slice(0, 3) as DiaDaSemana;
}

/**
 * Vagas numa categoria num dia: para cada parceiro ativo com serviço da
 * categoria que trabalha nesse dia (sem folga), `máx./dia − jobs dele no dia`;
 * menos os jobs da categoria nesse dia que ainda não têm parceiro (já foram
 * vendidos e vão ocupar alguém).
 */
export function vagasNaCategoria(
  categoryId: string,
  data: string,
  parceiros: ParceiroParaEscala[],
  jobs: JobParaEscala[],
  catalogo: Catalogo,
): { vagas: number; parceiros: number; semParceiro: number } {
  const dia = diaDaSemana(data);
  let vagas = 0;
  let quantos = 0;
  for (const p of parceiros) {
    if ((p.status ?? "active") !== "active") continue;
    if (!(p.catalog_service_ids ?? []).some((id) => catalogo.get(id)?.category_id === categoryId)) continue;
    const cfg = p.availability?.days?.[dia];
    if (!cfg || cfg.on !== true) continue;
    if ((p.availability?.daysOff ?? []).includes(data)) continue;
    quantos++;
    vagas += Math.max(0, maxPorDia(p) - cargaDoParceiro(p.id, jobs, data).noDia);
  }
  const semParceiro = jobs.filter(
    (j) => !j.partner_id && j.data === data && !FORA_DA_CONTA.has(j.status) && j.catalog_service_id && catalogo.get(j.catalog_service_id)?.category_id === categoryId,
  ).length;
  return { vagas: Math.max(0, vagas - semParceiro), parceiros: quantos, semParceiro };
}

/**
 * Entre os elegíveis com auto-accept ligado, quem leva o job direto: o que tem
 * menos jobs no dia; empate, o mais perto (distância em km, quando houver).
 */
export function escolherAutoAceite(
  elegiveis: ParceiroParaEscala[],
  jobs: JobParaEscala[],
  data: string | null,
  distanciaKm: (p: ParceiroParaEscala) => number | null = () => null,
): ParceiroParaEscala | null {
  const comChave = elegiveis.filter((p) => p.job_preferences?.autoAccept?.on === true && !!p.job_preferences.autoAccept.acceptedAt);
  if (!comChave.length) return null;
  return [...comChave].sort((a, b) => {
    const ca = cargaDoParceiro(a.id, jobs, data).noDia;
    const cb = cargaDoParceiro(b.id, jobs, data).noDia;
    if (ca !== cb) return ca - cb;
    return (distanciaKm(a) ?? 9999) - (distanciaKm(b) ?? 9999);
  })[0];
}

/** Horas até a chegada. */
export function horasAteAChegada(startAt: string, agora: Date = new Date()): number {
  return (new Date(startAt).getTime() - agora.getTime()) / 3_600_000;
}

/**
 * Política de cancelamento pelo parceiro.
 *  v1, contrato de 22/09/2026 (em vigor): £50 se faltar menos de 24h.
 *  v2, proposta de 29/09/2026 (só com PENALIDADE_V2=1, depois do contador e
 *      do contrato v2 assinado): 50% do repasse se faltar menos de 36h.
 */
export type RegraDePenalidade = "v1_50gbp_24h" | "v2_50pct_36h";

export function regraEmVigor(): RegraDePenalidade {
  return process.env.PENALIDADE_V2 === "1" ? "v2_50pct_36h" : "v1_50gbp_24h";
}

export function penalidadePelaRegra(regra: RegraDePenalidade, startAt: string | null, repasse: number | null, agora: Date = new Date(), taxaV1 = 50): number {
  if (!startAt) return 0;
  const horas = horasAteAChegada(startAt, agora);
  if (regra === "v1_50gbp_24h") return horas < 24 ? taxaV1 : 0;
  return penalidadeDeCancelamento(startAt, repasse, agora);
}

export const JANELA_PENALIDADE_HORAS = 36;
export const PERCENTUAL_PENALIDADE = 50;

export function penalidadeDeCancelamento(startAt: string | null, repasse: number | null, agora: Date = new Date()): number {
  if (!startAt || !(Number(repasse) > 0)) return 0;
  const horas = horasAteAChegada(startAt, agora);
  if (horas >= JANELA_PENALIDADE_HORAS) return 0;
  return Math.round(Number(repasse) * PERCENTUAL_PENALIDADE) / 100;
}
