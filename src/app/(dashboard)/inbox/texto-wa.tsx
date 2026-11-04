/**
 * O texto do balão como o WhatsApp mostra: link clicável e *negrito*,
 * _itálico_ e ~riscado~. A marca só vale colada no texto (`*JOB-1*`, não
 * `* solto *`), igual ao app.
 */

import { Fragment, type ReactNode } from "react";

const LINK = /\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;
const MARCA = /([*_~])(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}])/gu;
const TAG = { "*": "strong", _: "em", "~": "s" } as const;

function marcas(t: string, chave: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const m of t.matchAll(MARCA)) {
    const ini = m.index ?? 0;
    // A marca de abertura não pode vir colada numa letra (`a*b*` fica como está).
    if (ini > 0 && /[\p{L}\p{N}]/u.test(t[ini - 1]!)) continue;
    if (ini > i) out.push(t.slice(i, ini));
    const Tag = TAG[m[1] as keyof typeof TAG];
    out.push(<Tag key={`${chave}-${ini}`}>{m[2]}</Tag>);
    i = ini + m[0].length;
  }
  if (i < t.length) out.push(t.slice(i));
  return out;
}

/** Para a prévia da lista: o texto sem os `*`, `_` e `~` de formatação. */
export function semMarcas(t: string): string {
  return t.replace(MARCA, (m, _marca: string, dentro: string, ini: number) => (ini > 0 && /[\p{L}\p{N}]/u.test(t[ini - 1]!) ? m : dentro));
}

export function TextoDoWhatsApp({ texto }: { texto: string }) {
  const out: ReactNode[] = [];
  let i = 0;
  for (const m of texto.matchAll(LINK)) {
    const ini = m.index ?? 0;
    if (ini > i) out.push(<Fragment key={`t${i}`}>{marcas(texto.slice(i, ini), `t${i}`)}</Fragment>);
    out.push(
      <a key={`l${ini}`} href={m[0]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all" onClick={(e) => e.stopPropagation()}>
        {m[0]}
      </a>,
    );
    i = ini + m[0].length;
  }
  if (i < texto.length) out.push(<Fragment key={`t${i}`}>{marcas(texto.slice(i), `t${i}`)}</Fragment>);
  return <>{out}</>;
}
