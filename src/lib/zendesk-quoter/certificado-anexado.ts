/**
 * O certificado que chega pronto por e-mail vira o relatório do job.
 *
 * ─── O caso ──────────────────────────────────────────────────────────────
 *
 * Parceiro de certificado (Landlord Certification, London Safety Certificate)
 * não usa o app nem o link de relatório: ele faz a visita, emite o documento e
 * manda por e-mail, em PDF, com o endereço no corpo e no nome do arquivo.
 *
 *   assunto: "EICR Report"
 *   corpo:   "the EICR report for the property at: 31 Ardleigh Road London E17 5BU"
 *   anexo:   31 Ardleigh Road London E17 5BU (K88078).pdf
 *
 * Até 07/09/2026 esse e-mail morria numa nota interna dizendo "não soube qual
 * job é", e alguém tinha que baixar o PDF, achar o job e subir à mão. Os
 * tickets 50069 e 50072 estavam exatamente assim.
 *
 * ─── O que este módulo faz, e o que ele NÃO faz ──────────────────────────
 *
 * Faz: acha o job pelo endereço, baixa o PDF do Zendesk, guarda no bucket dos
 * relatórios e deixa gravado no `final_report` do job, no slot `certificate` —
 * que é onde o template de certificado espera o documento.
 *
 * NÃO faz: submeter à plataforma do cliente. O relatório fica **pronto para
 * submeter**, e quem aperta o botão continua sendo gente (dono, 07/09/2026).
 * A Stefane só entra depois do `report_1_approved`, como sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { pickReportTemplate } from "@/lib/public-report-templates";
import { buildReportPayload, mergeReportPhotos } from "@/lib/report-submission";
import { acharJobDoTicket } from "./achar-job";

const BUCKET = "job-reports";
const MAX_BYTES = 20 * 1024 * 1024;

export interface AnexoDoTicket {
  file_name: string;
  content_type: string;
  size: number;
  content_url: string;
}

export type ResultadoCertificado =
  | { acao: "guardado"; reference: string; como: string; arquivo: string; nota: string }
  | { acao: "ja_tinha"; reference: string; nota: string }
  | { acao: "nota"; nota: string }
  | { acao: "nada" };

/**
 * Nem todo PDF do parceiro de certificado É o certificado.
 *
 * A regra era "é PDF, logo é certificado", e em 08/09/2026 isso arquivou a
 * fatura #2394 da Landlord Certification como se fosse o laudo do JOB-9618. O
 * e-mail era de confirmação de agendamento, com a cobrança anexa, e foi parar
 * no `final_report` pronto para ser submetido ao cliente.
 *
 * Não dá para exigir a palavra "certificate" no nome: os certificados de
 * verdade chegam nomeados pelo ENDEREÇO, sem a palavra em lugar nenhum.
 *   31 Ardleigh Road London E17 5BU (K88078).pdf
 *   Flat 52 Basildon Court 28 Devonshire Street London W1G 6PR (K88061).pdf
 *
 * Então a regra é ao contrário: recusa o que se ANUNCIA como outra coisa. Vale
 * para o nome do arquivo e para o assunto, porque a fatura às vezes vem com
 * nome genérico e o assunto é que entrega ("Invoice Attached").
 */
const PALAVRA_DE_COBRANCA =
  /\b(invoice|receipt|quotation|quote|estimate|statement|remittance|credit\s*note|purchase\s*order|proforma)\b/i;

/** Confirmação de agendamento não traz laudo: o trabalho ainda nem foi feito. */
const ASSUNTO_DE_AGENDAMENTO = /\bbooking\b.{0,40}\bconfirm(ed|ation)?\b/i;

export function ehDocumentoDoCertificado(
  nomeArquivo: string,
  assunto: string,
): { arquivar: boolean; motivo?: "cobranca_no_nome" | "cobranca_no_assunto" | "agendamento" } {
  if (PALAVRA_DE_COBRANCA.test(nomeArquivo)) return { arquivar: false, motivo: "cobranca_no_nome" };
  if (PALAVRA_DE_COBRANCA.test(assunto)) return { arquivar: false, motivo: "cobranca_no_assunto" };
  if (ASSUNTO_DE_AGENDAMENTO.test(assunto)) return { arquivar: false, motivo: "agendamento" };
  return { arquivar: true };
}

/** PDF é o formato do certificado. Foto de parede não entra aqui. */
const ehPdf = (a: AnexoDoTicket): boolean =>
  (a.content_type === "application/pdf" || /\.pdf$/i.test(a.file_name)) && a.size > 0 && a.size <= MAX_BYTES;

/**
 * Baixa com o token do Zendesk: anexo de ticket pode ser privado, e sem auth
 * o download volta HTML de login em vez do PDF.
 */
async function baixar(url: string, auth: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { Authorization: auth }, redirect: "follow" });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    // `%PDF` no começo é a prova barata de que veio o arquivo e não uma página.
    return b.length > 0 && b.subarray(0, 4).toString() === "%PDF" ? b : null;
  } catch {
    return null;
  }
}

export async function guardarCertificadoDoTicket(
  ticket: { id: number; subject: string; texto: string; html: string; anexos: AnexoDoTicket[] },
  authHeader: string,
  client?: SupabaseClient,
): Promise<ResultadoCertificado> {
  const pdfs = ticket.anexos
    .filter(ehPdf)
    .filter((a) => ehDocumentoDoCertificado(a.file_name, ticket.subject ?? "").arquivar);
  if (pdfs.length === 0) return { acao: "nada" };

  const supabase = client ?? createServiceClient();

  const { job, como, ambiguos } = await acharJobDoTicket(
    {
      texto: `${ticket.subject}\n${ticket.texto}`,
      html: ticket.html,
      anexos: pdfs.map((p) => p.file_name),
    },
    "recente",
  );

  if (!job) {
    const lista = (ambiguos ?? []).map((j) => `- ${j.reference} · ${j.property_address}`).join("\n");
    return {
      acao: "nota",
      nota: [
        "🤖 HARVEY — a certificate PDF arrived, but I could not tell which job it belongs to.",
        "",
        `File: ${pdfs[0]!.file_name}`,
        `Why: ${como}`,
        ...(lista ? ["", "Closest candidates:", lista] : []),
        "",
        "Attach it to the right job by hand, or reply with the JOB number and I will file it on my next pass.",
      ].join("\n"),
    };
  }

  /**
   * Job que já tem certificado não ganha um segundo.
   *
   * O parceiro reenvia o mesmo e-mail quando não recebe resposta, e o segundo
   * PDF idêntico no relatório vira dúvida sobre qual é o válido.
   */
  const finalAtual = (job as unknown as { final_report?: { photos?: unknown } | null }).final_report;
  const jaTem = ((finalAtual?.photos as { certificate?: unknown } | undefined)?.certificate as unknown[] | undefined)?.length;
  if (jaTem && jaTem > 0) {
    return {
      acao: "ja_tinha",
      reference: job.reference,
      nota: `🤖 HARVEY — ${job.reference} already has a certificate on its report (matched via ${como}). Nothing filed.`,
    };
  }

  const pdf = pdfs[0]!;
  const bytes = await baixar(pdf.content_url, authHeader);
  if (!bytes) {
    return {
      acao: "nota",
      nota: `🤖 HARVEY — matched ${job.reference} via ${como}, but the PDF would not download from Zendesk. File it by hand.`,
    };
  }

  const caminho = `${job.id}/final-certificate-0-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, bytes, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    return {
      acao: "nota",
      nota: `🤖 HARVEY — matched ${job.reference} via ${como}, but storing the PDF failed (${upErr.message}). File it by hand.`,
    };
  }
  const url = supabase.storage.from(BUCKET).getPublicUrl(caminho).data?.publicUrl ?? null;
  if (!url) return { acao: "nota", nota: `🤖 HARVEY — stored the PDF for ${job.reference} but got no URL back.` };

  const template = pickReportTemplate({ serviceType: job.title, title: job.title });
  const agora = new Date().toISOString();

  /**
   * Grava o relatório final, e SÓ ele.
   *
   * Não mexe em status, não carimba `report_1_approved`, não chama a Stefane.
   * O documento fica no card, pronto, e a submissão continua sendo decisão de
   * gente — que é a diferença entre adiantar trabalho e agir por conta.
   */
  const { error } = await supabase
    .from("jobs")
    .update({
      final_report: buildReportPayload({
        template,
        source: "office_manual",
        submittedAt: agora,
        photos: mergeReportPhotos(finalAtual?.photos ?? null, { certificate: [url] }),
        data: {
          certificate_issued: true,
          inspection_summary: `Certificate received by email from the partner (ticket #${ticket.id}).`,
        },
      }),
      updated_at: agora,
    })
    .eq("id", job.id);
  if (error) {
    return { acao: "nota", nota: `🤖 HARVEY — could not write the report on ${job.reference}: ${error.message}` };
  }

  return {
    acao: "guardado",
    reference: job.reference,
    como,
    arquivo: pdf.file_name,
    nota: [
      `🤖 HARVEY — certificate filed on ${job.reference} (matched via ${como}).`,
      "",
      `File: ${pdf.file_name}`,
      `Job: ${job.client_name} · ${job.property_address}`,
      "",
      "It is on the job's final report, ready to submit. Nobody submitted it and the job status did not change.",
    ].join("\n"),
  };
}

/**
 * A mesma coisa, buscando o ticket sozinho.
 *
 * Existe para o `poll.ts` chamar com um id e nada mais: o ciclo do Harvey não
 * precisa saber que anexo do Zendesk exige token nem que o corpo vem em dois
 * formatos.
 */
export async function guardarCertificadoPorTicketId(
  ticketId: number,
  client?: SupabaseClient,
): Promise<ResultadoCertificado> {
  const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
  const auth = `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64")}`;

  const tRes = await fetch(`${base}/tickets/${ticketId}.json`, { headers: { Authorization: auth } });
  if (!tRes.ok) return { acao: "nada" };
  const t = (await tRes.json()) as { ticket?: { subject?: string } };

  const cRes = await fetch(`${base}/tickets/${ticketId}/comments.json`, { headers: { Authorization: auth } });
  if (!cRes.ok) return { acao: "nada" };
  const c = (await cRes.json()) as {
    comments?: Array<{ body?: string; plain_body?: string; html_body?: string; attachments?: AnexoDoTicket[] }>;
  };
  const cs = c.comments ?? [];

  return guardarCertificadoDoTicket(
    {
      id: ticketId,
      subject: String(t.ticket?.subject ?? ""),
      texto: cs.map((x) => x.plain_body ?? x.body ?? "").join("\n").slice(0, 6000),
      html: cs.map((x) => x.html_body ?? "").join("\n"),
      anexos: cs.flatMap((x) => x.attachments ?? []),
    },
    auth,
    client,
  );
}
