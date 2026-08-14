/**
 * Cobertura geográfica: dá para atender este postcode?
 *
 * Duas faixas em vez de um sim/não porque elas mudam o que o agente promete. No
 * centro de Londres um job de amanhã é plausível; no cinturão o deslocamento
 * come a margem e a promessa de mesma semana começa a falhar.
 */

/**
 * Londres propriamente dita. Estas áreas estão inteiras ou quase inteiras dentro
 * do limite, então um match aqui não precisa de segunda opinião.
 */
const CORE = new Set(["E", "EC", "N", "NW", "SE", "SW", "W", "WC"]);

/**
 * O cinturão que a operação de fato atende. Cada uma destas apareceu em job real
 * de 2026 (HA4, HA5, KT7, RM16, TW9, TW10, UB1, UB8, EN1), então entram. Mas
 * entram marcadas: a viagem é real e a margem é mais fina.
 */
const FRINGE = new Set(["BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"]);

export type CoverageTier = "core" | "fringe" | "outside";

/** "SW16 2HJ" · "sw162hj" · "London W3 6XR, UK" → "SW". Null se não houver. */
export function postcodeArea(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Ancora no outward code (1-2 letras + dígito) em vez do postcode inteiro: o
  // Checkatrade manda "London W3 6XR, UK" sem disciplina de vírgula, e o cliente
  // no WhatsApp manda "sw16" sem a segunda metade.
  const m = raw.toUpperCase().match(/\b([A-Z]{1,2})\d/);
  return m ? m[1] : null;
}

export function coverageFor(postcodeOrAddress: string | null | undefined): CoverageTier {
  const area = postcodeArea(postcodeOrAddress);
  if (!area) return "outside";
  if (CORE.has(area)) return "core";
  if (FRINGE.has(area)) return "fringe";
  return "outside";
}
