import type { NormalizedReport } from "@/lib/job-report-v2";

/**
 * Ordem de quem anda pela casa: o jsonb do Postgres reordena as chaves do mapa de
 * cômodos (por tamanho), então a ordem gravada não sobrevive. Desconhecido vai ao fim.
 */
const ORDEM = [/entr|hall|door/i, /kitchen/i, /living|dining|lounge|reception/i, /bath|shower|toilet|wc|ensuite/i, /bed/i, /stair|landing/i, /garden|outside|exterior|front|back/i];
const posicao = (rotulo: string) => {
  const i = ORDEM.findIndex((r) => r.test(rotulo));
  return i === -1 ? ORDEM.length : i;
};

/** Agrupa as fotos por cômodo (mapa do report) ou pelo rótulo; sem nenhum dos dois, "Photos". */
export function gruposDoReport(report: NormalizedReport | null, fora: Set<string> = new Set()): Array<{ rotulo: string; urls: string[] }> {
  if (!report) return [];
  const grupos = new Map<string, string[]>();
  for (const p of report.photosFlat) {
    if (fora.has(p.url)) continue;
    const rotulo = p.label?.trim() || "Photos";
    grupos.set(rotulo, [...(grupos.get(rotulo) ?? []), p.url]);
  }
  return [...grupos].map(([rotulo, urls]) => ({ rotulo, urls })).sort((a, b) => posicao(a.rotulo) - posicao(b.rotulo));
}

