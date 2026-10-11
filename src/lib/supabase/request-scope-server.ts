import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setServerSupabaseResolver } from "./request-scope";

const storage = new AsyncLocalStorage<SupabaseClient>();
setServerSupabaseResolver(() => storage.getStore());

/** Roda `fn` com `getSupabase()` devolvendo o cliente deste pedido (sessão e RLS do usuário). */
export function runWithSupabase<T>(client: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return storage.run(client, fn);
}
