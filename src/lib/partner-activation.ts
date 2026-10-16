/**
 * Ativação do parceiro fora da tela Partners (Harvey no WhatsApp, 29/09/2026).
 * Mesma regra do botão: status active, motivo was_activated, verified, e o
 * e-mail de boas-vindas com o link que já entra no portal.
 */

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPartnerAccountActivatedEmailHTML, PARTNER_ACCOUNT_ACTIVATED_SUBJECT } from "@/lib/partner-account-activated-email";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";
import { createTradePortalAutoLoginUrl } from "@/lib/partner-portal-link";
import { computeCorePartnerComplianceScore, getCoreComplianceBreakdown } from "@/lib/partner-required-docs";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const DEFAULT_FROM_EMAIL = "Fixfy <support@getfixfy.com>";

export async function carregarMarca(supabase: SupabaseClient): Promise<CompanyBranding> {
  try {
    const { data: settings } = await supabase.from("company_settings").select("*").limit(1).single();
    const s = (settings ?? {}) as Record<string, unknown>;
    return {
      companyName: String(s.company_name ?? "Fixfy"),
      logoUrl: s.logo_url ? String(s.logo_url) : undefined,
      address: String(s.address ?? "124 City Road, London, UK"),
      phone: String(s.phone ?? ""),
      email: String(s.email ?? "support@getfixfy.com"),
      website: s.website ? String(s.website) : undefined,
      vatNumber: s.vat_number ? String(s.vat_number) : undefined,
      primaryColor: String(s.primary_color ?? "#F97316"),
      tagline: s.tagline ? String(s.tagline) : undefined,
    };
  } catch {
    return { companyName: "Fixfy", address: "124 City Road, London, UK", phone: "", email: "support@getfixfy.com", primaryColor: "#F97316" };
  }
}

export type EnvioAtivacao = { ok: true; sentTo?: string; warning?: string; loginUrl?: string } | { ok: false; status: number; error: string };

/** O e-mail "your account is active" (o mesmo do botão). */
export async function enviarEmailDeAtivacao(supabase: SupabaseClient, partnerId: string): Promise<EnvioAtivacao> {
  const { data: partner, error } = await supabase.from("partners").select("id, email, contact_name, company_name, status, account_type").eq("id", partnerId).maybeSingle();
  if (error || !partner) return { ok: false, status: 404, error: "Partner not found" };
  const email = (partner.email as string | null)?.trim() ?? "";
  if (!email) return { ok: false, status: 422, error: "Partner has no email on file." };
  const contactName = (partner.contact_name as string | null)?.trim() || (partner.company_name as string | null)?.trim() || "there";
  const tradePortalBase = resolvePartnerTradePortalBaseUrl().replace(/\/$/, "");
  // O botão entra direto no portal; sem o token, cai na tela de login em vez de não mandar.
  let loginUrl = `${tradePortalBase}/login?email=${encodeURIComponent(email)}`;
  try {
    loginUrl = await createTradePortalAutoLoginUrl(supabase, partnerId, tradePortalBase);
  } catch (e) {
    console.error("[send-activated-email] auto-login link failed, using login page:", e);
  }
  const branding = await carregarMarca(supabase);
  const raw = (partner.account_type as string | null) ?? null;
  const accountType = raw === "subscription" || raw === "free" ? raw : null;
  const html = buildPartnerAccountActivatedEmailHTML(branding, { contactName, email, loginUrl, accountType });
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) return { ok: true, warning: "RESEND_API_KEY not set — email not sent", loginUrl };
  try {
    const { error: sendErr } = await new Resend(resendKey).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL,
      to: [email],
      subject: PARTNER_ACCOUNT_ACTIVATED_SUBJECT,
      html,
    });
    if (sendErr) return { ok: false, status: 500, error: sendErr.message ?? "Email send failed" };
    return { ok: true, sentTo: email };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "Email send failed" };
  }
}

export type ResultadoAtivacao =
  | { ativado: true; email: EnvioAtivacao }
  | { ativado: false; motivo: "ja_ativo" | "faltam_documentos" | "inativo"; faltando?: string[] };

/**
 * Ativa quando os 3 documentos essenciais (ID, seguro, right to work) estão
 * aprovados e na validade. Parceiro inativo (arquivado) não volta sozinho.
 */
export async function ativarSeCompleto(supabase: SupabaseClient, partnerId: string): Promise<ResultadoAtivacao> {
  const [{ data: p }, { data: docs }] = await Promise.all([
    supabase.from("partners").select("id, status, account_type").eq("id", partnerId).single(),
    supabase.from("partner_documents").select("id, name, doc_type, status, expires_at, counts_toward_compliance, created_at").eq("partner_id", partnerId),
  ]);
  if (!p) return { ativado: false, motivo: "inativo" };
  if (p.status === "active") return { ativado: false, motivo: "ja_ativo" };
  if (p.status === "inactive") return { ativado: false, motivo: "inativo" };
  const lista = (docs ?? []) as Parameters<typeof computeCorePartnerComplianceScore>[0];
  const quebra = getCoreComplianceBreakdown(lista);
  if (quebra.valid < quebra.total) return { ativado: false, motivo: "faltam_documentos", faltando: quebra.items.filter((i) => !i.ok).map((i) => i.label) };
  const { error } = await supabase
    .from("partners")
    .update({
      status: "active",
      partner_status_reasons: ["was_activated"],
      verified: true,
      account_type: p.account_type ?? "free",
      compliance_score: computeCorePartnerComplianceScore(lista),
    })
    .eq("id", partnerId);
  if (error) throw new Error(`ativar parceiro: ${error.message}`);
  return { ativado: true, email: await enviarEmailDeAtivacao(supabase, partnerId) };
}
