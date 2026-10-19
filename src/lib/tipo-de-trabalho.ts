/**
 * Tipo de trabalho sempre do catálogo (dono, 16/10/2026): nunca inventar ("Wardrobe
 * disassembly and packing", "Cleaning", "Electrician"). General Maintenance cobre quase
 * tudo que não é pintura nem limpeza; o resto do catálogo só quando o texto bate.
 */

const PADRAO = "General Maintenance";

/** Palavra do pedido → nome do catálogo. Ordem importa: o mais específico primeiro. */
const REGRAS: Array<[RegExp, string]> = [
  [/\b(end of tenancy|end-of-tenancy|eot|move[- ]?out clean)\b/i, "End of Tenancy Clean"],
  [/\bafter[- ]?build(ers|er)?\b/i, "After Builders Clean"],
  [/\bdeep[- ]?clean/i, "Deep Clean"],
  [/\b(regular|domestic|weekly|fortnightly)\b.*\bclean|\bclean(ing|er)?\b/i, "Regular Cleaning"],
  [/\b((re)?paint(ing|er|ed|s)?|decorat(ing|or|ion))\b/i, "Painter"],
  [/\b(eicr|electrical (installation )?(condition|safety) report)\b/i, "Electrical Installation Condition Report"],
  [/\bgas safety\b|\bcp12\b/i, "Gas Safety Certificate"],
  [/\b(epc|energy performance)\b/i, "Energy Performance Certificate"],
  [/\binventory check[- ]?out\b/i, "Inventory Check-out"],
  [/\binventory\b/i, "Inventory Check"],
  // Ofício com nome no catálogo (18/10/2026: "Plasterer" saiu inventado e nenhum parceiro casou).
  [/\b(plaster(ing|er|board)?|skim(ming)?|render(ing)?|brick(work|layer|laying)?|building work|builder)\b/i, "Builder"],
  [/\b(plumb(ing|er)?)\b/i, "Plumber"],
  // Piso de madeira e rodapé são de carpinteiro (19/10/2026: "laying floorboards" caiu em General Maintenance).
  [/\b(carpent(ry|er)|joiner(y)?|floor ?boards?|laminate|parquet|wood(en)? floor(ing)?|skirting( boards?)?)\b/i, "Carpenter"],
];

/**
 * Devolve sempre um nome do catálogo: o próprio texto quando já é um (sem diferença de
 * maiúscula), senão o da regra que casar, senão General Maintenance.
 */
export function tipoDoCatalogo(texto: string | null | undefined, catalogo: readonly string[]): string {
  const t = (texto ?? "").trim();
  const exato = catalogo.find((n) => n.toLowerCase() === t.toLowerCase());
  if (exato) return exato;
  for (const [re, nome] of REGRAS) if (re.test(t) && catalogo.includes(nome)) return nome;
  return catalogo.includes(PADRAO) || catalogo.length === 0 ? PADRAO : catalogo[0];
}
