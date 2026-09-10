/**
 * O preço DO PARCEIRO para este job, quando alguém o escolhe no Assign partner.
 *
 * O modal só lia o `partner_cost` gravado no job. Trocar o parceiro não mudava
 * nada: aparecia o nosso valor padrão, e o preço acordado com aquele parceiro
 * para aquele tipo de trabalho ficava na tabela sem ninguém ler (dono,
 * 10/09/2026). O auto-assign e o aceite do parceiro já liam; só a atribuição
 * manual não.
 *
 * A conta em si não é nova: quem resolve é o `resolvePartnerHourlyForJob`, o
 * mesmo que o aceite usa. Aqui só se traduz o que ele devolve para os dois
 * campos que o modal tem — um total fixo, ou um valor por hora.
 */
import { resolvePartnerHourlyForJob } from "@/lib/job-pricing-resolver";
import type { CatalogService, PartnerServicePrice } from "@/types/database";

export type PrefillDoParceiro = {
  /** Total do parceiro no modo fixo, já arredondado a centavo. */
  custoFixo: number | null;
  /** Valor por hora no modo hora. */
  valorHora: number | null;
  /** `custom` = preço acordado com ESTE parceiro. `standard` = tabela padrão. */
  origem: "custom" | "standard" | null;
  /**
   * O parceiro tem preço acordado, mas em VÁRIAS faixas, e o job não diz qual.
   *
   * Acontece porque o acordo mora em `preset_overrides`, que é um preço por
   * faixa (tamanho do imóvel, tipo de laudo). Com duas ou seis faixas e nenhum
   * preset no job, escolher uma seria chutar dinheiro. 431 dos 494 jobs com
   * serviço de catálogo não têm preset.
   */
  faixaIndefinida: boolean;
};

const VAZIO: PrefillDoParceiro = { custoFixo: null, valorHora: null, origem: null, faixaIndefinida: false };

function centavo(v: number): number {
  return Math.round(v * 100) / 100;
}

export function precoDoParceiroParaOJob(input: {
  catalog: CatalogService | null;
  partnerOverride: PartnerServicePrice | null;
  presetId?: string | null;
  /** Horas do job quando ele é por hora; só entra na conta do modo fixo. */
  horasDoJob?: number | null;
}): PrefillDoParceiro {
  if (!input.catalog) return VAZIO;

  /**
   * Sem preset no job, o `resolvePartnerHourlyForJob` ignora as faixas e cai na
   * tabela. Se houver UMA faixa só, ela é a resposta sem ambiguidade nenhuma.
   */
  const faixas = (input.partnerOverride && !input.partnerOverride.use_standard
    ? (input.partnerOverride.preset_overrides as Record<string, { partner_cost?: number }> | null)
    : null) ?? {};
  const idsDeFaixa = Object.keys(faixas);
  const semPreset = !input.presetId?.trim();
  if (semPreset && idsDeFaixa.length === 1) {
    const custo = Number(faixas[idsDeFaixa[0]!]?.partner_cost);
    if (Number.isFinite(custo) && custo > 0) {
      return { custoFixo: centavo(custo), valorHora: null, origem: "custom", faixaIndefinida: false };
    }
  }
  if (semPreset && idsDeFaixa.length > 1) {
    return { ...VAZIO, faixaIndefinida: true };
  }

  const r = resolvePartnerHourlyForJob({
    catalog: input.catalog,
    partnerOverride: input.partnerOverride,
    presetId: input.presetId ?? null,
  });
  if (!(r.value != null && r.value > 0) && !(r.fixedPartnerTotal != null && r.fixedPartnerTotal > 0)) {
    return VAZIO;
  }

  /**
   * Faixa de preço fixo devolve o total pronto. Fora dela, o total do modo fixo
   * é a hora vezes as horas: as do próprio job quando existem, senão as do
   * catálogo. Sem horas nenhuma não se inventa total — melhor o campo vazio que
   * um número que ninguém calculou.
   */
  const horas = Number(input.horasDoJob) > 0
    ? Number(input.horasDoJob)
    : Number(input.catalog.default_hours) > 0
      ? Number(input.catalog.default_hours)
      : null;

  const custoFixo =
    r.fixedPartnerTotal != null && r.fixedPartnerTotal > 0
      ? centavo(r.fixedPartnerTotal)
      : r.value != null && r.value > 0 && horas != null
        ? centavo(r.value * horas)
        : null;

  return {
    custoFixo,
    valorHora: r.value != null && r.value > 0 ? centavo(r.value) : null,
    origem: r.source,
    faixaIndefinida: false,
  };
}
