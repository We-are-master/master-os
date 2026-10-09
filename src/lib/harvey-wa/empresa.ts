/**
 * Empresa no WhatsApp (Fase 3, dono 09/10/2026): imobiliária, gestora ou dono de
 * carteira vira conta PENDENTE (status `onboarding`) para o dono aprovar, com os
 * dados que o Harvey colheu. A tabela de parceiro (5% abaixo) vai junto no link.
 * Conta que já existe não duplica: só avisa a equipe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountScheduleColumns } from "@/lib/account-payment-schedule";
import { dominioDoEmail, ehEmailDeEmpresa } from "@/lib/b2b-deteccao";
import { linkDaTabelaB2B } from "@/lib/catalogo-b2b";
import { notaInternaNaConversa } from "./zendesk-wa";

export type DadosDaEmpresa = {
  companyName: string;
  contactName: string;
  email: string;
  role?: string;
  properties?: string;
  services?: string;
  area?: string;
  financeEmail?: string;
  companyNumber?: string;
};

export type EmpresaRegistrada = { ok: true; jaExistia: boolean; status: string; link: string } | { ok: false; erro: string };

export async function registrarEmpresa(sb: SupabaseClient, telefone: string | null, d: DadosDaEmpresa): Promise<EmpresaRegistrada> {
  const empresa = d.companyName.trim();
  const email = d.email.trim().toLowerCase();
  if (empresa.length < 2 || !email.includes("@")) return { ok: false, erro: "company name and email are needed" };
  const link = linkDaTabelaB2B(empresa);

  // Já é conta? Pelo nome ou pelo domínio do e-mail (se for de empresa).
  const dominio = ehEmailDeEmpresa(email) ? dominioDoEmail(email) : null;
  const { data: porNome } = await sb.from("accounts").select("id, company_name, status").ilike("company_name", empresa).is("deleted_at", null).limit(1);
  type Existente = { id: string; company_name: string; status: string };
  let existente = (porNome ?? [])[0] as Existente | undefined;
  if (!existente && dominio) {
    const { data: porDominio } = await sb.from("accounts").select("id, company_name, status").ilike("email", `%@${dominio}`).is("deleted_at", null).limit(1);
    existente = (porDominio ?? [])[0] as Existente | undefined;
  }

  const resumo = [
    `Company: ${empresa}${d.companyNumber ? ` (Companies House ${d.companyNumber})` : ""}`,
    `Contact: ${d.contactName}${d.role ? `, ${d.role}` : ""} · ${email}${telefone ? ` · ${telefone}` : ""}`,
    d.properties ? `Portfolio: ${d.properties}` : "",
    d.area ? `Area: ${d.area}` : "",
    d.services ? `Services they need: ${d.services}` : "",
    d.financeEmail ? `Finance email: ${d.financeEmail}` : "",
    `Partner price list sent: ${link}`,
  ].filter(Boolean);

  if (existente) {
    await notaInternaNaConversa(telefone, [`🏢 Business contact from an EXISTING account (${existente.company_name}, ${existente.status}). Nothing was created.`, ...resumo].join("\n"), ["b2b_potential"]).catch(() => null);
    return { ok: true, jaExistia: true, status: existente.status, link };
  }

  const { error } = await sb.from("accounts").insert({
    company_name: empresa,
    contact_name: d.contactName.trim() || empresa,
    email,
    finance_email: d.financeEmail?.trim().toLowerCase() || null,
    crn: d.companyNumber?.trim() || null,
    contact_number: telefone,
    industry: "Real Estate",
    status: "onboarding",
    credit_limit: 0,
    collection_mode: "invoice",
    ...accountScheduleColumns("Net 7"),
  });
  if (error) return { ok: false, erro: error.message };
  await notaInternaNaConversa(
    telefone,
    ["🏢 New business account waiting for approval (Accounts → status Onboarding). Approve it by setting it Active; agree terms before the first job.", ...resumo].join("\n"),
    ["b2b_potential", "b2b_account_pending"],
  ).catch(() => null);
  return { ok: true, jaExistia: false, status: "onboarding", link };
}
