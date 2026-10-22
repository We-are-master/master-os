/**
 * "Welcome to Fixfy" ao lead novo (dono, 22-23/10/2026).
 *
 * Todo lead que entra na conta Fixfy, de qualquer origem (Checkatrade, Bark, Meta,
 * WhatsApp, site), recebe o e-mail de boas-vindas com 10% na primeira compra
 * (`emails/welcome.ts`). Lead gen leva também o WhatsApp do enquiry, que sai em
 * primeiro-contato.ts. O Welcome sai pela Resend, não no ticket: é e-mail de marketing,
 * com descadastro, e o Zendesk desmontaria o desenho.
 *
 * Travas, todas obrigatórias:
 *   1. conta v2 e direct (Fixfy). Fora disso nada muda.
 *   2. janela de envio do Harvey (ajustes.ts `janelaAberta`, padrão 8h às 20h de Londres).
 *   3. e-mail válido, fora da lista de bloqueio do marketing.
 *   4. cliente que já comprou (job no OS) não recebe: a oferta é de primeira compra.
 *   5. reservarEnvio `welcome:<email>` ANTES do envio: uma vez por pessoa, para sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegrasDoProcesso } from "./conta";
import { emailDeWelcome } from "@/lib/emails/welcome";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";

/** A conta Fixfy: é com ela que os leads do Checkatrade e diretos entram. */
export const CONTA_FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
export const TAG_BOAS_VINDAS = "lead_welcome_sent";
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type LeadParaBoasVindas = {
  ticketId: number | null;
  clienteId: string;
  telefone: string | null;
  leadExterno: string | null;
  servico: string;
  nome: string | null;
  /** O e-mail do cliente; sem ele, lido de clients. */
  email?: string | null;
  contaId?: string | null;
  checkatrade?: boolean;
};

/** Uma vez por pessoa: a chave é o e-mail. */
export function chaveDasBoasVindas(email: string): string {
  return `welcome:${email.trim().toLowerCase()}`;
}

export function emailDoLeadValido(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return EMAIL_VALIDO.test(e) && !/@getfixfy\.com$/.test(e) ? e : null;
}

export type DecisaoDasBoasVindas = { mandar: true; chave: string; email: string } | { mandar: false; motivo: string };

export function decidirBoasVindas(a: {
  regras: Pick<RegrasDoProcesso, "v2" | "tipo"> | null;
  janelaAberta: boolean;
  email: string | null;
  bloqueado: boolean;
  jaComprou: boolean;
}): DecisaoDasBoasVindas {
  if (!(a.regras?.v2 === true && a.regras.tipo === "direct")) return { mandar: false, motivo: "account not on the v2 direct process" };
  const email = emailDoLeadValido(a.email);
  if (!email) return { mandar: false, motivo: "lead has no valid email" };
  if (a.bloqueado) return { mandar: false, motivo: "email is on the marketing block list" };
  if (a.jaComprou) return { mandar: false, motivo: "returning customer: the offer is for a first booking" };
  if (!a.janelaAberta) return { mandar: false, motivo: "outside sending hours" };
  return { mandar: true, chave: chaveDasBoasVindas(email), email };
}

export type DependenciasDasBoasVindas = {
  regras: (contaId: string) => Promise<RegrasDoProcesso | null>;
  janelaAberta: (agora: Date) => Promise<boolean>;
  emailDoCliente: (clienteId: string) => Promise<string | null>;
  bloqueado: (email: string) => Promise<boolean>;
  jaComprou: (email: string, clienteId: string | null) => Promise<boolean>;
  reservar: (chave: string, l: LeadParaBoasVindas, email: string) => Promise<{ reservado: boolean; motivo?: string }>;
  confirmar: (chave: string, providerId?: string | null) => Promise<void>;
  falhou: (chave: string, erro: unknown) => Promise<void>;
  enviar: (para: string, e: { assunto: string; html: string; text: string }, sair: string) => Promise<string | null>;
  linkDeSaida: (email: string) => string;
};

export type ResultadoDasBoasVindas = { enviado: boolean; motivo: string };

/** Nunca lança: o WhatsApp do enquiry já saiu e é o que importa. */
export async function mandarBoasVindasDoLead(
  lead: LeadParaBoasVindas,
  deps: DependenciasDasBoasVindas,
  agora: Date = new Date(),
): Promise<ResultadoDasBoasVindas> {
  let reserva: string | null = null;
  try {
    const regras = await deps.regras(lead.contaId ?? CONTA_FIXFY);
    // Sem v2 sai antes de qualquer leitura: produção igual a antes.
    if (!(regras?.v2 === true && regras.tipo === "direct")) return { enviado: false, motivo: "account not on the v2 direct process" };
    const email = emailDoLeadValido(lead.email !== undefined ? lead.email : await deps.emailDoCliente(lead.clienteId));
    const d = decidirBoasVindas({
      regras,
      janelaAberta: await deps.janelaAberta(agora),
      email,
      bloqueado: email ? await deps.bloqueado(email) : false,
      jaComprou: email ? await deps.jaComprou(email, lead.clienteId || null) : false,
    });
    if (!d.mandar) return { enviado: false, motivo: d.motivo };
    const r = await deps.reservar(d.chave, lead, d.email);
    if (!r.reservado) return { enviado: false, motivo: r.motivo ?? "already sent" };
    reserva = d.chave;
    const sair = deps.linkDeSaida(d.email);
    const e = emailDeWelcome({ primeiroNome: /^(there|unnamed.*|checkatrade lead)$/i.test(String(lead.nome ?? "").trim()) ? null : lead.nome, unsubscribeUrl: sair });
    const id = await deps.enviar(d.email, { assunto: e.assunto, html: e.html, text: e.text }, sair);
    await deps.confirmar(d.chave, id);
    return { enviado: true, motivo: `welcome email sent to ${d.email}` };
  } catch (e) {
    if (reserva) await deps.falhou(reserva, e).catch(() => undefined);
    return { enviado: false, motivo: e instanceof Error ? e.message.slice(0, 200) : "failed" };
  }
}

/** As dependências de verdade (Supabase, Resend, ajustes do Harvey, lista de bloqueio). */
export function dependenciasDasBoasVindas(sb: SupabaseClient): DependenciasDasBoasVindas {
  return {
    regras: async (contaId) => (await import("./conta")).processoDaConta(sb, contaId),
    janelaAberta: async (agora) => {
      const { ajustesDoHarvey, janelaAberta } = await import("@/lib/harvey-wa/ajustes");
      return janelaAberta(await ajustesDoHarvey(), agora);
    },
    emailDoCliente: async (clienteId) => {
      if (!clienteId) return null;
      const { data } = await sb.from("clients").select("email").eq("id", clienteId).maybeSingle();
      return ((data as { email?: string | null } | null)?.email ?? null) || null;
    },
    bloqueado: async (email) => (await import("@/lib/marketing/suppressions")).estaBloqueado(email),
    jaComprou: async (email, clienteId) => {
      const ids = new Set<string>(clienteId ? [clienteId] : []);
      const { data: cs } = await sb.from("clients").select("id").ilike("email", email.replace(/[%_\\]/g, "\\$&")).is("deleted_at", null).limit(10);
      for (const c of cs ?? []) ids.add((c as { id: string }).id);
      if (!ids.size) return false;
      const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).in("client_id", [...ids]).is("deleted_at", null).neq("status", "cancelled");
      return (count ?? 0) > 0;
    },
    reservar: async (chave, l, email) => {
      const { reservarEnvio } = await import("@/lib/idempotencia/envio");
      return reservarEnvio(sb, { chave, finalidade: "welcome-email", canal: "email", ticketId: l.ticketId, destinatario: email, template: "welcome_to_fixfy_v1", motivo: "new Fixfy lead" });
    },
    confirmar: async (chave, id) => (await import("@/lib/idempotencia/envio")).confirmarEnvio(sb, chave, id ?? null),
    falhou: async (chave, erro) => (await import("@/lib/idempotencia/envio")).falhouEnvio(sb, chave, erro),
    linkDeSaida: (email) => unsubscribeUrl(email),
    enviar: async (para, e, sair) => {
      const key = process.env.RESEND_API_KEY?.trim();
      if (!key) throw new Error("RESEND_API_KEY is not configured");
      const { Resend } = await import("resend");
      const { data, error } = await new Resend(key).emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy Team <hello@getfixfy.com>",
        to: para,
        replyTo: "hello@getfixfy.com",
        subject: e.assunto,
        html: e.html,
        text: e.text,
        headers: { "List-Unsubscribe": `<${sair}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },
  };
}
