/**
 * Field metadata for the public quote-link report submission form.
 *
 * Mirrors the partner mobile app's `pickReportTemplate` + per-template
 * field sets in `screens/jobs/reports/*ReportScreen.tsx` so a job's V2
 * `start_report` / `final_report` JSONB written through the public form
 * lands in the same shape the dashboard V2 cards already understand.
 *
 * No timer here — public submitters type `durationHours` / `durationMinutes`
 * by hand and we serialise to `duration_ms` on submit.
 */

import { isCertificateTypeOfWork } from "@/lib/type-of-work";

export type ReportTemplate = "general" | "gardener" | "cleaner" | "certificate";

const GARDENER_KEYWORDS = ["garden", "lawn", "hedge", "landscap"];
/**
 * `tenancy` e `domestic` entraram em 14/08/2026 e não são detalhe.
 *
 * O job mais comum da Housekeep chama-se "(EOT) End of Tenancy", e nenhuma das
 * quatro palavras anteriores aparece nele: caía em `general`, o escritório
 * digitava um relatório chapado, e a Stefane o submetia no formulário de
 * limpeza da Housekeep, que pergunta cômodo a cômodo. Os campos que faltavam
 * chegavam vazios do outro lado. Eram 29 dos 182 jobs Housekeep da base.
 *
 * A regex da Stefane já dizia `tenancy` desde sempre; era esta lista que
 * estava atrás. Por isso agora existe uma fonte só, e é esta.
 */
const CLEANER_KEYWORDS  = ["clean", "housekeep", "sanitiz", "sanitis", "tenancy", "domestic"];

export function pickReportTemplate(input: {
  serviceType?: string | null;
  title?:       string | null;
}): ReportTemplate {
  const haystack = `${input.serviceType ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (GARDENER_KEYWORDS.some((k) => haystack.includes(k))) return "gardener";
  if (CLEANER_KEYWORDS.some((k) => haystack.includes(k))) return "cleaner";
  if (isCertificateTypeOfWork(input.serviceType) || isCertificateTypeOfWork(input.title)) {
    return "certificate";
  }
  return "general";
}

/**
 * A Housekeep tem dois formulários, não quatro: o de limpeza (cômodo a cômodo)
 * e o de trade (uma descrição só). Jardinagem, certificado e manutenção geral
 * vão todos para o de trade.
 *
 * Existe para que ninguém volte a escrever uma segunda lista de palavras em
 * outro arquivo: quem decide o template decide também o formulário.
 */
export function usesCleaningForm(template: ReportTemplate): boolean {
  return template === "cleaner";
}

/**
 * Quantas fotos a Housekeep aceita em cada metade do relatório.
 *
 * O botão deles diz "Upload or take photos, between 1-20 images", e o piso é
 * tão real quanto o teto: sem foto o envio é recusado. Mora aqui, e não só do
 * lado da Stefane, porque os dois formulários precisam dizer isso a quem está
 * digitando, e um número repetido em dois arquivos foi exatamente o defeito que
 * mandou End of Tenancy para o template errado.
 *
 * Vale por metade e não por cômodo: o formulário da Housekeep tem dois blocos
 * de arquivo, chegada e conclusão, e os cômodos daqui são achatados nos dois.
 */
export const HOUSEKEEP_MAX_FOTOS = 20;

/**
 * Nosso piso por bloco de foto, que **não** é regra da Housekeep.
 *
 * O formulário deles não pede quantidade nenhuma, pede que certas coisas
 * apareçam. Cinco é padrão da Fixfy, escolhido pelo dono: uma foto de cozinha
 * não mostra forno, placa, geladeira, pia e chão ao mesmo tempo.
 *
 * Avisa, não bloqueia. Quem preenche em campo com sinal ruim e trava por
 * causa de um contador manda relatório nenhum, e é esse o problema que se está
 * tentando resolver.
 */
export const FIXFY_MIN_FOTOS_POR_BLOCO = 5;

// ─── Field declarations ──────────────────────────────────────────────────────

export type ReportFieldType = "boolean" | "number" | "text" | "longtext" | "select";

export interface ReportField {
  key:           string;
  label:         string;
  hint?:         string;
  type:          ReportFieldType;
  options?:      Array<{ value: string; label: string }>;
  /** When true, treat blank as "skip" (don't send the key at all). */
  optional?:     boolean;
  /**
   * Gate: the field only shows when another field holds a given value. Use
   * `equals` for one value, `in` when several answers open the same follow-up.
   */
  showIf?:       { key: string; equals?: unknown; in?: unknown[] };
}

/**
 * Whether a gated field should be shown (and therefore collected).
 *
 * Single source of truth for the three renderers — the office modal, the public
 * partner form and `splitReportFields`. A field you cannot see is a field you
 * did not answer, so all three have to agree or the payload disagrees with the
 * screen.
 */
export function isFieldVisible(field: ReportField, data: Record<string, unknown>): boolean {
  const gate = field.showIf;
  if (!gate) return true;
  const value = data[gate.key];
  if (gate.in) return gate.in.includes(value);
  return value === gate.equals;
}

interface TemplateSpec {
  start: ReportField[];
  final: ReportField[];
}

const SPECS: Record<ReportTemplate, TemplateSpec> = {
  general: {
    start: [
      {
        key: "recommend_additional_services",
        label: "Spotted any extra work the customer should know about?",
        type: "boolean",
      },
    ],
    final: [
      {
        key: "description",
        label: "Work description",
        hint: "What was done on site, in your own words.",
        type: "longtext",
      },
      {
        key: "additional_charges",
        label: "Any additional charges agreed on site?",
        type: "boolean",
      },
      {
        key: "additional_charges_note",
        label: "Charges note",
        type: "text",
        optional: true,
        showIf: { key: "additional_charges", equals: true },
      },
      {
        // Sem `showIf`: exigir marcar um booleano antes é um clique a mais para
        // quem está transcrevendo um WhatsApp, e um handyman não tinha onde
        // registrar peça nenhuma — só o `gardener` tinha campo de material.
        key: "materials_used",
        label: "Materials or parts used",
        hint: "Parts, fittings, consumables — what went into the job.",
        type: "longtext",
        optional: true,
      },
      {
        key: "completion_status",
        label: "Completion status",
        type: "select",
        options: [
          { value: "complete",          label: "Complete" },
          { value: "partially_complete", label: "Partially complete" },
          { value: "could_not_complete", label: "Could not complete" },
        ],
      },
      {
        key: "what_needs_completing",
        label: "What still needs completing",
        hint: "The client platform asks this whenever the job is not fully done.",
        type: "longtext",
        optional: true,
        // Também quando não deu para fazer: era justo o caso mais grave que
        // chegava na Housekeep com "What still needs to be completed?" vazio.
        showIf: { key: "completion_status", in: ["partially_complete", "could_not_complete"] },
      },
      {
        key: "follow_up_required",
        label: "Follow-up required?",
        type: "boolean",
      },
    ],
  },
  gardener: {
    start: [
      {
        key: "number_of_gardeners",
        label: "Number of gardeners on site",
        type: "number",
      },
    ],
    final: [
      {
        key: "description",
        label: "Work description",
        hint: "Summary of tasks completed on the day.",
        type: "longtext",
      },
      {
        key: "waste_bags",
        label: "Waste bags removed",
        type: "number",
      },
      {
        key: "materials_charges",
        label: "Charge for materials?",
        type: "boolean",
      },
      {
        key: "materials_charges_note",
        label: "Materials note",
        type: "text",
        optional: true,
        showIf: { key: "materials_charges", equals: true },
      },
      {
        key: "all_tasks_done",
        label: "All scheduled tasks done?",
        type: "boolean",
      },
      {
        key: "next_visit_tasks",
        label: "Tasks for next visit",
        type: "longtext",
        optional: true,
      },
      {
        key: "seasonal_maintenance",
        label: "Seasonal maintenance notes",
        type: "longtext",
        optional: true,
      },
    ],
  },
  cleaner: {
    start: [
      { key: "scope_changes",        label: "Any scope changes on site?",     type: "boolean" },
      {
        key: "scope_changes_note",
        label: "Scope changes note",
        type: "text",
        optional: true,
        showIf: { key: "scope_changes", equals: true },
      },
      { key: "pre_existing_damage",  label: "Pre-existing damage noticed?",   type: "boolean" },
      { key: "photos_refused",       label: "Customer refused photos?",       type: "boolean" },
      { key: "recommend_additional_services", label: "Suggest extra services?", type: "boolean" },
    ],
    final: [
      { key: "job_complete",       label: "Job complete?",            type: "boolean" },
      { key: "customer_inspected", label: "Customer inspected the work?", type: "boolean" },
    ],
  },
  certificate: {
    start: [
      {
        key: "site_access_obtained",
        label: "Were you able to access the property?",
        type: "boolean",
      },
      {
        key: "access_issues_note",
        label: "Access issues",
        hint: "Explain what blocked access, if applicable.",
        type: "longtext",
        optional: true,
        showIf: { key: "site_access_obtained", equals: false },
      },
    ],
    final: [
      {
        key: "inspection_summary",
        label: "Inspection / testing summary",
        hint: "What was inspected or tested on site.",
        type: "longtext",
      },
      {
        key: "certificate_issued",
        label: "Certificate or report issued?",
        type: "boolean",
      },
      {
        key: "certificate_number",
        label: "Certificate / report reference",
        type: "text",
        optional: true,
        showIf: { key: "certificate_issued", equals: true },
      },
      {
        key: "certificate_outcome",
        label: "Outcome",
        type: "select",
        showIf: { key: "certificate_issued", equals: true },
        options: [
          { value: "satisfactory", label: "Satisfactory" },
          { value: "satisfactory_with_recommendations", label: "Satisfactory with recommendations" },
          { value: "unsatisfactory", label: "Unsatisfactory" },
        ],
      },
      {
        key: "expiry_date",
        label: "Expiry date",
        hint: "DD/MM/YYYY — if applicable.",
        type: "text",
        optional: true,
        showIf: { key: "certificate_issued", equals: true },
      },
      {
        key: "remedial_work_required",
        label: "Remedial work required?",
        type: "boolean",
      },
      {
        key: "remedial_work_details",
        label: "Remedial work details",
        type: "longtext",
        optional: true,
        showIf: { key: "remedial_work_required", equals: true },
      },
      {
        key: "additional_charges",
        label: "Any additional charges agreed on site?",
        type: "boolean",
      },
      {
        key: "additional_charges_note",
        label: "Charges note",
        type: "text",
        optional: true,
        showIf: { key: "additional_charges", equals: true },
      },
      {
        key: "follow_up_required",
        label: "Follow-up visit required?",
        type: "boolean",
      },
    ],
  },
};

export function fieldsForTemplate(template: ReportTemplate): TemplateSpec {
  return SPECS[template];
}

export function reportTemplateDisplayLabel(template: ReportTemplate): string {
  const labels: Record<ReportTemplate, string> = {
    general: "General maintenance",
    gardener: "Gardening",
    cleaner: "Cleaning",
    certificate: "Certificate",
  };
  return labels[template];
}

export function reportSectionTitles(template: ReportTemplate): { start: string; final: string } {
  if (template === "certificate") {
    return { start: "Site access", final: "Certificate details" };
  }
  if (template === "gardener") return { start: "On arrival", final: "On completion" };
  if (template === "cleaner") return { start: "On arrival", final: "On completion" };
  return { start: "On arrival", final: "On completion" };
}

export interface ReportPhotoSlot {
  key: string;
  label: string;
  hint?: string;
  /**
   * Piso e teto deste bloco, mostrados no rótulo e contados ao vivo.
   *
   * O teto é da Housekeep, que aceita 20 por bloco. O piso é nosso. Só existem
   * no template de limpeza porque é o único cujo formulário tem um bloco por
   * cômodo: o de trade tem dois, um de chegada e um de conclusão, e um piso
   * por metade ali não diz nada sobre cobertura.
   */
  min?: number;
  max?: number;
  /** Shown in UI only — uploads are never blocked server-side. */
  optional?: boolean;
  accept?: string;
  /** Large drop-style upload (certificate PDF/photo). */
  prominent?: boolean;
}

/** Mirrors the per-template photo bucket layout from the mobile app. */
export function photoSlotsForTemplate(template: ReportTemplate): {
  start: ReportPhotoSlot[];
  final: ReportPhotoSlot[];
} {
  if (template === "cleaner") {
    /**
     * As dicas são o texto literal do formulário da Housekeep, lido da página
     * real em 15/08/2026 (job report do JOB-9416).
     *
     * Eles não pedem um número mínimo de fotos por cômodo, pedem que certas
     * coisas apareçam nelas: forno, mata-juntas, espelhos. Quem tira a foto
     * sem saber disso manda uma panorâmica da cozinha e o relatório volta.
     * Copiar a lista deles palavra por palavra é o que faz o parceiro tirar a
     * foto certa da primeira vez, e é de graça.
     */
    const min = FIXFY_MIN_FOTOS_POR_BLOCO;
    const max = HOUSEKEEP_MAX_FOTOS;
    const rooms: ReportPhotoSlot[] = [
      { key: "living_room",   label: "Living room", hint: "Include: windows, skirting boards and floors.", min, max },
      { key: "hallways",      label: "Hallways",    hint: "Include: skirting boards and floors.", min, max },
      { key: "kitchen",       label: "Kitchen",     hint: "Include: oven, hob, fridge/freezer, sink and floors.", min, max },
      { key: "bathrooms",     label: "Bathrooms",   hint: "Include: sink, toilet, showers, mirrors and floors.", min, max },
      { key: "bedrooms",      label: "Bedrooms",    hint: "Include: mirrors, windows, skirting boards and floors.", min, max },
      // Sem piso: só existe quando a limpeza a vapor foi contratada, e exigir
      // cinco fotos de um serviço que não houve é pedir foto inventada.
      { key: "steam_cleaning", label: "Steam cleaning", hint: "Only if steam cleaning was booked in.", optional: true, max },
    ];
    return {
      start: [
        { key: "equipment", label: "Cleaning equipment", hint: "The equipment you are using on the job.", min, max },
        ...rooms,
      ],
      final: rooms,
    };
  }
  if (template === "certificate") {
    return {
      start: [],
      final: [
        {
          key: "certificate",
          label: "Attach certificate or report",
          hint: "Upload the issued certificate or report — PDF or photo.",
          accept: "image/*,application/pdf,.pdf",
          prominent: true,
          optional: true,
        },
      ],
    };
  }
  return {
    start: [{ key: "before", label: "Before photos" }],
    final: [{ key: "after",  label: "After photos" }],
  };
}
