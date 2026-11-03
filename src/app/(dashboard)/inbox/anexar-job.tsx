"use client";

/**
 * O seletor "Attach job or quote" do composer: lista o que é de quem está na
 * conversa (ou o que a busca achar) e, no clique, joga o texto pronto no campo.
 * Quem envia é a pessoa. O valor que vai junto segue o tipo de contato, e dá
 * para trocar aqui antes de escolher.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  ClipboardList,
  FileText,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { flutuante } from "./movimento";
import type { TipoDeContato } from "./tipos";

type Grupo = "contato" | "outros" | "quotes";
type Item = {
  tipo: "job" | "quote";
  grupo: Grupo;
  id: string;
  ref: string;
  titulo: string | null;
  endereco: string | null;
  data: string | null;
  status: string;
};
type Valor = "cliente" | "parceiro" | "nenhum";

const VALORES: [Valor, string][] = [
  ["cliente", "Client price"],
  ["parceiro", "Partner pay"],
  ["nenhum", "No price"],
];

export const valorPadrao = (tipo: TipoDeContato): Valor =>
  tipo === "parceiro" || tipo === "grupo"
    ? "parceiro"
    : tipo === "outro"
      ? "nenhum"
      : "cliente";

const dataCurta = (ymd: string | null) => {
  if (!ymd) return null;
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(d);
};

function tituloDoGrupo(g: Grupo, tipo: TipoDeContato) {
  if (g === "quotes") return "Quotes";
  if (g === "outros") return "Other jobs";
  return tipo === "parceiro"
    ? "This partner's jobs"
    : tipo === "conta"
      ? "This account's jobs"
      : "This client's jobs";
}

const status = (s: string) =>
  s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function AnexarJob({
  tipo,
  parceiroId,
  clienteId,
  onInserir,
}: {
  tipo: TipoDeContato;
  parceiroId: string | null;
  clienteId: string | null;
  onInserir: (texto: string) => void;
}) {
  const [q, setQ] = useState("");
  const [valor, setValor] = useState<Valor>(valorPadrao(tipo));
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativa, setAtiva] = useState(0);
  const [montando, setMontando] = useState<string | null>(null);
  const pedido = useRef(0);

  // Busca com folga de 250ms; sem termo, o que é do contato.
  useEffect(() => {
    const n = ++pedido.current;
    const t = setTimeout(
      async () => {
        try {
          const r = await fetch("/api/inbox/anexar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ acao: "buscar", q, parceiroId, clienteId }),
          });
          const d = (await r.json().catch(() => ({}))) as { itens?: Item[] };
          if (n !== pedido.current) return;
          // Sem sessão a rota devolve 401: dizer isso, não "nenhum job".
          setErro(
            r.status === 401
              ? "Your session expired. Sign in again to load jobs."
              : r.ok
                ? null
                : "Could not load jobs and quotes.",
          );
          setItens(d.itens ?? []);
          setAtiva(0);
        } catch {
          if (n === pedido.current) {
            setErro("Could not load jobs and quotes.");
            setItens([]);
          }
        }
      },
      q ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [q, parceiroId, clienteId]);

  async function escolher(it: Item) {
    if (montando) return;
    setMontando(it.id);
    try {
      const r = await fetch("/api/inbox/anexar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo: it.tipo, id: it.id, valor, parceiroId }),
      });
      const d = (await r.json()) as { texto?: string; error?: string };
      if (!r.ok || !d.texto) throw new Error(d.error ?? "Could not load it");
      onInserir(d.texto);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load it");
    } finally {
      setMontando(null);
    }
  }

  const lista = itens ?? [];
  return (
    <motion.div
      key="anexar"
      className="cmp-pop cmp-anexar"
      {...flutuante("top")}
    >
      <div className="cmp-salvas-h">
        <ClipboardList size={12} aria-hidden /> Attach job or quote
      </div>
      <div className="cmp-anexar-busca">
        <Search size={13} aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by ref, name, address or postcode"
          onKeyDown={(e) => {
            if (!lista.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setAtiva(
                (a) =>
                  (a + (e.key === "ArrowDown" ? 1 : -1) + lista.length) %
                  lista.length,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              void escolher(lista[ativa] ?? lista[0]!);
            }
          }}
        />
      </div>
      <div
        className="cmp-anexar-valor"
        role="radiogroup"
        aria-label="Price to include"
      >
        {VALORES.map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={valor === k}
            className={valor === k ? "on" : ""}
            onClick={() => setValor(k)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="cmp-anexar-lista">
        {itens === null ? (
          <p className="cmp-anexar-vazio">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        ) : erro ? (
          <p className="cmp-anexar-vazio">{erro}</p>
        ) : !lista.length ? (
          <p className="cmp-anexar-vazio">
            {q
              ? `Nothing matches “${q}”.`
              : "No jobs or quotes for this contact yet. Search above."}
          </p>
        ) : (
          lista.map((it, i) => (
            <Fragment key={`${it.tipo}-${it.id}`}>
              {i === 0 || lista[i - 1]!.grupo !== it.grupo ? (
                <p className="cmp-anexar-grupo">
                  {tituloDoGrupo(it.grupo, tipo)}
                </p>
              ) : null}
              <button
                type="button"
                className={"cmp-anexar-item" + (i === ativa ? " on" : "")}
                onMouseEnter={() => setAtiva(i)}
                onClick={() => void escolher(it)}
                disabled={Boolean(montando)}
              >
                <span className="ico">
                  {montando === it.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : it.tipo === "job" ? (
                    <Briefcase size={14} />
                  ) : (
                    <FileText size={14} />
                  )}
                </span>
                <span className="txt">
                  <b>
                    {it.ref}
                    {it.titulo ? <span> · {it.titulo}</span> : null}
                  </b>
                  <small>
                    {[it.endereco, dataCurta(it.data), status(it.status)]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </button>
            </Fragment>
          ))
        )}
      </div>
    </motion.div>
  );
}
