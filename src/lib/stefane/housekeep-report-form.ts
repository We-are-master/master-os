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

import { HOUSEKEEP_MAX_FOTOS } from "@/lib/public-report-templates";

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
  /**
   * Os condicionais do formulário de limpeza, lidos da API deles em 20/08/2026.
   *
   * Ficaram fora do mapa até hoje porque `formaDoFormulario` enumera o que
   * está NA PÁGINA, e campo condicional não está lá até alguém responder o
   * gatilho. Foi assim que o JOB-9450 foi recusado: a limpeza tem os SEUS
   * próprios ids para "What still needs to be completed?" e para a descrição
   * do porquê, e nenhum dos dois é o id do trade, que era o único mapeado.
   *
   * Os dois ids de escopo diferem por UMA letra do id do dano
   * (`vjze8w4ty4zn` contra `vjze8w4tkazn`). Por isso vieram da API e não de
   * leitura de tela.
   */
  detalhesDaMudanca: { seletor: 'textarea[name="vjze8w4ty4zn"]', tipo: "texto" as const, rotulo: "Scope change details" },
  clienteAprovouMudanca: { prefixo: "7yzdrexix3ol", tipo: "escolha" as const, rotulo: "Customer approved changes" },
  descricaoDoDano: { seletor: 'textarea[name="rnorwrdu55b2"]', tipo: "texto" as const, rotulo: "Pre-existing damage description" },
  servicosRecomendados: { seletor: 'textarea[name="nqolmdn147z2"]', tipo: "texto" as const, rotulo: "Recommended services" },
  faltaFazer: { seletor: 'textarea[name="dnb5qnrc8qb4"]', tipo: "texto" as const, rotulo: "What still needs completing" },
  porqueIncompleto: { seletor: 'textarea[name="v3ba2epfayoe"]', tipo: "texto" as const, rotulo: "Why the job is not complete" },
} as const;

/** Campo do formulário de trade, endereçado por `name` ou por prefixo de `id`. */
export const HOUSEKEEP_CAMPOS = {
  /** Start time. input[type=time] */
  inicio: { seletor: 'input[name="2kz3prnflbrj"]', tipo: "time" as const, rotulo: "Start time" },
  /** Finish time. input[type=time] */
  fim: { seletor: 'input[name="rnorwrdu5b26"]', tipo: "time" as const, rotulo: "Finish time" },
  /** "Can you recommend any additional Housekeep services...?" */
  recomendaServicos: { prefixo: "9vzq8kmt3vz6", tipo: "sim_nao" as const, rotulo: "Recommend additional services" },
  /**
   * "Description of work done".
   *
   * Endereçado por atributo, e não por `#id`: todos os ids da Housekeep começam
   * com dígito, e `#9vzq...` é seletor CSS inválido — o navegador recusa a
   * consulta inteira antes de procurar qualquer coisa.
   */
  descricao: { seletor: 'textarea[name="9vzq8kmtvz6p"]', tipo: "texto" as const, rotulo: "Description of work done" },
  /** "Are there any additional charges on today's job?" */
  cobrancaExtra: { prefixo: "6wbkjmy0x2z7", tipo: "sim_nao" as const, rotulo: "Additional charges" },
  /** Conclusão. Quatro opções, na ordem em que aparecem. */
  conclusao: { prefixo: "vxowxmk0gvz2", tipo: "escolha" as const, rotulo: "Job complete" },
  /** "What still needs to be completed?" — mesma razão do `descricao` acima. */
  faltaFazer: { seletor: 'textarea[name="2kz3prnfmrbr"]', tipo: "texto" as const, rotulo: "What still needs completing" },
  /** "Is any follow up work required?" */
  precisaRetorno: { prefixo: "6jovglk0ylop", tipo: "sim_nao" as const, rotulo: "Follow up required" },
  /**
   * "Describe additional work". Nasce escondido e só aparece quando o retorno
   * é "Yes", e nesse instante vira obrigatório.
   *
   * Ficou um ano fora do mapa porque `formaDoFormulario` enumera o que está na
   * página, e este campo não está até alguém responder Yes. O JOB-9428 foi
   * recusado duas vezes por causa dele, com a mensagem "This field is
   * required" colada na pergunta do retorno, que já estava respondida.
   */
  trabalhoAdicional: {
    seletor: 'textarea[name="78zpg340gyzk"]',
    tipo: "texto" as const,
    rotulo: "Describe additional work",
  },
  /**
   * "Describe the recommended services". Nasce escondido atrás do sim/não de
   * recomendação, e obrigatório no instante em que ele vira Yes.
   *
   * Até 20/08/2026 a Stefane mandava esse sim/não SEMPRE como No, sem nem ler
   * a resposta do parceiro: três relatórios da base tinham o parceiro dizendo
   * "recomendo mais serviço" e a Housekeep recebeu "não". Perdia o upsell e
   * reportava errado, em silêncio, sem nunca falhar.
   */
  servicosRecomendados: { seletor: 'textarea[name="lnb7aqj0rabe"]', tipo: "texto" as const, rotulo: "Recommended services" },
  /**
   * Os dois que a cobrança extra revela, e que derrubavam o envio.
   *
   * `cobrancaExtra` já saía do relatório do parceiro, então bastava ele marcar
   * cobrança para o formulário pedir duas coisas que ninguém preenchia. Três
   * jobs da base (9303, 9368, 9370) estão nessa situação.
   */
  trabalhoAdicionalCobranca: { seletor: 'textarea[name="nqzxwdkuypok"]', tipo: "texto" as const, rotulo: "Additional work and charge" },
  clienteAprovouCobranca: { prefixo: "dmz2pagfxxok", tipo: "escolha" as const, rotulo: "Customer approved charges" },
  /** Feedback para a Housekeep: 😞 Bad / 😐 Okay / 🙂 Good */
  feedback: { prefixo: "vxowxmk0npz2", tipo: "escolha" as const, rotulo: "Feedback" },
} as const;

/**
 * Os dois blocos de foto do formulário, que a Housekeep exige.
 *
 * Não têm `id` nem `name` — por isso `formaDoFormulario`, que enumera id/name
 * não vazios, nunca os viu, e por isso ficaram um ano sem ser mapeados. A única
 * âncora estável é a ordem: o primeiro vem logo depois de "Start time" e pede
 * "photos that show the condition of the job site before work began"; o segundo
 * vem depois de "Finish time" e pede "the completed work or job site after".
 *
 * Ambos ficam dentro de sanfonas recolhidas, invisíveis na página.
 * `setInputFiles` não se importa com visibilidade; `click()` se importaria.
 */
export const HOUSEKEEP_FOTOS = {
  seletor: 'input[type="file"]',
  antes: 0,
  depois: 1,
  /** "Upload or take photos — between 1-20 images", diz o botão. */
  maximoPorBloco: HOUSEKEEP_MAX_FOTOS,
} as const;

/**
 * O formulário de LIMPEZA tem TREZE campos de arquivo, não dois.
 *
 * Contados na página real em 19/08/2026 (JOB-9450): sete em "Before photos"
 * (equipamento + cinco cômodos + vapor) e seis em "After photos". O código
 * mandava tudo para os índices 0 e 1 — ou seja, as 20 fotos de chegada iam
 * para "Cleaning equipment", que aceita DUAS, e as de conclusão iam para a
 * sala do "antes". Era por isso que o formulário deles aparecia vazio depois
 * de um envio que o nosso lado dava por feito.
 *
 * A chave é a MESMA do nosso app do parceiro (photoSlotsForTemplate): o
 * espelho só serve se os dois lados chamarem o cômodo pelo mesmo nome. O
 * rótulo é o começo do texto do bloco na página deles, e casa por prefixo
 * porque o resto do rótulo é a lista de itens ("include: oven, hob…").
 */
export const HOUSEKEEP_COMODOS: Record<string, string> = {
  equipment: "Cleaning equipment",
  living_room: "Living room",
  hallways: "Hallways",
  kitchen: "Kitchen",
  bathrooms: "Bathrooms",
  bedrooms: "Bedrooms",
  steam_cleaning: "Steam cleaning",
};

/** Os títulos das duas sanfonas de foto, como a página deles escreve. */
export const HOUSEKEEP_SECOES_FOTO = { antes: "Before photos", depois: "After photos" } as const;

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
/**
 * A descrição que a Housekeep recebe, com o que se perdia no caminho.
 *
 * O formulário de trade só tem um radio sim/não para cobrança adicional e
 * nenhum campo para material, então a descrição é o único lugar em prosa onde
 * um humano do outro lado lê o que foi usado e o que foi cobrado. Antes disso,
 * `additional_charges_note` e `materials_charges_note` eram digitados pelo
 * parceiro e descartados no transporte.
 */
function montarDescricao(f: Record<string, unknown>, base: string): string {
  const texto = (v: unknown) => String(v ?? "").trim();
  const materiais = texto(f.materials_used) || texto(f.materials_charges_note);
  const cobranca = texto(f.additional_charges_note);

  const linhas = [base];
  if (materiais) linhas.push(`Materials/parts used: ${materiais}`);
  if (cobranca) linhas.push(`Additional charges: ${cobranca}`);
  return linhas.join("\n\n");
}

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
  /** Obrigatórios quando `escopoMudou` é true. */
  detalhesDaMudanca: string | null;
  clienteAprovouMudanca: boolean;
  danoPrevio: boolean;
  /** Obrigatório quando `danoPrevio` é true. */
  descricaoDoDano: string | null;
  recusouFotos: boolean;
  jobCompleto: boolean;
  /** Os dois que o "job não está completo" revela. */
  faltaFazer: string | null;
  porqueIncompleto: string | null;
  clienteInspecionou: boolean;
  recomendaServicos: boolean;
  /** Obrigatório quando `recomendaServicos` é true. */
  servicosRecomendados: string | null;
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
  if (!input.final) return { ok: false, motivo: "no final report from the partner" };
  const s = input.start ?? {};
  const f = input.final;

  // Os três gatilhos do formulário de limpeza que abrem campo obrigatório.
  let detalhes: string | null = null;
  if (s.scope_changes) {
    const r = exigirTexto(s.scope_changes_note, "Give details of these changes", "the job scope changed");
    if (!r.ok) return { ok: false, motivo: r.motivo };
    detalhes = r.texto;
  }
  let dano: string | null = null;
  if (s.pre_existing_damage) {
    const r = exigirTexto(
      s.pre_existing_damage_note,
      "Describe the damage observed before starting the job",
      "there is pre-existing damage",
    );
    if (!r.ok) return { ok: false, motivo: r.motivo };
    dano = r.texto;
  }
  let recomendacao: string | null = null;
  if (s.recommend_additional_services) {
    const r = exigirTexto(
      s.recommend_services_note,
      "Describe the recommended services",
      "recommends additional services",
    );
    if (!r.ok) return { ok: false, motivo: r.motivo };
    recomendacao = r.texto;
  }
  /**
   * "Is the job complete? No" abre DOIS campos obrigatórios, e foi assim que o
   * JOB-9450 foi recusado: o relatório não trazia `job_complete`, o Boolean de
   * undefined virou false, a Stefane respondeu "não" e os dois campos que
   * apareceram ficaram vazios.
   */
  const completo =
    typeof f.job_complete === "boolean"
      ? f.job_complete
      : String(f.completion_status ?? "").trim() === "complete";
  let falta: string | null = null;
  let porque: string | null = null;
  if (!completo) {
    const r = exigirTexto(
      f.what_needs_completing,
      "What still needs to be completed?",
      "the job is not complete",
    );
    if (!r.ok) return { ok: false, motivo: r.motivo };
    falta = r.texto;
    porque = String(f.incomplete_reason ?? "").trim() || r.texto;
  }

  return {
    ok: true,
    payload: {
      inicio: horaLondres(input.inicio),
      fim: horaLondres(input.fim),
      escopoMudou: Boolean(s.scope_changes),
      detalhesDaMudanca: detalhes,
      clienteAprovouMudanca: Boolean(s.scope_changes_approved),
      danoPrevio: Boolean(s.pre_existing_damage),
      descricaoDoDano: dano,
      recusouFotos: Boolean(s.photos_refused),
      /**
       * O relatório nem sempre é o de limpeza, mesmo quando o formulário é.
       *
       * No JOB-9450 o parceiro digitou um relatório `general` num End of
       * Tenancy: não existe `job_complete` ali, existe `completion_status`.
       * Ler só a primeira chave devolvia `undefined`, `Boolean(undefined)` é
       * false, e a Stefane respondeu "Is the job complete? No" num job que
       * estava concluído. Responder "No" abre dois campos de texto
       * obrigatórios, e foi assim que o envio inteiro foi recusado.
       */
      jobCompleto: completo,
      faltaFazer: falta,
      porqueIncompleto: porque,
      /**
       * Sem equivalente no template chapado, e aqui o padrão honesto é `false`:
       * dizer que o cliente inspecionou sem ninguém ter registrado isso é
       * inventar uma resposta que o cliente pode desmentir.
       */
      clienteInspecionou: Boolean(f.customer_inspected),
      recomendaServicos: Boolean(s.recommend_additional_services),
      servicosRecomendados: recomendacao,
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
  /** Obrigatório quando `precisaRetorno` é true. Null quando não é. */
  trabalhoAdicional: string | null;
  recomendaServicos: boolean;
  /** Obrigatório quando `recomendaServicos` é true. */
  servicosRecomendados: string | null;
  /** Os dois que a cobrança extra revela e torna obrigatórios. */
  trabalhoAdicionalCobranca: string | null;
  clienteAprovouCobranca: boolean;
  feedback: number;
};

/**
 * O texto que um sim/não obrigou, ou o motivo de não dar para enviar.
 *
 * A Housekeep transforma vários sim/não em pergunta aberta obrigatória. Quando
 * o parceiro marcou o sim e não escreveu nada, há duas saídas ruins e uma
 * certa: responder "não" mente sobre o que ele disse, inventar o texto mente
 * sobre o serviço, e BLOQUEAR devolve a pergunta para quem sabe responder.
 * Bloquear é o certo, e a mensagem já sai pronta para o card.
 */
function exigirTexto(
  valor: unknown,
  campo: string,
  gatilho: string,
): { ok: true; texto: string } | { ok: false; motivo: string } {
  const t = String(valor ?? "").trim();
  if (t) return { ok: true, texto: t };
  return {
    ok: false,
    motivo: `the report says "${gatilho}" but "${campo}" is empty, and the client platform requires it. Fill it in Edit report.`,
  };
}

/**
 * Monta o payload a partir do report final do parceiro.
 *
 * `descricao` é o único campo que a Housekeep exige de verdade em prosa, e é
 * também o que o cliente lê. Sem ele não vale submeter: relatório vazio conta
 * como entregue e queima a única chance de contar o que foi feito.
 */
export function payloadDoReport(input: {
  final: Record<string, unknown> | null;
  /**
   * O relatório de CHEGADA entra aqui desde 20/08/2026.
   *
   * "Can you recommend any additional Housekeep services?" é pergunta do
   * template de chegada do nosso lado e do formulário inteiro do lado deles.
   * Sem este segundo envelope a resposta do parceiro não tinha como chegar, e
   * a Stefane mandava "não" por cima dela.
   */
  start?: Record<string, unknown> | null;
  inicio: string | null;
  fim: string | null;
  recomendaServicos?: boolean;
}): { ok: true; payload: PayloadHousekeep } | { ok: false; motivo: string } {
  const f = input.final ?? {};
  const s = input.start ?? {};
  // `inspection_summary` é como o template de certificado chama a descrição.
  // Sem essa segunda chave nenhum job de certificado conseguia ser enviado:
  // morria aqui dizendo que o report não tinha descrição.
  const descricao = String(f.description ?? f.inspection_summary ?? "").trim();
  if (!descricao) return { ok: false, motivo: "the final report has no work description" };

  /**
   * Os dois gatilhos que revelam campo obrigatório, conferidos aqui.
   *
   * Antes do envio e não durante: falhar com o nome do campo vazio é uma
   * mensagem que alguém resolve em trinta segundos; falhar no Submit é uma
   * recusa da Housekeep que não diz qual campo era.
   */
  /**
   * `seasonal_maintenance` do jardim É uma recomendação de serviço.
   *
   * "Feed the lawn in spring" responde exatamente "Can you recommend any
   * additional Housekeep services?", e ia para o lixo porque o template de
   * jardim não tem o booleano. Aqui o texto escrito vale como o sim.
   */
  const recomendaTexto = String(
    s.recommend_services_note ?? f.recommend_services_note ?? f.seasonal_maintenance ?? "",
  ).trim();
  // Mesma regra do retorno: o booleano do template manda quando existe, e o
  // texto do jardim só decide onde não há booleano nenhum para consultar.
  const recomendaExplicito = s.recommend_additional_services ?? f.recommend_additional_services;
  const recomenda =
    input.recomendaServicos ??
    (typeof recomendaExplicito === "boolean" ? recomendaExplicito : recomendaTexto.length > 0);
  let textoRecomendacao: string | null = null;
  if (recomenda) {
    const r = exigirTexto(
      recomendaTexto,
      "Describe the recommended services",
      "recommends additional services",
    );
    if (!r.ok) return { ok: false, motivo: r.motivo };
    textoRecomendacao = r.texto;
  }
  /**
   * JARDIM chama cobrança de `materials_charges`, e isso não é sinônimo solto.
   *
   * O template de jardim não tem `additional_charges`: quem cobra material ali
   * marca `materials_charges` e escreve quanto em `materials_charges_note`. O
   * transporte lia só o nome do template chapado, então um jardineiro que
   * cobrou £24 de casca produzia um relatório que se contradizia sozinho:
   * "Additional charges? No" no radio, e "Materials/parts used: £24" na
   * descrição logo abaixo. Quem lê do outro lado escolhe em qual acreditar.
   */
  const cobrou = Boolean(f.additional_charges ?? f.materials_charges);
  let textoCobranca: string | null = null;
  if (cobrou) {
    const r = exigirTexto(
      f.additional_charges_note ?? f.materials_charges_note ?? f.materials_used,
      "What additional work was required & how much did you charge",
      "there are additional charges",
    );
    if (!r.ok) return { ok: false, motivo: r.motivo };
    textoCobranca = r.texto;
  }

  /**
   * O retorno do jardim já estava escrito, e era jogado fora.
   *
   * `next_visit_tasks` é literalmente "o que fica para a próxima visita", e a
   * Housekeep pergunta "Is any follow up work required?" com um campo de texto
   * atrás. Um jardineiro escrevendo "a cerca precisa de outro corte em 6
   * semanas" respondia as duas coisas de uma vez, e nós mandávamos "No" e
   * descartávamos a frase.
   */
  const proximaVisita = String(f.next_visit_tasks ?? "").trim();
  /**
   * Resposta EXPLÍCITA sempre ganha da inferida.
   *
   * O template chapado tem o booleano e o parceiro respondeu; deduzir "sim" a
   * partir de um texto que sobrou noutro campo passaria por cima dele. A
   * inferência existe só onde o booleano NÃO EXISTE, que é o caso do jardim.
   */
  const precisaRetorno =
    typeof f.follow_up_required === "boolean" ? f.follow_up_required : proximaVisita.length > 0;
  const retornoTexto = String(f.what_needs_completing ?? "").trim() || proximaVisita;

  return {
    ok: true,
    payload: {
      inicio: horaLondres(input.inicio),
      fim: horaLondres(input.fim),
      // A validação acima olha só a descrição base: relatório que só tem
      // material e nenhuma descrição continua não valendo envio.
      descricao: montarDescricao(f, descricao),
      cobrancaExtra: cobrou,
      conclusao: conclusaoDoReport(f),
      faltaFazer: (f.what_needs_completing as string | null)?.trim() || null,
      precisaRetorno,
      // Responder "Yes" no retorno revela "Describe additional work" e o torna
      // obrigatório. Ou seja: dizer que precisa voltar sem dizer para quê é o
      // que a Housekeep recusa. Reaproveita o que já foi escrito sobre o que
      // ficou faltando, que é exatamente o trabalho do retorno.
      trabalhoAdicional: precisaRetorno ? retornoTexto || descricao : null,
      recomendaServicos: recomenda,
      servicosRecomendados: textoRecomendacao,
      trabalhoAdicionalCobranca: textoCobranca,
      clienteAprovouCobranca: Boolean(f.additional_charges_approved),
      // Sempre "bom" a menos que o parceiro tenha sinalizado problema: é
      // feedback nosso sobre a Housekeep, não sobre o job, e reclamar sem
      // motivo com quem manda 153 jobs não ajuda ninguém.
      feedback: FEEDBACK.bom,
    },
  };
}
