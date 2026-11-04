"use client";

/**
 * O seletor "Attach job or quote" do composer, em três abas: os jobs de quem
 * está na conversa (Partner assignments / Client jobs), todos os jobs e as
 * quotes. Cada linha mostra a etiqueta do status, o dia e a janela. No clique,
 * o texto pronto entra no campo; quem envia é a pessoa. O preço que vai junto
 * segue o tipo de contato, e dá para trocar antes de escolher.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Briefcase, ClipboardList, FileText, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { flutuante } from "./movimento";
import type { TipoDeContato } from "./tipos";
import { TONS, tomValido } from "./ui";

type Aba = "contato" | "jobs" | "quotes";
type Item = {
  tipo: "job" | "quote";
  id: string;
  ref: string;
  titulo: string | null;
  endereco: string | null;
  data: string | null;
  janela: string | null;
  status: string;
  quem: string | null;
};
type Valor = "cliente" | "parceiro" | "nenhum";

const VALORES: [Valor, string][] = [
  ["cliente", "Client price"],
  ["parceiro", "Partner payout"],
  ["nenhum", "Hide pricing"],
];

export const valorPadrao = (tipo: TipoDeContato): Valor => (tipo === "parceiro" || tipo === "grupo" ? "parceiro" : tipo === "outro" ? "nenhum" : "cliente");

const dataCurta = (ymd: string | null) => {
  if (!ymd) return null;
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
};

/** A etiqueta do status, com a cor do que pede atenção. */
const TOM: Record<string, string> = {
  late: "red",
  on_hold: "red",
  unassigned: "amber",
  auto_assigning: "amber",
  in_progress: "blue",
  scheduled: "blue",
  final_check: "violet",
  awaiting_payment: "amber",
  completed: "green",
  paid: "green",
  accepted: "green",
  approved: "green",
  sent: "blue",
  quote_ready: "blue",
  awaiting_customer: "amber",
  awaiting_partner: "amber",
  bidding: "violet",
  draft: "slate",
  cancelled: "slate",
  rejected: "slate",
  expired: "slate",
};
const rotulo = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

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
  const temContato = Boolean(parceiroId || clienteId);
  const abas: [Aba, string][] = [
    ...(temContato ? [["contato", parceiroId ? "Partner assignments" : "Client jobs"] as [Aba, string]] : []),
    ["jobs", "Jobs"],
    ["quotes", "Quotes"],
  ];
  const [aba, setAba] = useState<Aba>(temContato ? "contato" : "jobs");
  const [q, setQ] = useState("");
  const [valor, setValor] = useState<Valor>(valorPadrao(tipo));
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativa, setAtiva] = useState(0);
  const [montando, setMontando] = useState<string | null>(null);
  const pedido = useRef(0);
  const campo = useRef<HTMLInputElement>(null);

  // Busca com folga de 250ms; trocar de aba busca na hora.
  useEffect(() => {
    const n = ++pedido.current;
    setItens(null);
    const t = setTimeout(
      async () => {
        try {
          const r = await fetch("/api/inbox/anexar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ acao: "buscar", aba, q, parceiroId, clienteId }),
          });
          const d = (await r.json().catch(() => ({}))) as { itens?: Item[] };
          if (n !== pedido.current) return;
          // Sem sessão a rota devolve 401: dizer isso, não "nenhum job".
          setErro(r.status === 401 ? "Your session expired. Sign in again to load jobs." : r.ok ? null : "Could not load jobs and quotes.");
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
  }, [aba, q, parceiroId, clienteId]);

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
  const vazio =
    q
      ? `Nothing matches “${q}”.`
      : aba === "contato"
        ? parceiroId
          ? "No jobs assigned to this partner yet."
          : "No jobs for this client yet."
        : aba === "quotes"
          ? "No quotes yet. Search above."
          : "No jobs yet. Search above.";

  return (
    <motion.div key="anexar" className="cmp-pop cmp-anexar" {...flutuante("top")}>
      <div className="cmp-salvas-h">
        <ClipboardList size={12} aria-hidden /> Attach job or quote
      </div>
      <div className="cmp-anexar-abas" role="tablist">
        {abas.map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={aba === k}
            className={aba === k ? "on" : ""}
            onClick={() => {
              setAba(k);
              campo.current?.focus();
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="cmp-anexar-busca">
        <Search size={13} aria-hidden />
        <input
          ref={campo}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={aba === "quotes" ? "Search quotes by ref, name or address" : "Search jobs by ref, name or address"}
          onKeyDown={(e) => {
            if (!lista.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setAtiva((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + lista.length) % lista.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void escolher(lista[ativa] ?? lista[0]!);
            }
          }}
        />
      </div>
      <div className="cmp-anexar-lista">
        {itens === null ? (
          <p className="cmp-anexar-vazio">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        ) : erro ? (
          <p className="cmp-anexar-vazio">{erro}</p>
        ) : !lista.length ? (
          <p className="cmp-anexar-vazio">{vazio}</p>
        ) : (
          lista.map((it, i) => (
            <button
              key={`${it.tipo}-${it.id}`}
              type="button"
              className={"cmp-anexar-item" + (i === ativa ? " on" : "")}
              onMouseEnter={() => setAtiva(i)}
              onClick={() => void escolher(it)}
              disabled={Boolean(montando)}
            >
              <span className="ico">
                {montando === it.id ? <Loader2 size={14} className="animate-spin" /> : it.tipo === "job" ? <Briefcase size={14} /> : <FileText size={14} />}
              </span>
              <span className="txt">
                <span className="l1">
                  <b>{it.ref}</b>
                  {it.status ? <span className={`etq ${TONS[tomValido(TOM[it.status] ?? "slate")]}`}>{rotulo(it.status)}</span> : null}
                  {it.data ? (
                    <span className="quando">
                      {it.tipo === "quote" ? "Created " : ""}
                      {dataCurta(it.data)}
                      {it.janela ? ` · ${it.janela}` : ""}
                    </span>
                  ) : null}
                </span>
                {it.titulo ? <span className="l2">{it.titulo}</span> : null}
                <small>{[it.endereco, it.quem].filter(Boolean).join(" · ")}</small>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="cmp-anexar-preco">
        <span className="cmp-anexar-rotulo">Pricing</span>
        <div className="cmp-anexar-valor" role="radiogroup" aria-label="Pricing">
          {VALORES.map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={valor === k} className={valor === k ? "on" : ""} onClick={() => setValor(k)}>
              {t}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
