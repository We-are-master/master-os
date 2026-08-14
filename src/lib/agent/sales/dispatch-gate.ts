/**
 * A decisão de despacho: este lead vai para o Mike, e com que instrução?
 *
 * Compõe três perguntas que são deliberadamente separadas, porque mudam por
 * motivos diferentes e em ritmos diferentes:
 *
 *   alcançável?   tem telefone utilizável            (dado)
 *   coberto?      o postcode é área nossa            (geografia, muda devagar)
 *   vendável?     o serviço existe e tem preço       (catálogo, muda toda semana)
 *
 * Separar isso é o que faz a métrica servir: "lead ruim", "lead fora de área" e
 * "lead que não conseguimos alcançar" pedem ações completamente diferentes, e
 * somar os três num contador só esconde os três.
 */

import type { CatalogService } from "@/types/database";
import { coverageFor, postcodeArea, type CoverageTier } from "./coverage";
import { customerLabel, matchService, type ServiceHandling } from "./service-match";
import type { LeadBrief } from "./lead-brief";

export type SkipKind =
  /** Sem telefone: não há WhatsApp, por melhor que seja o lead. */
  | "unreachable"
  /** Fora de Londres e do cinturão. Não volta. */
  | "outside_area"
  /** Jardim, ou serviço que não vendemos. Não volta. */
  | "not_our_work"
  /** Hidráulica, gás, caldeira. É trabalho da casa, mas de outro time. */
  | "other_team";

export type DispatchDecision =
  | {
      dispatch: true;
      service: CatalogService;
      /** `quote_and_close` cota na conversa; `quote_only` promete orçamento. */
      handling: "quote_and_close" | "quote_only";
      label: string;
      coverage: Exclude<CoverageTier, "outside">;
      /** Texto do postcode que vai no template. Nunca vazio quando `dispatch`. */
      postcodeText: string;
    }
  | { dispatch: false; reason: string; skipKind: SkipKind };

export function decideDispatch(brief: LeadBrief, catalog: CatalogService[]): DispatchDecision {
  // Telefone primeiro: sem ele nada mais importa, e a causa é de qualidade de
  // dado, não de qualidade de lead.
  if (!brief.phone || brief.phone.replace(/\D/g, "").length < 10) {
    return { dispatch: false, reason: "sem telefone utilizável", skipKind: "unreachable" };
  }

  // A Meta recusa o envio se qualquer variável do template chegar vazia, e a
  // checagem de cobertura aceita `location` como alternativa ao `postcode`.
  // Sem isto, esses leads viram erro de envio no meio do lote em vez de descarte
  // limpo aqui.
  const postcodeText = (brief.postcode ?? "").trim() || (brief.location ?? "").trim();
  const coverage = coverageFor(postcodeText);
  if (coverage === "outside" || !postcodeText) {
    const area = postcodeArea(postcodeText);
    return {
      dispatch: false,
      reason: area ? `área ${area} fora de Londres` : "sem postcode utilizável",
      skipKind: area ? "outside_area" : "unreachable",
    };
  }

  // Separados, não concatenados: a descrição do cliente decide, e a categoria do
  // Checkatrade só entra quando ele não liberou a mensagem.
  const match: ServiceHandling = matchService(brief.enquiry, catalog, brief.rawCategory);

  if (match.kind === "refuse") {
    return { dispatch: false, reason: match.reason, skipKind: "not_our_work" };
  }
  if (match.kind === "other_team") {
    return { dispatch: false, reason: match.reason, skipKind: "other_team" };
  }

  return {
    dispatch: true,
    service: match.service,
    handling: match.kind,
    label: customerLabel(match.service),
    coverage,
    postcodeText,
  };
}
