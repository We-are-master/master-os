/**
 * O site lê os preços de SERVICES (dono, 07/10/2026: "deixa apenas Services com
 * preço de cobrança e preço pago"). Services (service_catalog) é a fonte única:
 * cada variação (pricing_presets) e cada extra (pricing_addons) tem o preço
 * cobrado (fixed_price) e o pago ao parceiro (partner_cost).
 *
 * O site mostra só o que já mostrava. O MAPA DO SITE diz qual variação ou
 * extra de Services é cada item do site, pelo id (renomear em Services não
 * quebra). Os textos, tamanhos e ids do site ficam no LAYOUT (o formato 1 do
 * pricing.js). gerarTabelaDoSite junta os dois: textos do layout + preços de
 * Services, e o pagamento do parceiro junto (o partner-pay.js do site vira
 * reserva). Item de Services fora do mapa não aparece no site.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TabelaDePrecos } from "@/lib/os-documentos";

type Linha = { id: string; label: string; fixed_price?: number | null; hourly_rate?: number | null; partner_cost?: number | null };
type Servico = { id: string; name: string; pricing_presets: Linha[] | null; pricing_addons: Linha[] | null; partner_cost?: number | null };

/** Um item do site apontando para uma linha de Services. */
export type Ref = { servico: string; tipo: "preset" | "addon"; id: string };

export type MapaDoSite = {
  clean: Record<string, { servico: string; tamanhos: Record<string, Ref | null>; banheiros: Ref[]; extras: Record<string, Ref> }>;
  paint: { opcoes: Record<string, Ref>; material: Ref };
  fix: { pacotes: Record<string, Ref>; hora: Ref | null };
  cert: Record<string, { fixo?: Ref; tamanhos?: Record<string, Ref | null> }>;
};

export type PagamentoDoParceiro = {
  clean: { bySize: Record<string, Record<string, number | null>>; step: number[]; extras: Record<string, Record<string, number>> };
  fix: { hour: number | null; half: number | null; day: number | null };
  paint: { touchup: number | null; rooms: number | null; materials: number | null };
  cert: Record<string, number | Record<string, number | null> | null>;
};

export type TabelaDoSite = TabelaDePrecos & { partnerPay: PagamentoDoParceiro; fonte: "services" };

// ── montar o mapa (uma vez, pelos nomes; depois vale o id) ──────────────────

const SERVICO_DO_TIPO: Record<string, string> = { eot: "End of Tenancy Clean", deep: "Deep Clean", after: "After Builders Clean" };
const EXTRA_DO_SITE: Record<string, RegExp> = { carpet: /^carpet steam/i, fridge: /^fridge/i, windows: /^windows outside/i, balcony: /^balcony/i };
const TAMANHO_DO_PRESET = (label: string): string | null => {
  const m = label.match(/^(studio|(\d+)\s*bed)\s*·\s*1 bath$/i);
  return m ? (m[2] ?? "studio") : null;
};

function achar(servicos: Servico[], nome: string): Servico {
  const s = servicos.find((x) => x.name.trim().toLowerCase() === nome.toLowerCase());
  if (!s) throw new Error(`Service "${nome}" not found in Services`);
  return s;
}
function linha(s: Servico, tipo: "preset" | "addon", re: RegExp): Ref {
  const l = (tipo === "preset" ? s.pricing_presets : s.pricing_addons)?.find((x) => re.test(x.label));
  if (!l) throw new Error(`${s.name}: no ${tipo} matching ${re}`);
  return { servico: s.id, tipo, id: l.id };
}

/**
 * O mapa a partir do layout (o que o site vende hoje) e de Services. Só pega o
 * que o site já mostra: tamanho que no site é "sob consulta" fica null mesmo
 * que Services tenha preço (EICR 5+ quartos).
 */
export function montarMapa(layout: TabelaDePrecos, servicos: Servico[]): MapaDoSite {
  const clean: MapaDoSite["clean"] = {};
  for (const k of layout.clean.kinds) {
    const s = achar(servicos, SERVICO_DO_TIPO[k.id] ?? k.osTitle);
    const tamanhos: Record<string, Ref | null> = {};
    for (const [tam, preco] of Object.entries(k.prices)) {
      const p = preco == null ? null : s.pricing_presets?.find((x) => TAMANHO_DO_PRESET(x.label) === tam);
      tamanhos[tam] = p ? { servico: s.id, tipo: "preset", id: p.id } : null;
    }
    const banheiros = ["2nd", "3rd", "4th"].slice(0, layout.clean.extraBathroomSteps.length).map((o) => linha(s, "addon", new RegExp(`^extra bathroom, ${o}`, "i")));
    const extras: Record<string, Ref> = {};
    for (const e of layout.clean.extras) extras[e.id] = linha(s, "addon", EXTRA_DO_SITE[e.id] ?? new RegExp(`^${e.label}`, "i"));
    clean[k.id] = { servico: s.id, tamanhos, banheiros, extras };
  }
  const pintor = achar(servicos, layout.paint.osTitle || "Painter");
  const reparo = achar(servicos, layout.fix.osTitle || "General Maintenance");
  const cert: MapaDoSite["cert"] = {};
  for (const c of layout.cert.items) {
    const s = achar(servicos, c.id === "eicr" ? "Electrical Installation Condition Report" : c.osTitle);
    if (c.prices) {
      const tamanhos: Record<string, Ref | null> = {};
      for (const [tam, preco] of Object.entries(c.prices)) {
        const re = tam === "studio" ? /\bstudio\b/i : new RegExp(`\\b${tam}(\\+|-\\d+)?\\s*bed\\b`, "i");
        const p = preco == null ? null : s.pricing_presets?.find((x) => re.test(x.label));
        tamanhos[tam] = p ? { servico: s.id, tipo: "preset", id: p.id } : null;
      }
      cert[c.id] = { tamanhos };
    } else {
      cert[c.id] = { fixo: linha(s, "preset", c.id === "gas" ? /1 appliance/i : /./) };
    }
  }
  return {
    clean,
    paint: {
      opcoes: Object.fromEntries(layout.paint.options.map((o) => [o.id, linha(pintor, "preset", o.id === "touchup" ? /^touch-ups/i : /^a room/i)])),
      material: linha(pintor, "addon", /materials/i),
    },
    fix: {
      pacotes: Object.fromEntries(layout.fix.packages.map((p) => [p.id, linha(reparo, "preset", p.id === "half" ? /^half day/i : /^full day/i)])),
      hora: (() => {
        try {
          return linha(reparo, "preset", /^hourly/i);
        } catch {
          return null;
        }
      })(),
    },
    cert,
  };
}

// ── gerar a tabela do site (layout + preços de Services) ────────────────────

export async function lerServicos(sb: SupabaseClient): Promise<Servico[]> {
  const { data, error } = await sb.from("service_catalog").select("id, name, partner_cost, pricing_presets, pricing_addons").is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as Servico[];
}

export function gerarTabelaDoSite(layout: TabelaDePrecos, mapa: MapaDoSite, servicos: Servico[]): TabelaDoSite {
  const porId = new Map(servicos.map((s) => [s.id, s]));
  const pegar = (r: Ref): Linha => {
    const s = porId.get(r.servico);
    const l = (r.tipo === "preset" ? s?.pricing_presets : s?.pricing_addons)?.find((x) => x.id === r.id);
    if (!l) throw new Error(`Services item missing (${r.tipo} ${r.id} of ${s?.name ?? r.servico}): it was deleted or the service is off`);
    return l;
  };
  const cobrado = (r: Ref) => {
    const l = pegar(r);
    const v = l.fixed_price ?? l.hourly_rate ?? null;
    if (v == null || !(v > 0)) throw new Error(`${l.label}: no customer price in Services`);
    return v;
  };
  const pago = (r: Ref | null) => (r ? (pegar(r).partner_cost ?? null) : null);

  const t: TabelaDePrecos = structuredClone(layout);
  const pp: PagamentoDoParceiro = { clean: { bySize: {}, step: [], extras: {} }, fix: { hour: null, half: null, day: null }, paint: { touchup: null, rooms: null, materials: null }, cert: {} };

  for (const k of t.clean.kinds) {
    const m = mapa.clean[k.id];
    if (!m) throw new Error(`Cleaning type ${k.id} has no Services mapping`);
    pp.clean.bySize[k.id] = {};
    for (const tam of Object.keys(k.prices)) {
      const r = m.tamanhos[tam];
      k.prices[tam] = r ? cobrado(r) : null;
      pp.clean.bySize[k.id][tam] = r ? pago(r) : null;
    }
    pp.clean.extras[k.id] = {};
    for (const [id, r] of Object.entries(m.extras)) pp.clean.extras[k.id][id] = pago(r) ?? 0;
  }
  // Banheiro extra e extras do site: os do tipo padrão (o site tem um conjunto só hoje).
  const padrao = mapa.clean[t.defaultCleanKind] ?? Object.values(mapa.clean)[0];
  t.clean.extraBathroomSteps = padrao.banheiros.map(cobrado);
  pp.clean.step = padrao.banheiros.map((r) => pago(r) ?? 0);
  for (const e of t.clean.extras) e.price = cobrado(padrao.extras[e.id]);

  for (const o of t.paint.options) o.price = cobrado(mapa.paint.opcoes[o.id]);
  t.paint.materials.price = cobrado(mapa.paint.material);
  pp.paint = { touchup: pago(mapa.paint.opcoes.touchup ?? null), rooms: pago(mapa.paint.opcoes.rooms ?? null), materials: pago(mapa.paint.material) };

  for (const p of t.fix.packages) p.price = cobrado(mapa.fix.pacotes[p.id]);
  pp.fix = { hour: pago(mapa.fix.hora), half: pago(mapa.fix.pacotes.half ?? null), day: pago(mapa.fix.pacotes.day ?? null) };

  for (const c of t.cert.items) {
    const m = mapa.cert[c.id];
    if (!m) throw new Error(`Certificate ${c.id} has no Services mapping`);
    if (c.prices && m.tamanhos) {
      const pagos: Record<string, number | null> = {};
      for (const tam of Object.keys(c.prices)) {
        const r = m.tamanhos[tam];
        c.prices[tam] = r ? cobrado(r) : null;
        pagos[tam] = r ? pago(r) : null;
      }
      pp.cert[c.id] = pagos;
    } else if (m.fixo) {
      c.price = cobrado(m.fixo);
      pp.cert[c.id] = pago(m.fixo);
    }
  }
  return { ...t, partnerPay: pp, fonte: "services" };
}

// ── o que Services tem e o site não mostra ──────────────────────────────────

export function foraDoSite(mapa: MapaDoSite, servicos: Servico[]): Array<{ servico: string; itens: string[] }> {
  const usados = new Set<string>();
  const marcar = (r: Ref | null | undefined) => r && usados.add(`${r.tipo}:${r.id}`);
  for (const k of Object.values(mapa.clean)) {
    Object.values(k.tamanhos).forEach(marcar);
    k.banheiros.forEach(marcar);
    Object.values(k.extras).forEach(marcar);
  }
  Object.values(mapa.paint.opcoes).forEach(marcar);
  marcar(mapa.paint.material);
  Object.values(mapa.fix.pacotes).forEach(marcar);
  for (const c of Object.values(mapa.cert)) {
    marcar(c.fixo);
    Object.values(c.tamanhos ?? {}).forEach(marcar);
  }
  const fmt = (l: Linha) => `${l.label} £${l.fixed_price ?? l.hourly_rate ?? "?"}${l.hourly_rate && !l.fixed_price ? "/h" : ""} (partner £${l.partner_cost ?? "?"})`;
  return servicos
    .map((s) => ({
      servico: s.name,
      itens: [
        ...(s.pricing_presets ?? []).filter((l) => !usados.has(`preset:${l.id}`)).map(fmt),
        ...(s.pricing_addons ?? []).filter((l) => !usados.has(`addon:${l.id}`)).map((l) => `extra: ${fmt(l)}`),
      ],
    }))
    .filter((x) => x.itens.length);
}
