"use client";

/**
 * O teclado de emoji do composer, o mesmo do VOS: abas por categoria, busca e a
 * aba "Most used" que aprende com quem digita (guardada no navegador).
 */

import { useState } from "react";
import { Search, X } from "lucide-react";
import { EMOJI_CATS, buscarEmojis } from "./emojis";
import { emojisUsados, registrarUsoDeEmoji } from "./emoji-recentes";

export function TecladoDeEmoji({ onPick }: { onPick: (emoji: string) => void }) {
  const [cat, setCat] = useState<string>(EMOJI_CATS[0]!.key);
  const [busca, setBusca] = useState("");
  // O teclado só nasce depois de um clique, então ler o localStorage na montagem não quebra a hidratação.
  const [usados, setUsados] = useState<string[]>(() => emojisUsados());

  const achados = buscarEmojis(busca);
  const buscando = busca.trim().length > 0;
  const atual = EMOJI_CATS.find((c) => c.key === cat) ?? EMOJI_CATS[0]!;
  const daAba = atual.key === "usados" && usados.length > 0 ? usados : atual.itens.map(([e]) => e);
  const lista = buscando ? achados : daAba;

  function escolher(emoji: string) {
    registrarUsoDeEmoji(emoji);
    setUsados(emojisUsados());
    onPick(emoji);
  }

  return (
    <div className="emok">
      <label className="emok-busca">
        <Search size={13} aria-hidden />
        <input autoFocus aria-label="Search emoji" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Search" />
        {busca ? (
          <button type="button" onClick={() => setBusca("")} aria-label="Clear">
            <X size={12} />
          </button>
        ) : null}
      </label>
      {buscando ? null : (
        <div className="emok-abas" role="tablist" aria-label="Categories">
          {EMOJI_CATS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={c.key === cat}
              aria-label={c.label}
              title={c.label}
              className={"emok-aba" + (c.key === cat ? " on" : "")}
              onClick={() => setCat(c.key)}
            >
              {c.aba}
            </button>
          ))}
        </div>
      )}
      <div className="emok-nome">
        {buscando ? `${achados.length} result${achados.length === 1 ? "" : "s"}` : atual.key === "usados" && usados.length > 0 ? "Your most used" : atual.label}
      </div>
      <div className="emok-grade">
        {lista.map((em) => (
          <button key={em} type="button" title={em} onClick={() => escolher(em)}>
            {em}
          </button>
        ))}
      </div>
      {buscando && achados.length === 0 ? <div className="emok-vazio">No emoji for “{busca.trim()}”.</div> : null}
    </div>
  );
}
