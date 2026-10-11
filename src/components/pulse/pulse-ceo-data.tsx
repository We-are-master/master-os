"use client";

/** Uma busca só de /api/pulse/ceo para todos os blocos do CEO no Pulse. */
import { createContext, useContext, useEffect, useState } from "react";
import type { PulseCeo } from "@/lib/pulse-ceo";

type Estado = { data: PulseCeo | null; loading: boolean; error: string | null };
const Ctx = createContext<Estado>({ data: null, loading: true, error: null });

export function PulseCeoProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ data: null, loading: true, error: null });
  useEffect(() => {
    let vivo = true;
    fetch("/api/pulse/ceo")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `Error ${r.status}`))))
      .then((data: PulseCeo) => { if (vivo) setEstado({ data, loading: false, error: null }); })
      .catch((e: Error) => { if (vivo) setEstado({ data: null, loading: false, error: e.message }); });
    return () => { vivo = false; };
  }, []);
  return <Ctx.Provider value={estado}>{children}</Ctx.Provider>;
}

export function usePulseCeo(): Estado {
  return useContext(Ctx);
}
