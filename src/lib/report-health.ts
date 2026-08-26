/**
 * Nota de 0 a 100 do relatório, medida contra o que a plataforma do cliente
 * exige de verdade.
 *
 * Não é uma métrica de capricho. Cada item aqui é uma coisa que faz o envio
 * ser recusado, ou chegar pela metade do outro lado, e o peso é o custo real
 * de cada falha:
 *
 *   BLOQUEIA  o envio nem sai, ou sai e volta. Vale muito.
 *   PIORA     sai, mas chega pior do que devia. Vale pouco.
 *
 * O ponto de tudo é o instante: hoje o motivo de um envio recusado só aparece
 * depois de tentar, quando quem digitou já foi embora. Uma nota antes do
 * Approve transforma isso numa coisa que se resolve enquanto a pessoa ainda
 * está com a tela aberta.
 *
 * Função pura de propósito: recebe os dois envelopes e o template, e devolve
 * a nota e a lista. Sem banco, sem rede, testável linha a linha.
 */
import {
  photoSlotsForTemplate,
  usesCleaningForm,
  HOUSEKEEP_MAX_FOTOS,
  type ReportTemplate,
} from "@/lib/public-report-templates";

export type ItemDeSaude = {
  chave: string;
  /** O que falta, dito para quem pode resolver agora. */
  rotulo: string;
  ok: boolean;
  /** `true` quando a falha impede o envio, e não só o piora. */
  bloqueia: boolean;
  peso: number;
  /** Detalhe do estado atual, quando ajuda ("3 of 5"). */
  detalhe?: string;
};

/**
 * Uma exigência de foto publicada pela plataforma do cliente.
 *
 * Estruturalmente igual ao `SlotDeFoto` da Stefane, e de propósito: aqui é uma
 * função pura, sem rede e sem saber de Housekeep, e quem busca a exigência de
 * verdade passa ela para dentro.
 *
 * Existe porque os nossos números não são os deles. O nosso piso é cinco em
 * todo bloco; o deles é cinco de sala, TRÊS de corredor, cinco de cozinha,
 * cinco de banheiro, cinco de quarto e UM A DOIS de equipamento. Medir contra
 * o número errado é como um relatório tira 100/100 e volta recusado.
 */
export type ExigenciaDeFoto = {
  metade: "antes" | "depois";
  chave: string;
  rotulo: string;
  min: number;
};

export type SaudeDoRelatorio = {
  /** 0 a 100. 100 significa que não há nada conhecido para consertar. */
  nota: number;
  /** `true` quando algum item bloqueante falhou: o envio não vai passar. */
  bloqueado: boolean;
  itens: ItemDeSaude[];
  /** Só o que falta, na ordem em que vale a pena resolver. */
  pendencias: ItemDeSaude[];
};

function fotosPorSlot(report: unknown): Record<string, number> {
  const p = (report as { photos?: unknown } | null)?.photos;
  if (!p || typeof p !== "object") return {};
  if (Array.isArray(p)) return { _flat: p.length };
  return Object.fromEntries(
    Object.entries(p as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
}

const total = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

function texto(report: unknown, ...chaves: string[]): string {
  const r = (report ?? {}) as Record<string, unknown>;
  for (const c of chaves) {
    const v = r[c];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function reportHealth(input: {
  template: ReportTemplate;
  startReport?: unknown;
  finalReport?: unknown;
  finalReportSubmitted?: boolean | null;
  /** Horas de início e fim: viram os horários do outro lado. */
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
  /**
   * O que a plataforma do cliente exige DE VERDADE, quando já foi lido dela.
   *
   * Quando vem, manda: vira item BLOQUEANTE, campo a campo, com o número
   * deles. Quando não vem, a nota volta a medir contra o nosso piso, que é um
   * palpite bom mas continua palpite.
   */
  exigencias?: ExigenciaDeFoto[];
}): SaudeDoRelatorio {
  const { template } = input;
  const slots = photoSlotsForTemplate(template);
  const antes = fotosPorSlot(input.startReport);
  const depois = fotosPorSlot(input.finalReport);
  const temSecaoDeChegada = slots.start.length > 0;
  const itens: ItemDeSaude[] = [];

  const add = (i: ItemDeSaude) => itens.push(i);

  // ─── o que impede o envio ────────────────────────────────────────────────
  add({
    chave: "final",
    rotulo: "Final report filled in",
    ok: !!input.finalReportSubmitted,
    bloqueia: true,
    peso: 30,
  });

  // A descrição é o corpo do relatório no formulário de trade. O de limpeza
  // não tem campo de texto nenhum, então cobrar prosa ali seria inventar
  // exigência que não existe.
  if (!usesCleaningForm(template)) {
    const d = texto(input.finalReport, "description", "inspection_summary");
    add({
      chave: "descricao",
      rotulo: "Work description written",
      ok: d.length > 0,
      bloqueia: true,
      peso: 20,
      detalhe: d.length > 0 && d.length < 25 ? "very short" : undefined,
    });
  }

  if (temSecaoDeChegada) {
    add({
      chave: "fotos_antes",
      rotulo: "Before photos added",
      ok: total(antes) > 0,
      bloqueia: true,
      peso: usesCleaningForm(template) ? 15 : 25,
      detalhe: `${total(antes)} photo(s)`,
    });
  }
  add({
    chave: "fotos_depois",
    rotulo: "After photos added",
    ok: total(depois) > 0,
    bloqueia: true,
    peso: usesCleaningForm(template) ? 15 : 25,
    detalhe: `${total(depois)} photo(s)`,
  });

  /**
   * Cobertura medida contra a exigência publicada pela plataforma.
   *
   * Bloqueia, e bloqueia com razão: o JOB-9450 tinha 20 fotos de cada lado,
   * tirou 100/100 nesta nota, e a Housekeep recusou porque ela pede as fotos
   * separadas por cômodo com mínimo em cada um. Enquanto a nota mediu o nosso
   * número, ela dizia "pronto para enviar" sobre um relatório que não tinha
   * como entrar.
   */
  if (input.exigencias && input.exigencias.length > 0) {
    for (const e of input.exigencias) {
      if (e.min <= 0) continue;
      const mapa = e.metade === "antes" ? antes : depois;
      // `_flat` é lista sem cômodo: não conta para exigência por cômodo, porque
      // ninguém sabe qual foto é de qual lugar. Num formulário de balde único
      // (`all`) ela conta, que é o caso do de trade.
      const n = e.chave === "all" ? total(mapa) : (mapa[e.chave] ?? 0);
      add({
        chave: `${e.metade}:${e.chave}`,
        rotulo: `${e.metade === "antes" ? "Before" : "After"}: ${e.rotulo}`,
        ok: n >= e.min,
        bloqueia: true,
        peso: 6,
        detalhe: `${n} of ${e.min}`,
      });
    }
  } else if (usesCleaningForm(template)) {
    // ─── o que só piora o que chega ────────────────────────────────────────
    // Sem a exigência real em mãos, cai no nosso piso e volta a só avisar.
    for (const [metade, mapa, lista] of [
      ["Before", antes, slots.start],
      ["After", depois, slots.final],
    ] as const) {
      for (const s of lista) {
        if (!s.min) continue; // steam cleaning e afins: sem piso, sem cobrança
        const n = mapa[s.key] ?? 0;
        add({
          chave: `${metade}:${s.key}`,
          rotulo: `${metade}: ${s.label}`,
          ok: n >= s.min,
          bloqueia: false,
          peso: 3,
          detalhe: `${n} of ${s.min}`,
        });
      }
    }
  }

  // Acima do teto a Stefane corta, e o que ficou de fora ninguém vê sumir.
  const excedentes = [...Object.entries(antes), ...Object.entries(depois)].filter(
    ([, n]) => n > HOUSEKEEP_MAX_FOTOS,
  );
  if (excedentes.length > 0) {
    add({
      chave: "acima_do_teto",
      rotulo: `Over ${HOUSEKEEP_MAX_FOTOS} photos in a block, the rest will not be sent`,
      ok: false,
      bloqueia: false,
      peso: 5,
      detalhe: `${excedentes.length} block(s)`,
    });
  }

  add({
    chave: "horarios",
    rotulo: "Start and finish times set",
    ok: !!input.timerStartedAt && !!input.timerEndedAt,
    bloqueia: false,
    peso: 5,
  });

  const somaPesos = itens.reduce((a, i) => a + i.peso, 0);
  const somaOk = itens.filter((i) => i.ok).reduce((a, i) => a + i.peso, 0);
  const nota = somaPesos === 0 ? 100 : Math.round((somaOk / somaPesos) * 100);
  const bloqueado = itens.some((i) => i.bloqueia && !i.ok);

  return {
    nota,
    bloqueado,
    itens,
    // Bloqueante primeiro, e depois o mais pesado: é a ordem em que resolver
    // rende mais para quem tem cinco minutos.
    pendencias: itens
      .filter((i) => !i.ok)
      .sort((a, b) => Number(b.bloqueia) - Number(a.bloqueia) || b.peso - a.peso),
  };
}

/** Faixa da nota, para a cor e a palavra na tela. */
export function faixaDaNota(s: SaudeDoRelatorio): "bloqueado" | "incompleto" | "bom" | "pronto" {
  if (s.bloqueado) return "bloqueado";
  if (s.nota >= 100) return "pronto";
  if (s.nota >= 80) return "bom";
  return "incompleto";
}

// ─── portão da submissão ─────────────────────────────────────────────────────

export type VereditoDaSubmissao = {
  ok: boolean;
  nota: number;
  faixa: ReturnType<typeof faixaDaNota>;
  /** O que impede a submissão, dito para quem está com o formulário aberto. */
  motivos: string[];
};

const contagem = (fotos: unknown): Record<string, number> => {
  if (Array.isArray(fotos)) return { _flat: fotos.length };
  if (fotos && typeof fotos === "object") {
    return Object.fromEntries(
      Object.entries(fotos as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
    );
  }
  return {};
};

/**
 * O portão que roda NO ATO da submissão: o que a plataforma do cliente exige
 * é obrigatório aqui também, e a resposta já traz a nota.
 *
 * Antes o parceiro submetia qualquer coisa e a falta só aparecia na revisão
 * do escritório — horas depois, com o parceiro já longe do imóvel. Agora a
 * mesma régua do reportHealth decide na hora: item bloqueante faltando, a
 * submissão volta com a lista do que falta enquanto ainda dá para tirar a
 * foto. Os tetos (5 por cômodo na limpeza, 20 por metade no resto) também
 * bloqueiam aqui: estourar teto é escolha, não acidente, e o excedente seria
 * cortado em silêncio no envio.
 *
 * Exceto quando o excesso JÁ ESTAVA salvo: o app do parceiro manda 20 fotos
 * por cômodo, remover foto não existe na edição, e cobrar o teto ali fazia o
 * relatório ineditável — foi como um horário impossível ficou sem conserto em
 * 26/08 (JOB-9475). O que já está no relatório não é escolha de quem edita, e
 * quem corta o excedente para a plataforma é o envio. O teto volta a valer no
 * instante em que a submissão ACRESCENTA foto por cima dele.
 */
export function validarSubmissaoDeReport(input: {
  template: ReportTemplate;
  finalData: Record<string, unknown>;
  /** Fotos que o relatório TERÁ depois de salvo (existentes + novas). */
  startPhotos: string[] | Record<string, string[]> | null;
  finalPhotos: string[] | Record<string, string[]> | null;
  /** Respostas da seção de CHEGADA. A limpeza guarda ali metade dos gatilhos. */
  startData?: Record<string, unknown>;
  /**
   * O cliente recusou ser fotografado.
   *
   * A Housekeep some com os treze campos de foto quando isto é marcado, e a
   * exigência some junto. Repetir a regra deles aqui é o que evita o beco:
   * o parceiro responde a verdade e a tela continua cobrando o que ele acabou
   * de dizer que não existe.
   */
  photosRefused?: boolean;
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
  /**
   * Fotos que o relatório já tinha ANTES desta submissão (edição). O teto só
   * bloqueia o que passar do maior entre ele e o que já estava salvo.
   */
  fotosJaSalvas?: { start?: unknown; final?: unknown };
}): VereditoDaSubmissao {
  const saude = reportHealth({
    template: input.template,
    startReport: { photos: input.startPhotos ?? [] },
    finalReport: { photos: input.finalPhotos ?? [], ...input.finalData },
    finalReportSubmitted: true,
    timerStartedAt: input.timerStartedAt ?? null,
    timerEndedAt: input.timerEndedAt ?? null,
  });

  const ehDeFoto = (chave: string) => /foto|photo/i.test(chave);
  const motivos = saude.pendencias
    .filter((i) => i.bloqueia)
    .filter((i) => !(input.photosRefused && ehDeFoto(i.chave)))
    .map((i) => (i.detalhe ? `${i.rotulo} (${i.detalhe})` : i.rotulo));

  // Tetos por bloco: os da limpeza vêm dos slots (5), o resto usa o teto real
  // da plataforma por metade (20).
  const slots = input.photosRefused
    ? { start: [], final: [] }
    : photoSlotsForTemplate(input.template);
  for (const [rotuloMetade, fotos, jaSalvas, lista] of [
    ["Before", input.startPhotos, input.fotosJaSalvas?.start ?? null, slots.start],
    ["After", input.finalPhotos, input.fotosJaSalvas?.final ?? null, slots.final],
  ] as const) {
    const mapa = contagem(fotos);
    // O que já estava salvo não bloqueia: só o que esta submissão acrescenta.
    const mapaJa = contagem(jaSalvas);
    if (lista.length > 0 && !Array.isArray(fotos)) {
      for (const s of lista) {
        const n = mapa[s.key] ?? 0;
        if (s.max && n > s.max && n > (mapaJa[s.key] ?? 0)) {
          motivos.push(`${rotuloMetade} · ${s.label}: ${n} photos — maximum ${s.max}`);
        }
      }
    } else {
      const n = total(mapa);
      if (n > HOUSEKEEP_MAX_FOTOS && n > total(mapaJa)) {
        motivos.push(`${rotuloMetade} photos: ${n} — the client platform takes ${HOUSEKEEP_MAX_FOTOS}`);
      }
    }
  }

  /**
   * Sim que abre campo obrigatório do outro lado, conferido AQUI.
   *
   * A Housekeep transforma vários sim/não em pergunta aberta obrigatória. O
   * transporte já bloqueia quando o texto falta, mas bloquear no envio é tarde:
   * o parceiro foi embora, e quem descobre é o escritório num card que diz
   * "não subiu". Perguntar no formulário, enquanto ele ainda está com o job na
   * cabeça, é o mesmo aviso cinco horas antes.
   *
   * A dupla do jardim é a que mais dói: `materials_charges` sem
   * `materials_charges_note` era um relatório que se contradizia sozinho, com
   * "sem cobrança" no radio e o valor cobrado na descrição.
   */
  const f = input.finalData;
  const st = input.startData ?? {};
  const temTexto = (...vs: unknown[]) => vs.some((v) => String(v ?? "").trim().length > 0);
  const exigir = (ligado: unknown, rotulo: string, ...textos: unknown[]) => {
    if (ligado === true && !temTexto(...textos)) motivos.push(rotulo);
  };

  exigir(
    f.additional_charges ?? f.materials_charges,
    "What you charged extra for, and how much",
    f.additional_charges_note, f.materials_charges_note, f.materials_used,
  );
  exigir(
    st.recommend_additional_services ?? f.recommend_additional_services,
    "What extra work you would recommend",
    st.recommend_services_note, f.recommend_services_note, f.seasonal_maintenance,
  );
  exigir(st.scope_changes, "What changed in the job scope", st.scope_changes_note);
  exigir(st.pre_existing_damage, "A description of the damage you found", st.pre_existing_damage_note);
  // "Job complete? No" abre DOIS campos obrigatórios na limpeza.
  if (f.job_complete === false) {
    exigir(true, "What still needs to be completed", f.what_needs_completing);
  }

  return { ok: motivos.length === 0, nota: saude.nota, faixa: faixaDaNota(saude), motivos };
}
