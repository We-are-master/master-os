/**
 * Casa o pedido do cliente com uma linha do `service_catalog`.
 *
 * Este módulo substitui a lista de trades hardcoded da primeira versão. O motivo:
 * o catálogo é curado à mão e muda (presets de General Maintenance, quote-only por
 * zeragem, certificados). Se o agente lê de lá, mudar preço vira mudar catálogo,
 * não mudar código.
 *
 * A convenção de preço, definida com o dono em 2026-08-11:
 *
 *   preço > 0   → o agente cota e fecha
 *   preço == 0  → quote-only: qualifica, promete orçamento, não diz número
 *
 * Nada aqui faz I/O. O chamador busca o catálogo e passa.
 */

import type { CatalogService } from "@/types/database";

/** O que dá para fazer com um serviço numa conversa. */
export type ServiceHandling =
  | { kind: "quote_and_close"; service: CatalogService }
  | { kind: "quote_only"; service: CatalogService }
  | { kind: "other_team"; reason: string }
  | { kind: "refuse"; reason: string };

/**
 * Jardinagem de verdade: atividade que nenhum handyman reivindica. Recusa sempre,
 * porque a regra de negócio do RPA exclui jardim desde 2026-07-28.
 */
const GARDEN_PURE = /landscap|\blawn\b|\bmow(ing)?\b|hedge|turf|weeding|cutting (the )?grass|grass cutting/i;

/**
 * Objeto que fica no jardim. Diferente do de cima: o objeto não define o trabalho.
 * "garden shed" é jardim, mas "fix two brackets to a garden fence post" é um
 * furo na parede que por acaso é lá fora, e "cat flap in a garden door" é
 * carpintaria. Só veta quando nada mais casa.
 *
 * `patio` precisa do lookahead: "patio doors" é serralheria, não paisagismo. Um
 * job de persiana foi descartado por isso em 2026-08-03.
 */
const GARDEN_OBJECT = /garden|fence|patio(?!\s*door)|decking|\bshed\b/i;

/**
 * Hidráulica e gás. Também só veta quando nada mais casa: metade dos leads do
 * Checkatrade é uma lista de 8 tarefas em que uma encosta num chuveiro, e vetar
 * a lista inteira por causa dela descartou 76 leads pagos na varredura de
 * 2026-08-11. Job que é *só* isso continua saindo como handoff.
 */
const OTHER_TEAM =
  /plumb|\bboiler\b|\bgas\b|\btap\b|toilet|\bleak|basin|radiator|\bshower\b|waste pipe|unblock/i;

/**
 * Padrões de detecção por linha do catálogo, do mais específico para o mais
 * genérico. A chave case com `service_catalog.name` sem diferenciar caixa.
 *
 * Ordem importa: "build a stud wall then paint it" é Builder, não Painter, e
 * "fit skirting and paint it" é Carpenter. A trade maior ganha o empate.
 */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["(EICR) Electrical Installation Condition Report", /\beicr\b|electrical installation condition|electrical safety (check|certificate|report)/i],
  ["(FRA) Fire Risk Assessment", /fire risk assessment|\bfra\b/i],
  ["(FAC) Fire Alarm Certificate", /fire alarm/i],
  ["Emergency Lighting Certificate", /emergency light/i],
  ["(FES) Fire Extinguisher Service", /fire extinguisher/i],
  ["(PAT) Portable Appliance Testing", /\bpat\b|portable appliance/i],
  ["(EOT) End of Tenancy", /end of tenancy|\beot\b|move[- ]out clean/i],
  ["(AB) After Builders Cleaning", /after builder|post[- ]construction clean|builders clean/i],
  ["(DC) Deep Cleaning", /deep clean|spring clean/i],
  // Certificados de gás vêm antes de qualquer coisa que o veto de gás alcance.
  // São linhas ativas e precificadas do catálogo, e o dono tem 3 parceiros com
  // capacidade ociosa de ~10/dia.
  ["(GSC) Gas Safety Certificate", /gas safety cert|\bgsc\b|landlord gas/i],
  ["(CP12)Gas Safety Check", /\bcp12\b|gas safety check/i],
  ["(EPC) Energy Performance Certificate", /\bepc\b|energy performance/i],
  ["Builder", /\bbuild(er|ing)?\b|extension|loft conversion|stud wall|brickwork|blockwork|render|screed|structural|knock through|\brsj\b|steel beam|damp proof|underpin/i],
  ["Carpenter", /carpen|joiner|\bskirting\b|architrave|wardrobe|shelv|\bshelf\b|\bdoor\s*(hang|fit|frame)|kitchen fit|worktop|flooring|laminate|floorboard|staircase|\bbespoke\b|cabinet|cupboard|alcove|\bcat\s*flap\b/i],
  ["Painter", /\b(?:re)?paint(er|ing|ed)?\b|decorat|\bwallpaper|papering|emulsion|gloss|undercoat|redecorat/i],
  // `fit` precisa de `fitted`: "want a wood table top fitted" não casava com
  // nada e virava recusa. `install` faltava por inteiro, e é a palavra mais
  // comum nesses pedidos.
  ["General Maintenance", /handy\s*(man|person)|\bodd\s*jobs?\b|general maintenance|\bgeneral repairs?\b|\bmount(ing|ed)?\b|\btv\s*mount|wall hanging|\bassembl|flat[- ]?pack|curtain (rail|rod|pole)|blind(s)? (fit|install)|\bsilicone\b|sealant|\brepair\b|\bfix(ing|ed)?\b|\bhang(ing)?\b|\bfit(ting|ted)?\b|\binstall(ing|ation|ed)?\b/i],
];

/** Vende quando tem qualquer preço; zerado significa "orçar depois". */
export function isQuoteOnly(s: CatalogService): boolean {
  return Number(s.fixed_price ?? 0) === 0 && Number(s.hourly_rate ?? 0) === 0;
}

export function activeCatalog(rows: CatalogService[]): CatalogService[] {
  return rows.filter((r) => r.is_active && !r.deleted_at);
}

function byName(rows: CatalogService[], name: string): CatalogService | null {
  const want = name.trim().toLowerCase();
  return activeCatalog(rows).find((r) => (r.name ?? "").trim().toLowerCase() === want) ?? null;
}

/**
 * Decide o que fazer com um pedido. `text` é o que o cliente escreveu, mais o
 * que o Checkatrade tagueou como categoria quando a mensagem não foi liberada.
 */
/**
 * Decide o que fazer com um pedido.
 *
 * `enquiry` é o que o cliente escreveu; `category` é o que o Checkatrade
 * tagueou. São argumentos separados porque têm pesos diferentes: a etiqueta do
 * marketplace nunca deve sobrepor a descrição do cliente. Concatenar os dois
 * fazia "Leaking tap in the kitchen" tagueado como `Handyman` ser vendido como
 * handyman, quando é hidráulica pura. A categoria só entra quando o Checkatrade
 * não liberou a mensagem.
 */
export function matchService(
  enquiry: string | null | undefined,
  catalog: CatalogService[],
  category?: string | null,
): ServiceHandling {
  const primary = (enquiry ?? "").trim();
  const fallback = (category ?? "").trim();
  if (!primary && !fallback) return { kind: "refuse", reason: "sem texto para classificar" };

  const classify = (t: string, exhaustive: boolean): ServiceHandling | null => {
    // Jardinagem de verdade é a única recusa que não olha o resto.
    if (GARDEN_PURE.test(t)) return { kind: "refuse", reason: "jardim: jardinagem, fora do escopo" };

    // O positivo vem antes do veto de propósito. Um lead do Checkatrade costuma
    // ser uma lista de tarefas, e a pergunta certa é "tem trabalho nosso aqui?",
    // não "existe alguma palavra proibida em algum lugar?".
    const hit = PATTERNS.find(([, pattern]) => pattern.test(t));
    if (hit) {
      const [name] = hit;
      const service = byName(catalog, name);
      // Padrão casou mas a linha sumiu do catálogo: tratar como handoff é mais
      // seguro que recusar um lead bom por causa de uma renomeação.
      if (!service) return { kind: "other_team", reason: `"${name}" não está ativo no catálogo` };
      return isQuoteOnly(service)
        ? { kind: "quote_only", service }
        : { kind: "quote_and_close", service };
    }

    // Nada nosso no texto. Agora sim o veto decide entre handoff e recusa.
    if (OTHER_TEAM.test(t)) return { kind: "other_team", reason: "hidráulica ou gás, outro time" };
    if (GARDEN_OBJECT.test(t)) return { kind: "refuse", reason: "jardim: nada nosso no pedido" };
    // Texto mudo: deixa a categoria tentar antes de recusar.
    return exhaustive ? { kind: "refuse", reason: "não é um serviço que vendemos" } : null;
  };

  if (primary) {
    const verdict = classify(primary, !fallback);
    if (verdict) return verdict;
  }
  return classify(fallback, true)!;
}

/**
 * Valores que o campo `trade` do respond.io aceita hoje.
 *
 * O campo é do tipo `list` e **não é editável pela API** (PATCH devolve 403,
 * PUT devolve 404): mexer nele é no painel. Por isso a lista vive aqui, e
 * escrever um valor fora dela faz a API recusar o contato inteiro.
 *
 * `cleaning` e `certificate` ainda não estão no painel. Enquanto não estiverem,
 * `tradeSlug` devolve null para eles e o dispatcher omite o campo em vez de
 * derrubar o lead. Na base atual isso são 2 leads de 500.
 */
export const TRADE_SLUGS_ACEITOS = ["handyman", "carpenter", "painter", "builder"] as const;

export type TradeSlug = "handyman" | "carpenter" | "painter" | "builder" | "cleaning" | "certificate";

/** Traduz a linha do catálogo para o enum do respond.io. Null = não mapeia. */
export function tradeSlug(service: CatalogService): TradeSlug | null {
  const n = (service.name ?? "").trim();
  if (/^general maintenance/i.test(n)) return "handyman";
  if (/^carpenter/i.test(n)) return "carpenter";
  if (/^painter/i.test(n)) return "painter";
  if (/^builder/i.test(n)) return "builder";
  if (/clean|end of tenancy/i.test(n)) return "cleaning";
  if (/certificate|\breport\b|assessment|testing|service$/i.test(n)) return "certificate";
  return null;
}

/**
 * Caminho inverso: do slug do respond.io de volta para a linha do catálogo.
 *
 * O poller precisa disto porque o `trade` que vale na hora de criar o job é o
 * que está no respond.io, não o que o gate adivinhou no despacho: o Mike
 * corrige a trade durante a conversa quando o cliente descreve melhor o job.
 */
export function servicePorTradeSlug(slug: string | null | undefined, catalog: CatalogService[]): CatalogService | null {
  if (!slug) return null;
  const alvo = slug.trim().toLowerCase();
  return activeCatalog(catalog).find((s) => tradeSlug(s) === alvo) ?? null;
}

/** O slug só serve se o painel já o conhece. Senão o contato inteiro é recusado. */
export function tradeSlugParaRespondIo(service: CatalogService): string | null {
  const slug = tradeSlug(service);
  return slug && (TRADE_SLUGS_ACEITOS as readonly string[]).includes(slug) ? slug : null;
}

/** Rótulo curto para a mensagem ao cliente. Não é o nome interno. */
export function customerLabel(service: CatalogService): string {
  const name = service.name ?? "";
  const bare = name.replace(/^\([A-Z0-9]+\)\s*/, "").trim();
  if (/^general maintenance$/i.test(bare)) return "handyman work";
  if (/^carpenter$/i.test(bare)) return "carpentry";
  if (/^painter$/i.test(bare)) return "painting and decorating";
  if (/^builder$/i.test(bare)) return "building work";
  return bare.toLowerCase();
}
