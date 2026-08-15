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

  // ─── o que só piora o que chega ──────────────────────────────────────────
  // Cobertura por cômodo, e só no formulário de limpeza: é o único que tem um
  // bloco por cômodo do outro lado, então um cômodo vazio chega vazio.
  if (usesCleaningForm(template)) {
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
