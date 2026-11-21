/**
 * Stefane, Inspect Supervisor (dono, 10/11/2026): o resumo do final check para o DONO aprovar.
 *
 * O parceiro manda o relatório final e o job cai em Final Checks. A Stefane confere o que
 * chegou (fotos de início e fim, texto do relatório, o que o relatório aponta contra o
 * escopo, certificado quando o serviço pede um) e deixa um resumo curto no ticket do job:
 *
 *   precisaDeAcao   "Approve final report: <uma linha>" (fila-de-acao.ts)
 *   nota interna    o resumo inteiro (nunca pública)
 *
 * Ela NÃO aprova, NÃO cobra, NÃO manda nada para cliente, parceiro ou plataforma. Quem
 * aprova é o dono, no "Finish work" do job, e só aí o relatório sai.
 *
 * A conta é a mesma do final check automático (`decidirFinalCheck` lida em modo ensaio,
 * que só lê), sem LLM. Uma vez por job: a marca fica em `audit_logs`
 * (field_name `stefane_resumo_final`).
 *
 * Atrás de STEFANE_RESUMO_FINAL=1 (padrão desligado). Com FINAL_CHECK_AUTO=1 quem decide é
 * o automático e o resumo não roda: os dois nunca escrevem no mesmo job.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { certificateAttachmentUrls } from "@/lib/certificate-expiry";
import { precisaDeAcao } from "@/lib/fila-de-acao";
import { boolDoRelatorio, problemasDoRelatorio, type DecisaoFinalCheck } from "@/lib/final-check-decisao";
import { jobCustomerBillableRevenueForCollections } from "@/lib/job-financials";
import { reportCompletionGate } from "@/lib/job-phases";
import { normalizeReport } from "@/lib/job-report-v2";
import { pickReportTemplate, usesCleaningForm } from "@/lib/public-report-templates";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import type { Job } from "@/types/database";

type Env = Record<string, string | undefined>;

export const STEFANE_RESUMO_FINAL_ON = (env: Env = process.env) => env.STEFANE_RESUMO_FINAL?.trim() === "1";

/**
 * Roda ou não. Desligado por padrão; com FINAL_CHECK_AUTO=1 fica com o automático (a mesma
 * leitura de `FINAL_CHECK_AUTO_ON`, repetida aqui para este arquivo não puxar o servidor).
 */
export function resumoFinalRoda(env: Env = process.env): { roda: true } | { roda: false; motivo: "desligado" | "final_check_auto" } {
  if (!STEFANE_RESUMO_FINAL_ON(env)) return { roda: false, motivo: "desligado" };
  if (env.FINAL_CHECK_AUTO?.trim() === "1") return { roda: false, motivo: "final_check_auto" };
  return { roda: true };
}

// ─── Parte pura ─────────────────────────────────────────────────────────────

export type EntradaResumo = {
  reference: string | null;
  title?: string | null;
  partnerName: string | null;
  /** O que o cliente deve no job (`jobCustomerBillableRevenueForCollections`). */
  customerPrice: number;
  partnerCost?: number | null;
  startReport: unknown;
  finalReport: unknown;
  reportGate: { ok: boolean; message?: string };
  /** A decisão do final check automático, lida em ensaio. */
  decisao: DecisaoFinalCheck;
};

export type ResumoFinal = {
  /** Vai no "Approve final report: ...". */
  linha: string;
  /** Nota interna inteira. */
  nota: string;
  /** O que o dono precisa olhar (vazio = nada encontrado). */
  pontos: string[];
};

const libras = (n: number) => `£${(Math.round(n * 100) / 100).toFixed(2)}`;
const corta = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

/** Códigos da decisão que já saem pelo próprio relatório (portão, flags, notas). */
const JA_NO_RELATORIO = new Set(["report_incomplete", "report_flags", "partner_notes"]);

function fotosDoFim(finalReport: unknown): number {
  const r = normalizeReport(finalReport);
  if (!r) return 0;
  // O anexo do certificado não é foto do serviço: conta à parte.
  if (r.photosByRoom) return Object.entries(r.photosByRoom).filter(([k]) => k !== "certificate").reduce((s, [, l]) => s + l.length, 0);
  return r.photosFlat.length;
}

export function montarResumoFinal(e: EntradaResumo): ResumoFinal {
  const inicio = normalizeReport(e.startReport);
  const fim = normalizeReport(e.finalReport);
  const campos = fim?.fields ?? {};
  const template = fim?.template ?? inicio?.template ?? pickReportTemplate({ title: e.title ?? "" });
  const fotosInicio = inicio?.photosFlat.length ?? 0;
  const fotosFim = fotosDoFim(e.finalReport);

  const textoBruto = ["description", "inspection_summary", "notes"].map((k) => campos[k]).find((v) => typeof v === "string" && v.trim());
  const textoRelatorio = typeof textoBruto === "string" ? textoBruto.replace(/\s+/g, " ").trim() : "";
  const semCampoDeTexto = usesCleaningForm(template);

  const exigeCertificado = template === "certificate";
  const anexos = exigeCertificado ? certificateAttachmentUrls(e.finalReport).length : 0;
  const emitido = boolDoRelatorio(campos.certificate_issued);
  const certificado = !exigeCertificado
    ? "not needed for this service"
    : anexos > 0
      ? `attached (${anexos} file${anexos === 1 ? "" : "s"})`
      : `MISSING${emitido === true ? " (partner says it was issued, no file attached)" : ""}`;

  const { flags, notas } = problemasDoRelatorio(campos);
  const pontos: string[] = [];
  if (!e.reportGate.ok) pontos.push(e.reportGate.message ?? "the report is not complete");
  pontos.push(...flags);
  for (const n of notas) pontos.push(`partner note: "${n}"`);
  if (exigeCertificado && anexos === 0) pontos.push("certificate missing");
  if (!semCampoDeTexto && !textoRelatorio && e.reportGate.ok) pontos.push("no text in the final report");
  if (e.decisao.acao === "equipe" && !JA_NO_RELATORIO.has(e.decisao.codigo) && e.decisao.codigo !== "platform") {
    pontos.push(e.decisao.motivo);
  }
  const plataforma = e.decisao.acao === "equipe" && e.decisao.codigo === "platform";

  const ref = e.reference ?? "job";
  const parceiro = e.partnerName?.trim() || "no partner";
  const preco = libras(e.customerPrice);
  const fotos = `photos ${fotosInicio} start / ${fotosFim} final`;
  const achados = pontos.length
    ? `check: ${pontos.slice(0, 2).map((p) => corta(p, 70)).join("; ")}${pontos.length > 2 ? ` (+${pontos.length - 2} more)` : ""}`
    : "no issues found";
  const linha = `Approve final report: ${ref}, ${parceiro}, ${preco}, ${fotos}, ${achados}`;

  const texto = semCampoDeTexto
    ? "not asked (the cleaning form has no text field)"
    : textoRelatorio
      ? `yes ("${corta(textoRelatorio, 160)}")`
      : "NO";
  const nota = [
    `Stefane, final check summary for ${ref} (for the owner to approve)`,
    "",
    `Partner: ${parceiro}`,
    `Price: ${preco} to the customer${e.partnerCost && e.partnerCost > 0 ? ` (partner ${libras(e.partnerCost)})` : ""}`,
    `Photos: ${fotosInicio} at start, ${fotosFim} at the end`,
    `Final report text: ${texto}`,
    `Certificate: ${certificado}`,
    plataforma ? "Platform: this report goes to the client platform after you approve" : null,
    "",
    pontos.length ? "To check before approving:" : "Report vs scope: nothing found to check.",
    ...pontos.map((p) => `- ${p}`),
    "",
    "Nothing was approved, charged or sent to the customer, the partner or a platform. Approve with Finish work on the job when it is right.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return { linha, nota, pontos };
}

// ─── Banco e Zendesk ────────────────────────────────────────────────────────

/** Marca no histórico do job: uma linha por resumo levantado. */
const CAMPO_AUDIT = "stefane_resumo_final";

export type OrigemResumo = "report_submitted" | "sweep";

export type ResultadoResumo =
  | { feito: "desligado"; motivo: "desligado" | "final_check_auto" }
  | { feito: "ja_feito" }
  | { feito: "ignorado"; motivo: string }
  | { feito: "sem_ticket" }
  | { feito: "levantado"; linha: string; nota: boolean; fila: string }
  | { feito: "erro"; erro: string };

async function jaResumido(admin: SupabaseClient, jobId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "job")
    .eq("entity_id", jobId)
    .eq("field_name", CAMPO_AUDIT);
  // Sem ler a marca, não escreve: melhor um resumo a menos que dois no ticket.
  if (error) throw new Error(`audit_logs: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Levanta o resumo de um job em final check. Nunca lança: quem chama (rota do relatório,
 * varredura) só registra o resultado. Desligado, volta antes de tocar no banco.
 */
export async function runResumoFinalStefane(
  admin: SupabaseClient,
  jobId: string,
  opts: { origem: OrigemResumo },
): Promise<ResultadoResumo> {
  const gate = resumoFinalRoda();
  if (!gate.roda) return { feito: "desligado", motivo: gate.motivo };
  try {
    if (await jaResumido(admin, jobId)) return { feito: "ja_feito" };

    // Ensaio do automático: só lê (job, visitas, conta, faturas, pagamentos, ticket).
    // Import dinâmico: o arquivo dele é server-only e este precisa rodar no teste.
    const { runFinalCheckAutomatico } = await import("@/lib/final-check-automatico");
    const ensaio = await runFinalCheckAutomatico(admin, jobId, { origem: opts.origem, ensaio: true });
    if (ensaio.feito === "erro") return { feito: "erro", erro: ensaio.erro };
    if (ensaio.feito !== "ensaio") return { feito: "ignorado", motivo: "motivo" in ensaio ? ensaio.motivo : ensaio.feito };
    if (ensaio.decisao.acao === "ignorar") return { feito: "ignorado", motivo: ensaio.decisao.motivo };

    const { data } = await admin.from("jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
    const job = data as Job | null;
    if (!job) return { feito: "ignorado", motivo: "job not found" };
    const ticketId = getZendeskTicketId(job);
    if (!ticketId || !isZendeskConfigured()) return { feito: "sem_ticket" };

    const resumo = montarResumoFinal({
      reference: job.reference ?? null,
      title: job.title,
      partnerName: job.partner_name ?? null,
      customerPrice: jobCustomerBillableRevenueForCollections(job),
      partnerCost: Number(job.partner_cost ?? 0),
      startReport: job.start_report,
      finalReport: job.final_report,
      reportGate: reportCompletionGate(job),
      decisao: ensaio.decisao,
    });

    let nota = false;
    try {
      await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: resumo.nota } } } });
      nota = true;
    } catch (e) {
      console.error("[stefane-resumo-final] nota no ticket falhou", job.reference, e);
    }
    const fila = await precisaDeAcao(ticketId, resumo.linha);
    if (!fila.ok) console.warn("[stefane-resumo-final] Action Required", job.reference, fila.linha);
    // Nada chegou ao ticket: sem marca, a varredura tenta de novo.
    if (!nota && !fila.ok) return { feito: "erro", erro: `ticket #${ticketId}: ${fila.linha}` };

    const { error } = await admin.from("audit_logs").insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference ?? null,
      // `action` tem vocabulário fixo no banco: o evento vai em metadata.
      action: "updated",
      field_name: CAMPO_AUDIT,
      old_value: job.status ?? null,
      new_value: resumo.pontos.length ? "raised_with_points" : "raised_clean",
      metadata: { event: CAMPO_AUDIT, origem: opts.origem, pontos: resumo.pontos, nota_no_ticket: nota, fila: fila.linha },
    });
    if (error) console.error("[stefane-resumo-final] audit_logs", job.reference, error.message);
    return { feito: "levantado", linha: resumo.linha, nota, fila: fila.linha };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("[stefane-resumo-final]", jobId, erro);
    return { feito: "erro", erro };
  }
}
