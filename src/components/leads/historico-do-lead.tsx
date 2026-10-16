"use client";

/**
 * A parte da ficha que responde "esse lead já é cliente? vale a pena?": jobs feitos,
 * quanto gastou, último job e a reputação. Serve para o lado B2B (pela conta) e para o
 * B2C (pelo cliente, e-mail ou telefone).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { HistoricoDoLead as Historico, Reputacao } from "@/lib/leads/reputacao";

const SELO: Record<Reputacao, { rotulo: string; badge: BadgeVariant }> = {
  good: { rotulo: "Good", badge: "success" },
  attention: { rotulo: "Attention", badge: "warning" },
  risk: { rotulo: "Risk", badge: "danger" },
  new: { rotulo: "New, no history", badge: "default" },
};

type Resposta = { clientes: number; historico: Historico; recentes: Array<{ reference: string; status: string; title: string | null; date: string; value: number }> };

const libras = (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const dia = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "·");

export function HistoricoDoLead({ clientId, accountId, email, phone }: { clientId?: string | null; accountId?: string | null; email?: string | null; phone?: string | null }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const chave = [clientId ?? "", accountId ?? "", email ?? "", phone ?? ""].join("|");

  useEffect(() => {
    setDados(null);
    setErro(false);
    const q = new URLSearchParams();
    if (clientId) q.set("client_id", clientId);
    if (accountId) q.set("account_id", accountId);
    if (email) q.set("email", email);
    if (phone) q.set("phone", phone);
    if (![...q.keys()].length) return;
    let vivo = true;
    fetch(`/api/leads/historico?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Resposta) => { if (vivo) setDados(j); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (!clientId && !accountId && !email && !phone) return null;
  const h = dados?.historico;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">History with us</h4>
        {h ? <Badge variant={SELO[h.reputacao].badge} dot>{SELO[h.reputacao].rotulo}</Badge> : null}
      </div>
      {erro ? <p className="text-sm text-text-tertiary">Could not load the history.</p> : null}
      {!dados && !erro ? <p className="text-sm text-text-tertiary">Loading…</p> : null}
      {h ? (
        <>
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-text-tertiary">Jobs done</dt>
            <dd className="m-0 text-text-primary">{h.jobs}{h.cancelados ? ` · ${h.cancelados} cancelled` : ""}</dd>
            <dt className="text-text-tertiary">Spent</dt>
            <dd className="m-0 text-text-primary">{h.jobs ? `${libras(h.receita)} · average ${libras(h.ticketMedio)}` : "·"}</dd>
            <dt className="text-text-tertiary">Last job</dt>
            <dd className="m-0 text-text-primary">{dia(h.ultimoJob)}{h.primeiroJob && h.primeiroJob !== h.ultimoJob ? ` · customer since ${dia(h.primeiroJob)}` : ""}</dd>
            <dt className="text-text-tertiary">Reputation</dt>
            <dd className="m-0 text-text-primary first-letter:uppercase">{h.motivos.join(" · ")}{h.valorVencido > 0 ? ` (${libras(h.valorVencido)} owed)` : ""}</dd>
          </dl>
          {dados!.recentes.length ? (
            <ul className="m-0 mt-3 list-none space-y-1 p-0 text-sm">
              {dados!.recentes.map((j) => (
                <li key={j.reference} className="flex items-baseline gap-2">
                  <Link href={`/jobs?search=${encodeURIComponent(j.reference)}`} className="font-mono text-xs text-primary hover:underline">{j.reference}</Link>
                  <span className="min-w-0 flex-1 truncate text-text-secondary">{j.title ?? ""}</span>
                  <span className="shrink-0 text-xs text-text-tertiary">{dia(j.date)} · {libras(j.value)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
