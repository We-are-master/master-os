"use client";

/** O sino da caixa: escolhe o som de mensagem que chega. Clicar num som toca a prévia. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEM_SOM, SONS, escolherSom, ouvirEscolha, somEscolhido, SOM_PADRAO, tocarSom } from "./sons";

export function SeletorDeSom({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  const atual = useSyncExternalStore(ouvirEscolha, somEscolhido, () => SOM_PADRAO);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [aberto]);

  const escolher = (id: string) => {
    escolherSom(id);
    if (id !== SEM_SOM) tocarSom(id);
  };

  const mudo = atual === SEM_SOM;
  return (
    <div ref={raiz} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
        title="Notification sound"
        aria-label="Notification sound"
      >
        {mudo ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </button>
      {aberto ? (
        <div className="absolute right-0 top-9 z-40 w-[200px] overflow-hidden rounded-xl border border-border-light bg-card py-1 shadow-xl">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">New message sound</p>
          {[...SONS.map((s) => [s.id, s.nome] as const), [SEM_SOM, "Off"] as const].map(([id, nome]) => (
            <button
              key={id}
              type="button"
              onClick={() => escolher(id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-secondary",
                atual === id ? "font-semibold text-text-primary" : "text-text-secondary",
              )}
            >
              <span className="flex-1">{nome}</span>
              {atual === id ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
