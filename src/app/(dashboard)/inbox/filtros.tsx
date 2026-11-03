"use client";

/**
 * Os filtros da lista, separados da busca, como no VOS: tipo de contato,
 * ofício do parceiro, quem assumiu, estado e tag. Dentro de cada grupo é "ou";
 * entre grupos é "e".
 */

import { useMemo, useState } from "react";
import { motion as mo } from "framer-motion";
import { Check, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tempo } from "./movimento";
import { Chip } from "./ui";
import { Button } from "@/components/ui/button";
import type { ConversaDaCaixa } from "./tipos";
import type { MembroDaEquipe } from "@/lib/inbox/equipe";

export type Filtros = {
  tipos: string[];
  oficios: string[];
  donos: string[];
  estados: string[];
  tags: string[];
};

export const FILTROS_VAZIOS: Filtros = { tipos: [], oficios: [], donos: [], estados: [], tags: [] };

const TIPOS: [string, string][] = [
  ["parceiro", "Partner"],
  ["cliente", "Client"],
  ["conta", "Account"],
  ["outro", "Lead"],
  ["grupo", "Group"],
];

const ESTADOS: [string, string][] = [
  ["nao_lida", "Unread"],
  ["esperando", "Needs reply"],
  ["job_hoje", "Job today"],
  ["fixada", "Pinned"],
];

/** "none" em donos é Unassigned. */
const SEM_DONO = "none";

export const quantosFiltros = (f: Filtros) => f.tipos.length + f.oficios.length + f.donos.length + f.estados.length + f.tags.length;

export function passaNosFiltros(
  c: ConversaDaCaixa,
  f: Filtros,
  ajuda: { naoLida: (c: ConversaDaCaixa) => boolean; esperando: (c: ConversaDaCaixa) => boolean },
): boolean {
  if (f.tipos.length && !f.tipos.includes(c.tipo)) return false;
  if (f.oficios.length && !(c.parceiro?.oficios ?? []).some((o) => f.oficios.includes(o))) return false;
  if (f.donos.length && !f.donos.includes(c.atribuidaA ?? SEM_DONO)) return false;
  if (f.tags.length && !c.tags.some((t) => f.tags.includes(t))) return false;
  if (f.estados.length) {
    const ok = f.estados.some((e) =>
      e === "nao_lida" ? ajuda.naoLida(c) : e === "esperando" ? ajuda.esperando(c) : e === "job_hoje" ? Boolean(c.jobHoje) : e === "fixada" ? Boolean(c.fixadaEm) : false,
    );
    if (!ok) return false;
  }
  return true;
}

function alternar(lista: string[], v: string) {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
        ativo ? "border-text-primary bg-text-primary text-[var(--on-brand)]" : "border-border-light text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
      )}
    >
      {ativo ? <Check className="h-3 w-3" /> : null}
      {children}
    </button>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-light px-3.5 py-3 last:border-b-0">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function PainelDeFiltros({
  filtros,
  onMudar,
  onFechar,
  conversas,
  equipe,
  tags,
}: {
  filtros: Filtros;
  onMudar: (f: Filtros) => void;
  onFechar: () => void;
  conversas: ConversaDaCaixa[];
  equipe: MembroDaEquipe[];
  tags: string[];
}) {
  const [q, setQ] = useState("");
  const termo = q.trim().toLowerCase();
  const casa = (t: string) => !termo || t.toLowerCase().includes(termo);

  // Os ofícios que aparecem nas conversas de parceiro, do mais comum para o menos.
  const oficios = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of conversas) for (const o of c.parceiro?.oficios ?? []) n.set(o, (n.get(o) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([o]) => o);
  }, [conversas]);

  const mudar = (k: keyof Filtros, v: string) => onMudar({ ...filtros, [k]: alternar(filtros[k], v) });
  const tiposVistos = TIPOS.filter(([, t]) => casa(t));
  const oficiosVistos = oficios.filter(casa);
  const donosVistos: [string, string][] = ([[SEM_DONO, "Unassigned"], ...equipe.map((m) => [m.id, m.nome])] as [string, string][]).filter(([, t]) => casa(t));
  const estadosVistos = ESTADOS.filter(([, t]) => casa(t));
  const tagsVistas = tags.filter(casa);
  const nada = !tiposVistos.length && !oficiosVistos.length && !donosVistos.length && !estadosVistos.length && !tagsVistas.length;

  return (
    <mo.div
      className="absolute right-3 top-[52px] z-30 flex max-h-[70vh] w-[320px] flex-col overflow-hidden rounded-xl border border-border-light bg-card shadow-xl"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: tempo("md") }}
      exit={{ opacity: 0, y: -6, transition: tempo("xs", "saida") }}
    >
      <div className="flex items-center gap-2 border-b border-border-light px-3.5 py-2.5">
        <p className="flex-1 text-[13px] font-semibold text-text-primary">Filters</p>
        {quantosFiltros(filtros) ? (
          <button type="button" onClick={() => onMudar(FILTROS_VAZIOS)} className="text-[12px] font-medium text-text-tertiary hover:text-text-primary">
            Clear all
          </button>
        ) : null}
        <button type="button" onClick={onFechar} className="text-text-tertiary hover:text-text-primary" aria-label="Close filters">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-border-light px-3.5 py-2">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-border-light px-2.5 focus-within:border-text-tertiary">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a filter: type of work, person, tag"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {tiposVistos.length ? (
          <Grupo titulo="Contact">
            {tiposVistos.map(([k, t]) => (
              <Opcao key={k} ativo={filtros.tipos.includes(k)} onClick={() => mudar("tipos", k)}>
                {t}
              </Opcao>
            ))}
          </Grupo>
        ) : null}
        {oficiosVistos.length ? (
          <Grupo titulo="Type of work">
            {oficiosVistos.map((o) => (
              <Opcao key={o} ativo={filtros.oficios.includes(o)} onClick={() => mudar("oficios", o)}>
                {o}
              </Opcao>
            ))}
          </Grupo>
        ) : null}
        {donosVistos.length ? (
          <Grupo titulo="Assigned to">
            {donosVistos.map(([k, t]) => (
              <Opcao key={k} ativo={filtros.donos.includes(k)} onClick={() => mudar("donos", k)}>
                {t}
              </Opcao>
            ))}
          </Grupo>
        ) : null}
        {estadosVistos.length ? (
          <Grupo titulo="Status">
            {estadosVistos.map(([k, t]) => (
              <Opcao key={k} ativo={filtros.estados.includes(k)} onClick={() => mudar("estados", k)}>
                {t}
              </Opcao>
            ))}
          </Grupo>
        ) : null}
        {tagsVistas.length ? (
          <Grupo titulo="Tags">
            {tagsVistas.map((t) => (
              <Opcao key={t} ativo={filtros.tags.includes(t)} onClick={() => mudar("tags", t)}>
                {t}
              </Opcao>
            ))}
          </Grupo>
        ) : null}
        {nada ? <p className="px-3.5 py-4 text-[12px] text-text-tertiary">No filter matches “{q}”.</p> : null}
      </div>
      {/* Os filtros já valem ao clicar; o botão só fecha, para não precisar clicar fora. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-light px-3.5 py-2.5">
        <span className="text-[12px] text-text-tertiary">{quantosFiltros(filtros) ? `${quantosFiltros(filtros)} selected` : "No filters"}</span>
        <Button size="sm" onClick={onFechar}>
          Apply
        </Button>
      </div>
    </mo.div>
  );
}

/** Os filtros ligados, em chips que dá para tirar um a um, embaixo do título da lista. */
export function FiltrosAtivos({ filtros, onMudar, equipe }: { filtros: Filtros; onMudar: (f: Filtros) => void; equipe: MembroDaEquipe[] }) {
  const rotulo = (k: keyof Filtros, v: string) =>
    k === "tipos"
      ? (TIPOS.find((x) => x[0] === v)?.[1] ?? v)
      : k === "estados"
        ? (ESTADOS.find((x) => x[0] === v)?.[1] ?? v)
        : k === "donos"
          ? v === SEM_DONO
            ? "Unassigned"
            : (equipe.find((m) => m.id === v)?.nome ?? "Team")
          : v;
  const ligados = (Object.keys(filtros) as (keyof Filtros)[]).flatMap((k) => filtros[k].map((v) => ({ k, v })));
  if (!ligados.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 px-4 pb-2">
      <SlidersHorizontal className="mr-0.5 h-3.5 w-3.5 text-text-tertiary" />
      {ligados.map(({ k, v }) => (
        <button key={`${k}-${v}`} type="button" onClick={() => onMudar({ ...filtros, [k]: filtros[k].filter((x) => x !== v) })} title="Remove filter">
          <Chip tom="slate">
            {rotulo(k, v)}
            <X className="h-3 w-3" />
          </Chip>
        </button>
      ))}
    </div>
  );
}
