/**
 * Supabase de mentira, em memória, só com o que os envios ao cliente usam:
 * select/eq/is/in/gte/not/ilike/order/limit/maybeSingle/single/insert e update com `.select()`.
 * Update respeita os filtros, então a trava atômica (`.is(col, null)`) se
 * comporta como no banco: a segunda chamada não reivindica nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filtro = (r: Row) => boolean;

export function fakeSupabase(tabelas: Record<string, Row[]>) {
  const escritas: { tabela: string; patch: Row }[] = [];

  function consulta(tabela: string) {
    const filtros: Filtro[] = [];
    let patch: Row | null = null;
    let comSelect = false;
    let limite = Infinity;
    const linhas = () => (tabelas[tabela] ?? []).filter((r) => filtros.every((f) => f(r)));
    const executar = () => {
      if (patch) {
        const alvo = linhas();
        for (const r of alvo) Object.assign(r, patch);
        escritas.push({ tabela, patch });
        return { data: comSelect ? alvo.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: linhas().slice(0, limite), error: null };
    };
    const b = {
      select() { if (patch) comSelect = true; return b; },
      update(p: Row) { patch = p; return b; },
      eq(c: string, v: unknown) { filtros.push((r) => r[c] === v); return b; },
      is(c: string, v: unknown) { filtros.push((r) => (r[c] ?? null) === v); return b; },
      in(c: string, vs: unknown[]) { filtros.push((r) => vs.includes(r[c])); return b; },
      gte(c: string, v: string) { filtros.push((r) => r[c] != null && String(r[c]) >= v); return b; },
      not(c: string, _op: string, v: unknown) { filtros.push((r) => (r[c] ?? null) !== v); return b; },
      ilike(c: string, padrao: string) {
        const re = new RegExp(`^${padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
        filtros.push((r) => re.test(String(r[c] ?? "")));
        return b;
      },
      order() { return b; },
      limit(n: number) { limite = n; return b; },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      single: async () => {
        const r = executar() as { data: Row[] | null };
        return { data: (r.data ?? [])[0] ?? null, error: null };
      },
      insert(linha: Row) {
        (tabelas[tabela] ??= []).push({ ...linha });
        escritas.push({ tabela, patch: linha });
        return Promise.resolve({ error: null });
      },
      then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
        return Promise.resolve(executar()).then(ok, erro);
      },
    };
    return b;
  }

  return { client: { from: consulta } as unknown as SupabaseClient, escritas, tabelas };
}
