"use client";

import { useState } from "react";
import { getSupabase } from "@/services/base";

/**
 * Tela de quem fez login mas não é da equipe (15/10/2026): parceiro ou cliente
 * do portal. Não carrega nada do OS; só oferece sair.
 */
export function SemAcessoAoOs() {
  const [saindo, setSaindo] = useState(false);
  const sair = async () => {
    setSaindo(true);
    await getSupabase().auth.signOut();
    window.location.href = "/login";
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="m-0 text-[16px] font-semibold text-text-primary">This login has no access to Fixfy OS</h1>
        <p className="mt-2 text-[13px] text-text-secondary">
          Fixfy OS is for the Fixfy team. Partners use partners.getfixfy.com.
        </p>
        <button
          type="button"
          onClick={() => void sair()}
          disabled={saindo}
          className="mt-5 h-9 rounded-lg bg-[#020040] px-4 text-[13px] font-medium text-white disabled:opacity-60"
        >
          {saindo ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
