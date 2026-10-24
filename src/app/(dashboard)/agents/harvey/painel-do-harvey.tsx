"use client";

/**
 * O painel do Harvey (dono, 23/10/2026): está vendendo? tem conversa parada? o que ele
 * deixou para a equipe? Lê /api/agents/harvey/painel e atualiza a cada minuto.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { DiaDoHarvey, PainelDoHarvey } from "@/lib/harvey-wa/painel";
import { rotulo, type MedidaDaClasse } from "@/lib/harvey/decisoes";

const TICKET = "https://fixfy.zendesk.com/agent/tickets/";

function tempo(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

const libras = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface p-3">
      <p className="text-xs text-text-tertiary">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold text-text-primary">{valor}</p>
      {nota ? <p className="mt-0.5 text-xs text-text-tertiary">{nota}</p> : null}
    </div>
  );
}

function Barras({ dias }: { dias: DiaDoHarvey[] }) {
  const maior = Math.max(1, ...dias.map((d) => d.conversas));
  return (
    <div className="flex h-24 items-end gap-1" aria-label="Chats and sales per day">
      {dias.map((d) => (
        <div key={d.dia} className="flex flex-1 flex-col items-center gap-1" title={`${d.dia}: ${d.conversas} chats, ${d.pagos} paid (${libras(d.valor)})`}>
          <div className="relative w-full rounded-t bg-surface-tertiary" style={{ height: `${(d.conversas / maior) * 72}px` }}>
            {d.pagos > 0 ? <div className="absolute bottom-0 w-full rounded-t bg-emerald-500" style={{ height: `${Math.max(4, (d.pagos / maior) * 72)}px` }} /> : null}
          </div>
          <span className="text-[10px] text-text-tertiary">{d.dia.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

/** Classe, o que ele fez, se o status ficou certo e se a equipe trocou em 24h (dono, 24/10/2026). */
function Decisoes({ linhas }: { linhas: MedidaDaClasse[] }) {
  if (!linhas.length) return <p className="text-sm text-text-tertiary">No decisions recorded yet. They start with the next Harvey cycle.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border-light bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-light text-left text-xs text-text-tertiary">
            <th className="px-3 py-2 font-medium">Classified as</th>
            <th className="px-3 py-2 font-medium">Tickets</th>
            <th className="px-3 py-2 font-medium">What he did</th>
            <th className="px-3 py-2 font-medium">Right status</th>
            <th className="px-3 py-2 font-medium">Team changed status</th>
            <th className="px-3 py-2 font-medium">Failed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {linhas.map((c) => (
            <tr key={c.classe}>
              <td className="px-3 py-2 text-text-primary">{rotulo(c.classe)}</td>
              <td className="px-3 py-2 text-text-secondary">{c.total}</td>
              <td className="px-3 py-2 text-text-secondary">
                {Object.entries(c.acoes).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${rotulo(a)} ${n}`).join(" · ")}
              </td>
              <td className="px-3 py-2 text-text-secondary" title={`${c.statusCerto} of ${c.conferidos} checked`}>{pct(c.statusCerto, c.conferidos)}</td>
              <td className={`px-3 py-2 ${c.equipeCorrigiu ? "text-amber-700" : "text-text-secondary"}`} title={`${c.equipeCorrigiu} of ${c.conferidos24h} after 24h`}>{pct(c.equipeCorrigiu, c.conferidos24h)}</td>
              <td className={`px-3 py-2 ${c.falhas ? "text-red-600" : "text-text-secondary"}`}>{c.falhas || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PainelDoHarvey() {
  const [p, setP] = useState<PainelDoHarvey | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const res = await fetch("/api/agents/harvey/painel", { cache: "no-store" });
        const corpo = await res.json();
        if (!res.ok) throw new Error(corpo?.error ?? "failed");
        if (vivo) {
          setP(corpo as PainelDoHarvey);
          setErro(null);
        }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "failed");
      }
    };
    void ler();
    const t = setInterval(ler, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  if (erro && !p) return <p className="text-sm text-red-600">Could not load the Harvey panel: {erro}</p>;
  if (!p) return <div className="h-40 animate-pulse rounded-xl bg-surface-secondary" />;

  const s = p.semana;
  return (
    <section className="space-y-4 rounded-xl border border-border-light bg-surface-secondary p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Performance</h2>
        <span className="text-xs text-text-tertiary">Updated {new Date(p.geradoEm).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Numero rotulo="Chats (7 days)" valor={String(s.conversas)} nota={`${p.hoje.conversas} today`} />
        <Numero rotulo="Handed to the team" valor={String(s.passadas)} />
        <Numero rotulo="Quotes requested" valor={String(s.cotacoes)} />
        <Numero rotulo="Payment links" valor={String(s.links)} />
        <Numero rotulo="Paid" valor={String(s.pagos)} nota={libras(s.valor)} />
        <Numero rotulo="Conversion" valor={s.conversao == null ? "–" : `${s.conversao}%`} nota="paid ÷ chats" />
      </div>

      <div>
        <p className="mb-1 text-xs text-text-tertiary">Last 14 days: chats (grey) and paid (green)</p>
        <Barras dias={p.dias} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium text-text-primary">Customers waiting</h3>
            {p.paradas.length ? <Badge variant="danger">{p.paradas.length}</Badge> : <Badge variant="success">None</Badge>}
          </div>
          {p.paradas.length ? (
            <ul className="divide-y divide-border-light rounded-lg border border-border-light bg-surface">
              {p.paradas.map((c) => (
                <li key={c.ticketId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <a href={`${TICKET}${c.ticketId}`} target="_blank" rel="noreferrer" className="truncate text-text-primary hover:underline">
                    #{c.ticketId} · {c.assunto}
                  </a>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-text-tertiary">
                    {c.comHarvey ? "Harvey" : "Team"} · {tempo(c.minutos)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-tertiary">No customer has been waiting more than 20 minutes.</p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium text-text-primary">Left for the team (7 days)</h3>
            <Badge variant={p.pendentes.length ? "warning" : "success"}>{p.pendentes.length || "None"}</Badge>
          </div>
          {p.pendentes.length ? (
            <ul className="max-h-72 divide-y divide-border-light overflow-auto rounded-lg border border-border-light bg-surface">
              {p.pendentes.map((x) => (
                <li key={`${x.ticketId}-${x.quando}`} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    {x.ticketId ? (
                      <a href={`${TICKET}${x.ticketId}`} target="_blank" rel="noreferrer" className="font-medium text-text-primary hover:underline">#{x.ticketId}</a>
                    ) : <span />}
                    <span className="text-xs text-text-tertiary">{new Date(x.quando).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="text-text-secondary">{x.decisao}</p>
                  <p className="text-xs text-text-tertiary">Open: {x.pendente}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-tertiary">Nothing left open.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text-primary">How he decided (7 days)</h3>
        <Decisoes linhas={p.decisoes ?? []} />
      </div>

      {p.falhas.length ? <p className="text-xs text-amber-700">Could not read: {p.falhas.join(", ")}.</p> : null}
    </section>
  );
}
