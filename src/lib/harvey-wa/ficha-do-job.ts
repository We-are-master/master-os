/**
 * O Harvey deixa o formulário de Job do ticket preenchido quando passa a conversa
 * para a equipe (dono, 13/10/2026: "o Harvey deixa tudo preenchido no forms pra
 * enviar assim que tiver tudo e ele usa macro").
 *
 * Quem fecha a venda é a equipe; o que travava era digitar de novo, no formulário,
 * o que o cliente já tinha dito na conversa. Com os campos prontos, a equipe
 * confere, completa o que faltar e aperta a macro "Create Job in OS".
 *
 * Só preenche campo vazio: o que a equipe já escreveu no ticket vale mais.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi } from "@/lib/zendesk";
import { resolveQuoteCatalogServiceId } from "@/lib/quote-bid-invites";
import { ticketPeloTelefone } from "./zendesk-wa";

export const FORM_JOB = 5687141596959;
const CAMPO = {
  nome: 5693105918623,
  email: 5811705681183,
  telefone: 5811689527071,
  endereco: 5693026186527,
  data: 5693027123999,
  janela: 5737641586335,
  escopo: 5687121072927,
  preco: 5856894119839,
  tarifa: 5807260876063,
  servico: 5687087915551,
} as const;

export type FichaDoJob = {
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  postcode?: string | null;
  servico?: string | null;
  escopo?: string | null;
  preco?: number | null;
  tarifa?: string | null;
  data?: string | null;
  janela?: string | null;
};

const limpo = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** O que o Harvey mandou na ferramenta vira a ficha (aceita os nomes em inglês do modelo). */
export function fichaDaFerramenta(job: unknown, extra: Partial<FichaDoJob> = {}): FichaDoJob | null {
  const j = job && typeof job === "object" ? (job as Record<string, unknown>) : {};
  const preco = Number(j.price);
  const ficha: FichaDoJob = {
    nome: limpo(j.customer_name) || null,
    email: limpo(j.email) || null,
    endereco: limpo(j.address) || null,
    postcode: limpo(j.postcode) || null,
    servico: limpo(j.service) || null,
    escopo: limpo(j.scope) || null,
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    tarifa: limpo(j.rate) || null,
    data: limpo(j.date) || null,
    janela: limpo(j.window) || null,
    ...extra,
  };
  return Object.values(ficha).some((v) => v !== null && v !== undefined && v !== "") ? ficha : null;
}

/** "9am to 12pm", "morning", "13:00 - 15:00" viram a opção do campo Arrival Time. */
export function janelaDoFormulario(texto: string | null | undefined): string | null {
  const t = limpo(texto).toLowerCase();
  if (!t) return null;
  const hora = t.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  let h = hora ? Number(hora[1]) : NaN;
  if (hora?.[2] === "pm" && h < 12) h += 12;
  if (/evening/.test(t) || h >= 18) return "arrival_evening";
  if (/late afternoon/.test(t) || (h >= 15 && h < 18)) return "arrival_late_afternoon";
  if (/afternoon/.test(t) || (h >= 12 && h < 15)) return "arrival_early_afternoon";
  if (/early morning|first thing/.test(t) || h === 8) return "earlier_morning";
  if (/morning/.test(t) || (h >= 9 && h < 12)) return "arrival_morning";
  return null;
}

/** Endereço com o postcode junto, que é como o campo do formulário pede. */
export function enderecoDoFormulario(endereco: string | null | undefined, postcode: string | null | undefined): string | null {
  const e = limpo(endereco);
  const p = limpo(postcode).toUpperCase();
  if (!e && !p) return null;
  if (!p || e.toUpperCase().replace(/\s/g, "").includes(p.replace(/\s/g, ""))) return e || null;
  return e ? `${e}, ${p}` : p;
}

/** Os campos do formulário que a ficha consegue preencher (sem o serviço, que depende do catálogo). */
export function camposDaFicha(f: FichaDoJob): { id: number; value: string | number }[] {
  const campos: { id: number; value: string | number }[] = [];
  const por = (id: number, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== "") campos.push({ id, value: v }); };
  por(CAMPO.nome, limpo(f.nome));
  por(CAMPO.email, limpo(f.email).toLowerCase());
  por(CAMPO.telefone, limpo(f.telefone));
  por(CAMPO.endereco, enderecoDoFormulario(f.endereco, f.postcode));
  por(CAMPO.escopo, String(f.escopo ?? "").trim());
  por(CAMPO.preco, f.preco && f.preco > 0 ? f.preco : null);
  const tarifa = limpo(f.tarifa).toLowerCase();
  por(CAMPO.tarifa, /hour/.test(tarifa) ? "job_type_hourly" : tarifa || (f.preco && f.preco > 0) ? "job_type_fixed" : null);
  por(CAMPO.data, /^\d{4}-\d{2}-\d{2}$/.test(limpo(f.data)) ? limpo(f.data) : null);
  por(CAMPO.janela, janelaDoFormulario(f.janela));
  return campos;
}

type TicketZd = { id: number; ticket_form_id: number | null; custom_fields: { id: number; value: unknown }[] };

export async function preencherFormularioDoJob(sb: SupabaseClient, telefone: string | null, ficha: FichaDoJob | null): Promise<string> {
  if (!telefone || !ficha) return "sem ficha";
  const id = await ticketPeloTelefone(telefone);
  if (!id) return "ticket não achado";
  const { ticket } = await zendeskApi<{ ticket: TicketZd }>(`tickets/${id}.json`);
  if (!ticket) return "ticket não achado";
  const campos = camposDaFicha({ ...ficha, telefone: ficha.telefone ?? telefone });
  if (ficha.servico) {
    const catalogo = await resolveQuoteCatalogServiceId(sb, ficha.servico).catch(() => null);
    if (catalogo) campos.push({ id: CAMPO.servico, value: `os_${catalogo}` });
  }
  const vazio = (campoId: number) => {
    const v = ticket.custom_fields.find((c) => c.id === campoId)?.value;
    return v === null || v === undefined || v === "";
  };
  const novos = campos.filter((c) => vazio(c.id));
  if (novos.length === 0) return `ticket ${id}: nada a preencher`;
  await zendeskApi(`tickets/${id}.json`, { method: "PUT", body: { ticket: { ticket_form_id: FORM_JOB, custom_fields: novos } } });
  return `ticket ${id}: ${novos.length} campo(s) do formulário`;
}
