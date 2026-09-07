/**
 * Catalogue of cities for postcode-based partner coverage.
 * Add new cities here — UI picks city then outward districts within it.
 */

export type CoverageCity = {
  id: string;
  label: string;
  outwardCodes: readonly string[];
};

function range(prefix: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}`);
  return out;
}

/** Greater London outward districts (representative set for matching & office picker). */
const LONDON_OUTWARD: string[] = [
  ...range("E", 1, 20),
  ...range("EC", 1, 4),
  ...range("N", 1, 22),
  ...range("NW", 1, 11),
  ...range("SE", 1, 28),
  ...range("SW", 1, 20),
  ...range("W", 1, 14),
  ...range("WC", 1, 2),
  ...range("BR", 1, 8),
  ...range("CR", 0, 9),
  ...range("DA", 1, 18),
  ...range("EN", 1, 5),
  ...range("HA", 0, 9),
  ...range("IG", 1, 11),
  ...range("KT", 1, 24),
  ...range("RM", 1, 20),
  ...range("SM", 1, 7),
  ...range("TW", 1, 20),
  ...range("UB", 1, 11),
  ...range("WD", 1, 25),
];

export const COVERAGE_CITY_LONDON_ID = "london";

export const COVERAGE_CITIES: readonly CoverageCity[] = [
  {
    id: COVERAGE_CITY_LONDON_ID,
    label: "London",
    outwardCodes: [...new Set(LONDON_OUTWARD.map((c) => c.toUpperCase()))].sort((a, b) =>
      a.localeCompare(b),
    ),
  },
] as const;

export function coverageCityById(id: string): CoverageCity | undefined {
  return COVERAGE_CITIES.find((c) => c.id === id);
}

export function defaultLondonIncludedPostcodes(): string[] {
  return [...(coverageCityById(COVERAGE_CITY_LONDON_ID)?.outwardCodes ?? [])];
}

/**
 * O outward code (a metade da frente do postcode: `EC1V`, `E17`, `SW19`).
 *
 * ─── Por que não é mais "corta os três últimos" ──────────────────────────
 *
 * Era `s.length > 3 ? s.slice(0, s.length - 3) : s`, que assume que TODA
 * entrada é um postcode completo. A lista de cobertura do parceiro não é: ela
 * guarda outward code já pronto. Então `EC1V` (4 caracteres) virava `E`, e
 * `DA10` virava `D`.
 *
 * O estrago era silencioso e grande. Medido em 07/09/2026: três parceiros
 * ativos tinham 98 códigos de quatro caracteres cada, e todos colapsavam em
 * letras soltas — D, I, K, N, R, S. Como a comparação é por prefixo, `D`
 * casava com Derby, Durham, Doncaster e Dorset. A cobertura que eles
 * configuraram não valia nada, e os mesmos cinco parceiros apareciam em toda
 * quote independentemente da área.
 *
 * Agora a forma decide, não o comprimento: se o que veio termina em inward
 * code (dígito + duas letras), tira o inward; senão já é outward e fica como
 * está. `EC1V 2NX` → `EC1V`; `EC1V` → `EC1V`; `E17` → `E17`.
 */
const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const POSTCODE_COMPLETO = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

export function normalizeOutwardCode(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return "";
  const completo = POSTCODE_COMPLETO.exec(s);
  if (completo) return completo[1]!;
  if (OUTWARD.test(s)) return s;
  // Lixo que não é nem outward nem postcode não vira cobertura nenhuma: um
  // código inválido virando prefixo curto é exatamente o defeito de cima.
  return "";
}
