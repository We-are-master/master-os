/**
 * Lead lançado pelo time: um a um (Add lead) ou em massa (Import CSV).
 *
 * Mesma tabela dos leads do site (294/295), com a ORIGEM em `channel`. Regras:
 *   - precisa de e-mail ou telefone;
 *   - se já existe lead aberto com o mesmo e-mail (ou o mesmo telefone), NÃO
 *     duplica: completa o que estava vazio, soma nota e etiquetas e registra na
 *     linha do tempo;
 *   - nasce sem sequência automática (`sequence_state = 'none'`): os três
 *     e-mails de retomada são de quem parou a reserva no site; cada origem vai
 *     ganhar o seu fluxo depois.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Origens vêm da tabela lead_channels (296, editável em Settings → Lead
 * origins). A lista abaixo é o PADRÃO: vale enquanto a tabela não é lida (ou
 * não existe) e tem as mesmas nove da semente da migration.
 */
export type Canal = string;
export type CanalDef = { key: string; label: string; active: boolean; sort: number; aliases: string[] };

export const CANAIS = ["website", "whatsapp", "phone", "email", "meta_form", "referral", "checkatrade", "walk_in", "other"] as const;

export const ROTULO_CANAL: Record<string, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  phone: "Phone",
  email: "Email",
  meta_form: "Meta form",
  referral: "Referral",
  checkatrade: "Checkatrade",
  walk_in: "Walk-in",
  other: "Other",
};

/** Como o time escreve a origem numa planilha → o valor gravado (padrão). */
const APELIDOS: Record<string, Canal> = {
  site: "website", web: "website", website: "website", getfixfy: "website",
  whatsapp: "whatsapp", wa: "whatsapp", zap: "whatsapp", whats: "whatsapp",
  phone: "phone", call: "phone", telefone: "phone", ligacao: "phone", tel: "phone",
  email: "email", "e-mail": "email", mail: "email",
  meta: "meta_form", meta_form: "meta_form", facebook: "meta_form", instagram: "meta_form", lead_form: "meta_form",
  referral: "referral", indicacao: "referral", indicação: "referral",
  checkatrade: "checkatrade",
  walk_in: "walk_in", walkin: "walk_in", presencial: "walk_in",
  other: "other", outro: "other", outros: "other",
};

export const CABECALHOS_CSV = ["name", "email", "phone", "postcode", "channel", "service", "price", "status", "notes", "campaign", "tags", "created_at"] as const;

export type LinhaDeLead = Partial<Record<(typeof CABECALHOS_CSV)[number], string>>;

export type ResultadoImport = {
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
};

const limpar = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const soDigitos = (t: string) => t.replace(/\D/g, "");

export const CANAIS_PADRAO: CanalDef[] = CANAIS.map((key, i) => ({
  key,
  label: ROTULO_CANAL[key],
  active: true,
  sort: (i + 1) * 10,
  aliases: Object.entries(APELIDOS).filter(([, v]) => v === key).map(([a]) => a),
}));

/** Rótulo de uma origem, pela lista lida do banco ou pelo padrão. */
export function rotuloCanal(key: string | null | undefined, canais: CanalDef[] = CANAIS_PADRAO): string {
  const k = key || "website";
  return canais.find((c) => c.key === k)?.label ?? ROTULO_CANAL[k] ?? k;
}

/**
 * O que a planilha escreveu → a chave gravada. Casa pela chave, pelo nome e
 * pelos apelidos; só origens ATIVAS entram. Vazio vira "other".
 */
export function canalDe(v: string | null | undefined, canais: CanalDef[] = CANAIS_PADRAO): Canal | null {
  const bruto = (v ?? "").trim().toLowerCase();
  const k = bruto.replace(/\s+/g, "_");
  const ativos = canais.filter((c) => c.active);
  if (!k) return ativos.some((c) => c.key === "other") ? "other" : null;
  const achado = ativos.find(
    (c) => c.key === k || c.label.toLowerCase() === bruto || c.aliases.some((a) => a.toLowerCase() === bruto || a.toLowerCase() === k),
  );
  return achado?.key ?? null;
}

function estadoDe(v: string | null | undefined): "new" | "hot" | "contacted" | "lost" | null {
  const k = (v ?? "").trim().toLowerCase();
  if (!k) return "new";
  const m: Record<string, "new" | "hot" | "contacted" | "lost"> = {
    new: "new", novo: "new", hot: "hot", quente: "hot", contacted: "contacted", "in contact": "contacted", "em contato": "contacted", lost: "lost", perdido: "lost",
  };
  return m[k] ?? null;
}

function precoDe(v: string | null | undefined): number | null | "invalido" {
  const t = (v ?? "").replace(/[£,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "invalido";
}

function dataDe(v: string | null | undefined): string | null | "invalida" {
  const t = (v ?? "").trim();
  if (!t) return null;
  // Aceita 2026-09-24, 2026-09-24 14:30 e 24/09/2026.
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  const d = br ? new Date(Date.UTC(+br[3], +br[2] - 1, +br[1], +(br[4] ?? 12), +(br[5] ?? 0))) : new Date(t.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "invalida" : d.toISOString();
}

/** Validação de uma linha, sem banco. Exportada para a prévia do import. */
export function validarLinha(l: LinhaDeLead, canais: CanalDef[] = CANAIS_PADRAO): { ok: true; dados: ReturnType<typeof montar> } | { ok: false; motivo: string } {
  const email = limpar(l.email, 200)?.toLowerCase() ?? null;
  const phone = limpar(l.phone, 40);
  if (!email && !phone) return { ok: false, motivo: "needs an email or a phone" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, motivo: `email "${email}" is not valid` };
  const canal = canalDe(l.channel, canais);
  if (!canal) return { ok: false, motivo: `channel "${l.channel}" is not an active origin (${canais.filter((c) => c.active).map((c) => c.key).join(", ")})` };
  const estado = estadoDe(l.status);
  if (!estado) return { ok: false, motivo: `status "${l.status}" must be new, hot, contacted or lost` };
  const preco = precoDe(l.price);
  if (preco === "invalido") return { ok: false, motivo: `price "${l.price}" is not a number` };
  const quando = dataDe(l.created_at);
  if (quando === "invalida") return { ok: false, motivo: `created_at "${l.created_at}" is not a date` };
  return { ok: true, dados: montar(l, email, phone, canal, estado, preco, quando) };
}

function montar(l: LinhaDeLead, email: string | null, phone: string | null, canal: Canal, estado: "new" | "hot" | "contacted" | "lost", preco: number | null, quando: string | null) {
  const tags = (l.tags ?? "").split(/[;,|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const campanha = limpar(l.campaign, 120);
  return {
    email,
    phone,
    full_name: limpar(l.name, 120),
    postcode: limpar(l.postcode, 10)?.toUpperCase() ?? null,
    channel: canal,
    service_label: limpar(l.service, 120),
    price: preco,
    status: estado,
    notes: limpar(l.notes, 2000),
    tags,
    source: campanha ? { utm_campaign: campanha } : {},
    created_at: quando,
  };
}

/**
 * Grava as linhas. `sb` é o cliente da sessão de quem importou (a política da
 * 294 só deixa staff), e `actorId` vai em created_by e na linha do tempo.
 */
export async function gravarLeads(
  sb: SupabaseClient,
  linhas: LinhaDeLead[],
  opts: { actorId: string | null; origem: "form" | "csv" },
): Promise<ResultadoImport> {
  const res: ResultadoImport = { criados: 0, atualizados: 0, erros: [] };
  const agora = new Date().toISOString();
  const canais = await lerCanais(sb);

  // Leads abertos de uma vez só, para casar por e-mail ou telefone em memória.
  const { data: abertos, error } = await sb
    .from("site_leads")
    .select("id, email, phone, full_name, postcode, service_label, price, notes, tags, source")
    .in("status", ["new", "hot", "contacted"])
    .limit(20000);
  if (error) {
    res.erros.push({ linha: 0, motivo: error.message });
    return res;
  }
  const porEmail = new Map<string, Record<string, unknown>>();
  const porTelefone = new Map<string, Record<string, unknown>>();
  for (const a of abertos ?? []) {
    if (a.email) porEmail.set(String(a.email).toLowerCase(), a);
    if (a.phone) porTelefone.set(soDigitos(String(a.phone)), a);
  }

  const rotuloOrigem = opts.origem === "csv" ? "Imported from CSV" : "Added by the team";

  for (const [i, bruta] of linhas.entries()) {
    const numero = i + 2; // linha 1 do CSV é o cabeçalho
    const v = validarLinha(bruta, canais);
    if (!v.ok) { res.erros.push({ linha: numero, motivo: v.motivo }); continue; }
    const d = v.dados;
    const existente = (d.email && porEmail.get(d.email)) || (d.phone && porTelefone.get(soDigitos(d.phone))) || null;

    if (existente) {
      const notas = [existente.notes, d.notes].filter(Boolean).join("\n");
      const tags = Array.from(new Set([...(((existente.tags as string[]) ?? [])), ...d.tags]));
      const { error: e } = await sb.from("site_leads").update({
        email: existente.email ?? d.email,
        phone: existente.phone ?? d.phone,
        full_name: existente.full_name ?? d.full_name,
        postcode: existente.postcode ?? d.postcode,
        service_label: existente.service_label ?? d.service_label,
        price: existente.price ?? d.price,
        notes: notas || null,
        tags,
        updated_at: agora,
        last_activity_at: agora,
      }).eq("id", existente.id as string);
      if (e) { res.erros.push({ linha: numero, motivo: e.message }); continue; }
      await sb.from("site_lead_activity").insert({
        lead_id: existente.id, kind: "note", detail: `${rotuloOrigem}: matched an open lead and filled the gaps${d.notes ? ` · ${d.notes}` : ""}`,
        actor_id: opts.actorId, meta: { via: opts.origem, channel: d.channel },
      });
      res.atualizados++;
      continue;
    }

    const quando = d.created_at ?? agora;
    const { data: novo, error: e } = await sb.from("site_leads").insert({
      email: d.email,
      phone: d.phone,
      full_name: d.full_name,
      postcode: d.postcode,
      channel: d.channel,
      service_label: d.service_label,
      price: d.price,
      status: d.status,
      notes: d.notes,
      tags: d.tags,
      source: d.source,
      created_at: quando,
      last_activity_at: quando,
      updated_at: agora,
      sequence_state: "none",
      created_by: opts.actorId,
    }).select("id").single();
    if (e || !novo) { res.erros.push({ linha: numero, motivo: e?.message ?? "insert failed" }); continue; }
    await sb.from("site_lead_activity").insert({
      lead_id: novo.id, kind: "step", detail: `${rotuloOrigem} · ${rotuloCanal(d.channel, canais)}${d.service_label ? ` · ${d.service_label}` : ""}`,
      actor_id: opts.actorId, meta: { via: opts.origem, channel: d.channel },
    });
    if (d.email) porEmail.set(d.email, { id: novo.id, ...d });
    if (d.phone) porTelefone.set(soDigitos(d.phone), { id: novo.id, ...d });
    res.criados++;
  }
  return res;
}

/** As origens do banco, em ordem. Sem a tabela (antes da 296), o padrão. */
export async function lerCanais(sb: SupabaseClient): Promise<CanalDef[]> {
  const { data, error } = await sb.from("lead_channels").select("key, label, active, sort, aliases").order("sort").order("label");
  if (error || !data?.length) return CANAIS_PADRAO;
  return data.map((c) => ({ key: c.key as string, label: c.label as string, active: Boolean(c.active), sort: Number(c.sort), aliases: (c.aliases as string[]) ?? [] }));
}
