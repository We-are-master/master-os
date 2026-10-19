/**
 * Harvey: o que ele sabe e decide, editável (dono, 07/10/2026). Os blocos vêm
 * de prompt.ts (texto padrão) com as edições de harvey_wa_config por cima; os
 * preços vêm da tabela do OS (/price-list), a mesma que o site lê, só para leitura aqui.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { lerAjustes } from "@/lib/harvey-wa/ajustes";
import { lerPapeis } from "@/lib/responsavel-operacao";
import { AREAS, lerAutonomia, tetoDoAmbiente } from "@/lib/harvey/autonomia";
import { CHAVE_DAS_REGRAS, REGRAS_PADRAO } from "@/lib/harvey/regras-do-negocio";
import { lerEdicoes } from "@/lib/harvey-wa/conhecimento";
import { SECOES_CLIENTE, SECOES_PARCEIRO } from "@/lib/harvey-wa/prompt";
import { versaoAtual, type TabelaDePrecos } from "@/lib/os-documentos";
import { gerarTabelaDoSite, lerServicos, type MapaDoSite } from "@/lib/servicos-do-site";
import { AgenteHarvey, type Catalogo } from "./agente-harvey";

export const dynamic = "force-dynamic";

export default async function HarveyAgentPage() {
  const sb = createServiceClient();
  const [cliente, parceiro, { data: pausa }, catalogo, ajustes, papeis, autonomia, { data: regrasSalvas }] = await Promise.all([
    lerEdicoes(sb, "cliente").catch(() => ({})),
    lerEdicoes(sb, "parceiro").catch(() => ({})),
    sb.from("harvey_wa_config").select("valor").eq("chave", "pausado").maybeSingle(),
    // Os preços do site, gerados de Services (a mesma tabela que o site lê).
    Promise.all([versaoAtual<{ formato: number; layout: TabelaDePrecos; mapa: MapaDoSite }>(sb, "tabela_de_precos"), lerServicos(sb)])
      .then(([v, servicos]) => (v?.documento.formato === 3 ? paraCatalogo(gerarTabelaDoSite(v.documento.layout, v.documento.mapa, servicos)) : null))
      .catch(() => null),
    lerAjustes(sb),
    lerPapeis(sb),
    lerAutonomia(sb),
    sb.from("harvey_wa_config").select("valor").eq("chave", CHAVE_DAS_REGRAS).maybeSingle(),
  ]);
  const editado = (regrasSalvas?.valor as { texto?: unknown } | null)?.texto;
  const regras = typeof editado === "string" && editado.trim() ? { texto: editado, padrao: REGRAS_PADRAO, editado: true } : { texto: REGRAS_PADRAO, padrao: REGRAS_PADRAO, editado: false };
  // O teto da variável de ambiente de cada área, para a tela avisar quando ela segura o modo.
  const teto = Object.fromEntries(AREAS.map((a) => [a, tetoDoAmbiente(a)])) as Record<(typeof AREAS)[number], ReturnType<typeof tetoDoAmbiente>>;
  return (
    <AgenteHarvey
      secoes={{ cliente: SECOES_CLIENTE, parceiro: SECOES_PARCEIRO }}
      edicoes={{ cliente, parceiro }}
      pausado={pausa?.valor === true}
      catalogo={catalogo}
      ajustes={ajustes}
      papeis={papeis}
      autonomia={{ ...autonomia, teto }}
      regras={regras}
    />
  );
}

/** A tabela do OS no formato da aba Prices (só os tamanhos ligados). */
function paraCatalogo(t: TabelaDePrecos): Catalogo {
  const ativos = t.sizes.filter((s) => s.ativo !== false);
  const so = (p: Record<string, number | null> | null | undefined) => (p ? Object.fromEntries(ativos.map((s) => [s.id, p[s.id] ?? null])) : null);
  return {
    sizes: ativos.map((s) => ({ id: s.id, label: s.label })),
    cleaning: {
      kinds: t.clean.kinds.map((k) => ({ id: k.id, name: k.name, forWhat: k.detail, prices: so(k.prices) ?? {} })),
      includedBathrooms: t.clean.includedBathrooms,
      extraBathroomSteps: t.clean.extraBathroomSteps,
      extras: t.clean.extras.map((e) => ({ id: e.id, label: e.label, detail: e.detail, price: e.price, perRoom: e.unit === "room" })),
      included: ["Oven", "Cleaning products and equipment", "A photo of every room when the job is done"],
    },
    painting: {
      options: t.paint.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail, price: o.price, perRoom: o.unit === "room" })),
      materialsPack: { price: t.paint.materials.price, detail: t.paint.materials.detail },
    },
    handyman: {
      packages: t.fix.packages.map((p) => ({ id: p.id, label: p.label, detail: p.detail, price: p.price })),
      note: "Tools included, no call-out fee. Materials are not included.",
    },
    certificates: t.cert.items.map((c) => ({ id: c.id, label: c.label, detail: c.detail, valid: c.valid, price: c.price ?? null, prices: so(c.prices) })),
  };
}
