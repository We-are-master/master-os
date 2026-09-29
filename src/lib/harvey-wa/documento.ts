/**
 * Documento do parceiro que chega pelo WhatsApp (dono, 29/09/2026: o Harvey
 * aprova e ativa). O arquivo é lido por um modelo de visão; só vira
 * `approved` quando é legível, é o documento certo, está no nome do parceiro
 * e está na validade. Qualquer dúvida grava `pending` com o motivo, e a
 * equipe decide na tela Partners como sempre.
 *
 * Com os 3 essenciais aprovados (ID, seguro, right to work), o parceiro é
 * ativado na hora e recebe o e-mail de boas-vindas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUIRED_PARTNER_DOCS, resolvePartnerDocExpiresAt } from "@/lib/partner-required-docs";
import { uploadPartnerDocumentFileWithSupabase } from "@/services/partner-documents-storage";
import { ativarSeCompleto, type ResultadoAtivacao } from "@/lib/partner-activation";
import type { Parceiro } from "./identidade";
import { baixarMidia } from "./sunshine";
import { lerDocumento, type Leitura } from "./documento-leitura";

export { TIPOS_DE_DOC, type TipoDeDoc } from "./documento-leitura";
import type { TipoDeDoc } from "./documento-leitura";

const NOME_DO_DOC: Record<TipoDeDoc, string> = {
  id_proof: "Photo ID",
  right_to_work: "Right to Work",
  insurance: "Public Liability Insurance",
  proof_of_address: "Proof of Address",
  dbs: "DBS Certificate",
  certification: "Certificate",
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** O nome do documento bate com o do parceiro: pelo menos dois nomes em comum, ou a empresa. */
function nomeBate(noDoc: string | null, p: Parceiro): boolean {
  if (!noDoc) return false;
  const doc = new Set(semAcento(noDoc).split(/[^a-z]+/).filter((w) => w.length > 1));
  const pessoa = semAcento(p.contact_name ?? "").split(/[^a-z]+/).filter((w) => w.length > 1);
  if (pessoa.length && pessoa.filter((w) => doc.has(w)).length >= Math.min(2, pessoa.length)) return true;
  const empresa = semAcento(p.company_name ?? "").replace(/\b(ltd|limited|services|uk)\b/g, "").split(/[^a-z]+/).filter((w) => w.length > 2);
  return empresa.length > 0 && empresa.every((w) => doc.has(w));
}

export type ResultadoDocumento = {
  aprovado: boolean;
  documento: string;
  motivo: string | null;
  tambemValeComo?: string;
  ativacao?: ResultadoAtivacao;
};

export async function salvarDocumento(sb: SupabaseClient, p: Parceiro, tipo: TipoDeDoc, mediaUrl: string): Promise<ResultadoDocumento> {
  const arquivo = await baixarMidia(mediaUrl);
  if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(arquivo.tipo)) {
    return { aprovado: false, documento: NOME_DO_DOC[tipo], motivo: "unsupported file: ask for a photo or a PDF" };
  }
  if (arquivo.dados.length > 10 * 1024 * 1024) return { aprovado: false, documento: NOME_DO_DOC[tipo], motivo: "file over 10 MB: ask for a smaller photo" };

  let l: Leitura | null = null;
  let erroDeLeitura: string | null = null;
  try {
    l = await lerDocumento(arquivo, tipo);
  } catch (e) {
    erroDeLeitura = e instanceof Error ? e.message : String(e);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const venceu = !!l?.expiry_date && l.expiry_date < hoje;
  const precisaValidade = tipo === "insurance";
  const motivo = !l
    ? `could not read it automatically (${erroDeLeitura})`
    : !l.readable
      ? "not readable"
      : !l.is_expected_document
        ? `this looks like ${l.what_it_is}, not the right document`
        : l.looks_edited_or_fake
          ? "looks edited"
          : venceu
            ? `expired on ${l.expiry_date}`
            : precisaValidade && !l.expiry_date
              ? "no policy end date visible"
              : tipo !== "certification" && tipo !== "dbs" && !nomeBate(l.holder_name, p)
                ? `name on it (${l.holder_name ?? "none"}) does not match ${p.contact_name ?? p.company_name}`
                : null;
  const aprovado = motivo === null;
  const nome = tipo === "certification" && l?.certificate_title ? l.certificate_title.slice(0, 80) : NOME_DO_DOC[tipo];
  const expira = l?.expiry_date ? new Date(`${l.expiry_date}T23:59:59Z`).toISOString() : resolvePartnerDocExpiresAt(tipo === "certification" ? "certification" : tipo);
  const nota = `Received on WhatsApp. Harvey check: ${aprovado ? "approved" : `needs review: ${motivo}`}${l ? ` · read as "${l.what_it_is}", holder "${l.holder_name ?? "?"}"${l.expiry_date ? `, expires ${l.expiry_date}` : ""}` : ""}`;

  const { data: row, error } = await sb
    .from("partner_documents")
    .insert({ partner_id: p.id, name: nome, doc_type: tipo, status: aprovado ? "approved" : "pending", uploaded_by: "Harvey (WhatsApp)", expires_at: expira, notes: nota })
    .select("id")
    .single();
  if (error || !row) throw new Error(`documento: ${error?.message}`);
  const ext = arquivo.tipo === "application/pdf" ? "pdf" : arquivo.tipo.split("/")[1];
  const file = new File([new Uint8Array(arquivo.dados)], `${tipo}-whatsapp.${ext}`, { type: arquivo.tipo });
  const up = await uploadPartnerDocumentFileWithSupabase(sb, p.id, row.id as string, file);
  await sb.from("partner_documents").update({ file_path: up.path, file_name: up.fileName }).eq("id", row.id);

  // Passaporte britânico ou irlandês também prova o direito de trabalhar.
  let tambemValeComo: string | undefined;
  if (aprovado && tipo === "id_proof" && l?.british_or_irish_passport) {
    const rtw = REQUIRED_PARTNER_DOCS.find((d) => d.id === "right_to_work")!;
    await sb.from("partner_documents").insert({
      partner_id: p.id,
      name: rtw.name,
      doc_type: rtw.docType,
      status: "approved",
      uploaded_by: "Harvey (WhatsApp)",
      expires_at: null,
      file_path: up.path,
      file_name: up.fileName,
      notes: "British/Irish passport received on WhatsApp: counts as right to work.",
    });
    tambemValeComo = "Right to Work";
  }

  const ativacao = aprovado ? await ativarSeCompleto(sb, p.id) : undefined;
  return { aprovado, documento: nome, motivo, tambemValeComo, ativacao };
}
