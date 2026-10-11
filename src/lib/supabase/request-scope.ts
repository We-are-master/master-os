import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase do PEDIDO, no servidor.
 *
 * As libs de leitura usam `getSupabase()`, que é o cliente do navegador. Para rodar a
 * mesma leitura dentro de uma rota (uma ida e volta em vez de dezenas), a rota registra
 * aqui quem devolve o cliente daquele pedido. Este arquivo não importa nada de Node, então
 * pode entrar no bundle do navegador sem peso: lá o resolvedor nunca é registrado.
 */
type Resolver = () => SupabaseClient | null | undefined;

let resolver: Resolver | null = null;

export function setServerSupabaseResolver(fn: Resolver): void {
  resolver = fn;
}

export function resolveServerSupabase(): SupabaseClient | null {
  if (typeof window !== "undefined" || !resolver) return null;
  return resolver() ?? null;
}
