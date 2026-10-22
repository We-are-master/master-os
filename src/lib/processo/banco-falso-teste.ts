/**
 * Banco falso para os testes da etapa 3 (só testes importam). Cobre o pedaço do
 * cliente do Supabase que os módulos usam: select/insert/update com eq, neq,
 * in, is, not in, ilike, order, limit, maybeSingle. `outbound_messages` tem a
 * chave única de dedupe_key (devolve 23505 como o Postgres).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Linha = Record<string, unknown>;
type Filtro = (r: Linha) => boolean;

const UNICA: Record<string, string> = { outbound_messages: "dedupe_key", quote_partner_messages: "message_id" };

export function bancoFalso(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = {};
  for (const [t, ls] of Object.entries(inicial)) tabelas[t] = ls.map((l) => ({ ...l }));
  const leituras: string[] = [];
  const escritas: Array<{ tabela: string; tipo: "insert" | "update"; dados: Linha }> = [];

  const sb = {
    from(t: string) {
      tabelas[t] ??= [];
      const filtros: Filtro[] = [];
      let patch: Linha | null = null;
      let limite = Infinity;
      let ordem: { col: string; asc: boolean } | null = null;
      const linhas = () => {
        let ls = tabelas[t]!.filter((r) => filtros.every((f) => f(r)));
        if (ordem) {
          const { col, asc } = ordem;
          ls = [...ls].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
        }
        return ls.slice(0, limite);
      };
      const q = {
        select() { if (!patch) leituras.push(t); return q; },
        insert(r: Linha) {
          const k = UNICA[t];
          if (k && tabelas[t]!.some((x) => x[k] === r[k])) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          tabelas[t]!.push({ ...r });
          escritas.push({ tabela: t, tipo: "insert", dados: r });
          return Promise.resolve({ error: null });
        },
        update(p: Linha) { patch = p; return q; },
        eq(c: string, v: unknown) { filtros.push((r) => r[c] === v); return q; },
        neq(c: string, v: unknown) { filtros.push((r) => r[c] !== v); return q; },
        in(c: string, vs: unknown[]) { filtros.push((r) => vs.includes(r[c])); return q; },
        is(c: string, v: unknown) { filtros.push((r) => (r[c] ?? null) === v); return q; },
        not(c: string, op: string, v: unknown) {
          if (op === "in") {
            const vs = String(v).replace(/[()]/g, "").split(",");
            filtros.push((r) => !vs.includes(String(r[c])));
          } else if (op === "is") filtros.push((r) => (r[c] ?? null) !== v);
          return q;
        },
        ilike(c: string, padrao: string) {
          const miolo = padrao.replace(/%/g, "").toLowerCase();
          filtros.push((r) => String(r[c] ?? "").toLowerCase().includes(miolo));
          return q;
        },
        gte(c: string, v: unknown) { filtros.push((r) => String(r[c]) >= String(v)); return q; },
        lt(c: string, v: unknown) { filtros.push((r) => String(r[c]) < String(v)); return q; },
        order(c: string, o?: { ascending?: boolean }) { ordem = { col: c, asc: o?.ascending !== false }; return q; },
        limit(n: number) { limite = n; return q; },
        maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
        single() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
        then(ok: (v: { data: Linha[]; error: null }) => unknown, erro?: (e: unknown) => unknown) {
          const ls = linhas();
          if (patch) for (const l of ls) { Object.assign(l, patch); escritas.push({ tabela: t, tipo: "update", dados: { ...patch } }); }
          return Promise.resolve({ data: ls.map((l) => ({ ...l })), error: null }).then(ok, erro);
        },
      };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, tabelas, leituras, escritas };
}
