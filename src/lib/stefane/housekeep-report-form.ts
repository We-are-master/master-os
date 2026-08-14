/**
 * STEFANE — mapa do formulário público de job report da Housekeep.
 *
 * O formulário vive em `housekeep.com/job-reports/<uuid>`, abre sem login, e é
 * o mesmo link que já guardamos em `jobs.report_link`. A Housekeep cobra o
 * relatório no mesmo dia da visita, por email, e hoje ele é entregue em 2 de
 * cada 18 jobs concluídos.
 *
 * Os identificadores abaixo parecem gerados mas não são: foram conferidos em
 * dois relatórios diferentes (JOB-9428 e JOB-9427) e são idênticos. Pertencem
 * ao template do formulário, não ao job. Se um dia a Housekeep republicar o
 * formulário eles mudam de uma vez, e é por isso que `verificarFormulario`
 * existe: melhor falhar dizendo "o formulário mudou" do que preencher metade.
 *
 * O encaixe com o nosso report v2 é de um para um porque ele foi desenhado
 * espelhando este formulário. Stefane transporta, não interpreta.
 */

/**
 * A Housekeep tem DOIS formulários, e a diferença não é cosmética.
 *
 * O de trade (Handyman, Carpenter, Painter, certificados) pergunta o que foi
 * feito em prosa e o que ficou faltando. O de limpeza não tem campo de texto
 * nenhum: pergunta se o escopo mudou, se havia dano prévio, se o cliente
 * recusou fotos e se ele inspecionou no fim.
 *
 * Quatro campos são comuns aos dois e têm o mesmo identificador: início, fim,
 * recomendação de serviços e o feedback. O resto é disjunto.
 *
 * O nosso report v2 já espelha essa divisão (`general` e `cleaner`), o que
 * torna o transporte direto nos dois casos.
 */
export type FormaHousekeep = "trade" | "limpeza";

/** Descobre qual formulário é, pelos campos que existem na página. */
export function formaDoFormulario(idsPresentes: readonly string[]): FormaHousekeep | null {
  const tem = (s: string) => idsPresentes.some((i) => i.startsWith(s));
  if (tem("9vzq8kmtvz6p")) return "trade"; // textarea "Description of work done"
  if (tem("gkbj9y40qgz4")) return "limpeza"; // "Is the job complete?" sim/não
  return null;
}

/** Campos só do formulário de limpeza. */
export const HOUSEKEEP_LIMPEZA = {
  /** "Are there changes to the original job scope?" */
  escopoMudou: { prefixo: "v3ba2epfyoem", tipo: "sim_nao" as const, rotulo: "Scope changes" },
  /** "Is there any pre-existing damage?" */
  danoPrevio: { prefixo: "vjze8w4tkazn", tipo: "sim_nao" as const, rotulo: "Pre-existing damage" },
  /** "Did the customer refuse to have photos taken?" */
  recusouFotos: { prefixo: "xvz9pjmflkbq", tipo: "sim_nao" as const, rotulo: "Photos refused" },
  /** "Is the job complete?" — sim/não, não as quatro opções do trade. */
  jobCompleto: { prefixo: "gkbj9y40qgz4", tipo: "sim_nao" as const, rotulo: "Job complete" },
  /** "Has the customer or landlord inspected and checked off the clean?" */
  clienteInspecionou: { prefixo: "2kz3prnfllbr", tipo: "sim_nao" as const, rotulo: "Customer inspected" },
} as const;

/** Campo do formulário de trade, endereçado por `name` ou por prefixo de `id`. */
export const HOUSEKEEP_CAMPOS = {
  /** Start time. input[type=time] */
  inicio: { seletor: 'input[name="2kz3prnflbrj"]', tipo: "time" as const, rotulo: "Start time" },
  /** Finish time. input[type=time] */
  fim: { seletor: 'input[name="rnorwrdu5b26"]', tipo: "time" as const, rotulo: "Finish time" },
  /** "Can you recommend any additional Housekeep services...?" */
  recomendaServicos: { prefixo: "9vzq8kmt3vz6", tipo: "sim_nao" as const, rotulo: "Recommend additional services" },
  /** "Description of work done" */
  descricao: { seletor: "#9vzq8kmtvz6p", tipo: "texto" as const, rotulo: "Description of work done" },
  /** "Are there any additional charges on today's job?" */
  cobrancaExtra: { prefixo: "6wbkjmy0x2z7", tipo: "sim_nao" as const, rotulo: "Additional charges" },
  /** Conclusão. Quatro opções, na ordem em que aparecem. */
  conclusao: { prefixo: "vxowxmk0gvz2", tipo: "escolha" as const, rotulo: "Job complete" },
  /** "What still needs to be completed?" */
  faltaFazer: { seletor: "#2kz3prnfmrbr", tipo: "texto" as const, rotulo: "What still needs completing" },
  /** "Is any follow up work required?" */
  precisaRetorno: { prefixo: "6jovglk0ylop", tipo: "sim_nao" as const, rotulo: "Follow up required" },
  /** Feedback para a Housekeep: 😞 Bad / 😐 Okay / 🙂 Good */
  feedback: { prefixo: "vxowxmk0npz2", tipo: "escolha" as const, rotulo: "Feedback" },
} as const;

/** Índice do radio de conclusão, na ordem do formulário. */
export const CONCLUSAO = {
  completo: 0, // Yes, no further work required
  maisTempo: 1, // No, more time is needed
  materiais: 2, // No, specialist materials needed
  escopoDiferente: 3, // No, job scope different to booked work
} as const;

/** Índice do radio de feedback. */
export const FEEDBACK = { ruim: 0, ok: 1, bom: 2 } as const;

/** Índice do radio sim/não. */
export const SIM = 0;
export const NAO = 1;

/**
 * Os três valores do select de `completion_status`, casados por igualdade.
 *
 * Nenhum dos dois negativos diz a **causa**, e as quatro opções da Housekeep
 * afirmam uma. `maisTempo` é a única que diz "não terminou" sem inventar
 * motivo; o porquê vai no campo de texto ao lado.
 */
const CONCLUSAO_POR_VALOR: Record<string, number> = {
  complete: CONCLUSAO.completo,
  partially_complete: CONCLUSAO.maisTempo,
  could_not_complete: CONCLUSAO.maisTempo,
};

/**
 * Traduz o `completion_status` do nosso report para o radio da Housekeep.
 *
 * Duas origens escrevem esse campo: o modal do OS e o link público mandam um
 * dos três valores do select (`public-report-templates.ts`), e o app do
 * parceiro manda texto livre. Por isso o casamento é exato primeiro, por
 * intenção depois.
 *
 * O regex sozinho não servia: `could_not_complete` contém "complete" e virava
 * **concluído**, e `partially_complete` contém "part" e virava "materiais". O
 * teste antigo só cobria frases com espaço ("not complete"), então passou o
 * tempo todo enquanto os valores reais quebravam.
 *
 * Na dúvida devolve `maisTempo`, que é a resposta honesta quando não se sabe:
 * dizer "concluído" sem certeza é o único erro caro aqui, porque fecha o job do
 * lado deles e some com a chance de voltar.
 */
export function conclusaoParaHousekeep(status: string | null | undefined): number {
  const s = String(status ?? "").toLowerCase().trim();
  if (!s) return CONCLUSAO.maisTempo;

  const exato = CONCLUSAO_POR_VALOR[s];
  if (exato !== undefined) return exato;

  // Texto livre do app do parceiro. `\bparts?\b` para "part" não casar dentro
  // de "partially"; o separador em `[ _-]` para o underscore não escapar.
  if (/scope|different|not what|wrong job/.test(s)) return CONCLUSAO.escopoDiferente;
  if (/\bparts?\b|material|specialist|supply/.test(s)) return CONCLUSAO.materiais;
  if (/more time|incomplete|(could[ _-]?not|not)[ _-](finished|complete)|partial|return/.test(s)) {
    return CONCLUSAO.maisTempo;
  }
  if (/complete|done|finished|yes|no further/.test(s)) return CONCLUSAO.completo;
  return CONCLUSAO.maisTempo;
}

/**
 * O radio de conclusão a partir do report final, seja qual for o template.
 *
 * Só `general` e `certificate` têm `completion_status`. O `gardener` diz a mesma
 * coisa por `all_tasks_done`, e sem essa ponte um jardim inteiro concluído era
 * reportado como incompleto: jardinagem cai no formulário de trade (`ehLimpeza`
 * não casa "garden"), onde o campo simplesmente não existe.
 */
export function conclusaoDoReport(f: Record<string, unknown>): number {
  const status = String(f.completion_status ?? "").trim();
  if (status) return conclusaoParaHousekeep(status);
  if (typeof f.all_tasks_done === "boolean") {
    return f.all_tasks_done ? CONCLUSAO.completo : CONCLUSAO.maisTempo;
  }
  if (typeof f.job_complete === "boolean") {
    return f.job_complete ? CONCLUSAO.completo : CONCLUSAO.maisTempo;
  }
  return CONCLUSAO.maisTempo;
}

/** `2026-08-13T14:05:00Z` → `14:05`, no fuso de Londres. */
export function horaLondres(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export type PayloadLimpeza = {
  inicio: string | null;
  fim: string | null;
  escopoMudou: boolean;
  danoPrevio: boolean;
  recusouFotos: boolean;
  jobCompleto: boolean;
  clienteInspecionou: boolean;
  recomendaServicos: boolean;
  feedback: number;
};

/**
 * Payload do formulário de limpeza, a partir dos reports de início e fim.
 *
 * Aqui a exigência é outra: o formulário não tem campo de texto, então não há
 * "descrição vazia" para barrar. O que não pode faltar é o report final, porque
 * é dele que sai a única pergunta que a Housekeep realmente usa, se o job foi
 * concluído. Sem ele, marcar qualquer coisa é chute.
 */
export function payloadLimpeza(input: {
  start: Record<string, unknown> | null;
  final: Record<string, unknown> | null;
  inicio: string | null;
  fim: string | null;
}): { ok: true; payload: PayloadLimpeza } | { ok: false; motivo: string } {
  if (!input.final) return { ok: false, motivo: "sem report final do parceiro" };
  const s = input.start ?? {};
  const f = input.final;
  return {
    ok: true,
    payload: {
      inicio: horaLondres(input.inicio),
      fim: horaLondres(input.fim),
      escopoMudou: Boolean(s.scope_changes),
      danoPrevio: Boolean(s.pre_existing_damage),
      recusouFotos: Boolean(s.photos_refused),
      jobCompleto: Boolean(f.job_complete),
      clienteInspecionou: Boolean(f.customer_inspected),
      recomendaServicos: Boolean(s.recommend_additional_services),
      feedback: FEEDBACK.bom,
    },
  };
}

export type PayloadHousekeep = {
  inicio: string | null;
  fim: string | null;
  descricao: string;
  cobrancaExtra: boolean;
  conclusao: number;
  faltaFazer: string | null;
  precisaRetorno: boolean;
  recomendaServicos: boolean;
  feedback: number;
};

/**
 * Monta o payload a partir do report final do parceiro.
 *
 * `descricao` é o único campo que a Housekeep exige de verdade em prosa, e é
 * também o que o cliente lê. Sem ele não vale submeter: relatório vazio conta
 * como entregue e queima a única chance de contar o que foi feito.
 */
export function payloadDoReport(input: {
  final: Record<string, unknown> | null;
  inicio: string | null;
  fim: string | null;
  recomendaServicos?: boolean;
}): { ok: true; payload: PayloadHousekeep } | { ok: false; motivo: string } {
  const f = input.final ?? {};
  // `inspection_summary` é como o template de certificado chama a descrição.
  // Sem essa segunda chave nenhum job de certificado conseguia ser enviado:
  // morria aqui dizendo que o report não tinha descrição.
  const descricao = String(f.description ?? f.inspection_summary ?? "").trim();
  if (!descricao) return { ok: false, motivo: "report final sem descrição do trabalho" };

  return {
    ok: true,
    payload: {
      inicio: horaLondres(input.inicio),
      fim: horaLondres(input.fim),
      descricao,
      cobrancaExtra: Boolean(f.additional_charges),
      conclusao: conclusaoDoReport(f),
      faltaFazer: (f.what_needs_completing as string | null)?.trim() || null,
      precisaRetorno: Boolean(f.follow_up_required),
      recomendaServicos: Boolean(input.recomendaServicos),
      // Sempre "bom" a menos que o parceiro tenha sinalizado problema: é
      // feedback nosso sobre a Housekeep, não sobre o job, e reclamar sem
      // motivo com quem manda 153 jobs não ajuda ninguém.
      feedback: FEEDBACK.bom,
    },
  };
}
