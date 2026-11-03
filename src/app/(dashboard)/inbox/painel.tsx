"use client";

/**
 * A gaveta da direita da /inbox: quem está falando e o que a operação sabe
 * dele. Parceiro: a rota de hoje, nota e compliance, relatórios que faltam,
 * self-bill em aberto, documentos e arquivos da conversa, com "Offer a job"
 * (o mesmo assign do Jobs, com e-mail e Zendesk). Cliente: cadastro, ticket
 * do Zendesk, jobs, cotações, faturas e arquivos. Número sem cadastro:
 * "Add as client".
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion as mo } from "framer-motion";
import {
  Briefcase,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  Home,
  MapPin,
  Receipt,
  Search,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";
import { createClient } from "@/services/clients";
import type { TipoDoPrefill } from "@/lib/inbox/prefill";
import { cn } from "@/lib/utils";
import { tempo } from "./movimento";
import { Acao, Avatar, Chip, ChipDaEtapa, JOB_FEITO, chegada, corDoAutor, horaCurta, nomeDoAutor, type Tom } from "./ui";
import type { ConversaDaCaixa, DocumentoDoParceiro, JobDaCaixa, JobParaOferecer, SelfBillDaCaixa } from "./tipos";

export const ZENDESK = "https://fixfy.zendesk.com/agent/tickets/";
const libra = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export { horaCurta };
export const dia = (data: string | null) =>
  data ? new Date(`${data}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "No date";
const rotulo = (s: string) => (s ? s.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "");
export const ticketDe = (c: ConversaDaCaixa) => c.jobs.map((j) => j.ticket).find((t) => t && /^\d+$/.test(t)) ?? null;
const DIA_MS = 86_400_000;

type AbaParceiro = "parceiro" | "jobs" | "selfbill" | "docs" | "arquivos";
type AbaCliente = "cliente" | "jobs" | "quotes" | "faturas" | "ticket" | "arquivos";

type Periodo = "hoje" | "amanha" | "semana" | "proxima" | "mes" | "todos";
const PERIODOS: [Periodo, string, string][] = [
  ["hoje", "Today", "Today"],
  ["amanha", "Tomorrow", "Tmrw"],
  ["semana", "This week", "Week"],
  ["proxima", "Next week", "Next wk"],
  ["mes", "This month", "Month"],
  ["todos", "All", "All"],
];

/** Hoje em Londres como AAAA-MM-DD, e somar dias sem fuso no meio. */
const hojeEmLondres = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const somarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** [início, fim] do período, inclusive. Semana de segunda a domingo. */
function faixa(p: Periodo, hoje: string): [string, string] | null {
  const dow = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7;
  const segunda = somarDias(hoje, -dow);
  switch (p) {
    case "hoje":
      return [hoje, hoje];
    case "amanha":
      return [somarDias(hoje, 1), somarDias(hoje, 1)];
    case "semana":
      return [segunda, somarDias(segunda, 6)];
    case "proxima":
      return [somarDias(segunda, 7), somarDias(segunda, 13)];
    case "mes": {
      const [a, m] = hoje.split("-").map(Number);
      const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      return [`${hoje.slice(0, 7)}-01`, fim];
    }
    case "todos":
      return null;
  }
}

/**
 * A aba Jobs do parceiro e do cliente: chips de período com a contagem de
 * cada um, e os jobs do período em ordem de data. Sem job no período escolhido,
 * diz qual é o próximo para não parecer que não há nada.
 */
function JobsPorPeriodo({ jobs, vazio, inicial }: { jobs: JobDaCaixa[]; vazio: string; inicial: Periodo }) {
  const [periodo, setPeriodo] = useState<Periodo>(inicial);
  const hoje = hojeEmLondres();
  const doPeriodo = (p: Periodo) => {
    const f = faixa(p, hoje);
    return jobs
      .filter((j) => !f || (j.data != null && j.data >= f[0] && j.data <= f[1]))
      .sort((a, b) => (p === "todos" ? (b.data ?? "").localeCompare(a.data ?? "") : (a.data ?? "").localeCompare(b.data ?? "") || (a.inicio ?? "").localeCompare(b.inicio ?? "")));
  };
  const lista = doPeriodo(periodo);
  const proximo = jobs.filter((j) => j.data && j.data >= hoje).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""))[0];

  return (
    <div className="px-4 py-3">
      {/* Uma linha só: o número em cima, o período embaixo, num trilho cinza. */}
      <div className="mb-3 grid grid-cols-6 gap-0.5 rounded-lg bg-surface-secondary p-0.5" role="tablist" aria-label="Period">
        {PERIODOS.map(([k, t, curto]) => {
          const n = doPeriodo(k).length;
          const on = periodo === k;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={on}
              title={t}
              onClick={() => setPeriodo(k)}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-md py-1 transition-colors",
                on ? "bg-card text-text-primary shadow-sm ring-1 ring-border-light" : "text-text-tertiary hover:text-text-primary",
              )}
            >
              <span className={cn("text-[13px] font-semibold leading-4 tabular-nums", on ? "text-primary" : n ? "text-text-primary" : "text-text-tertiary")}>{n}</span>
              <span className="w-full truncate text-center text-[10px] font-medium leading-3">{curto}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {lista.length ? (
          lista.map((j) => <CartaoDeJob key={j.id} j={j} comData={periodo !== "hoje" && periodo !== "amanha"} />)
        ) : (
          <div className="rounded-lg border border-dashed border-border-light px-3 py-3 text-[12.5px] text-text-tertiary">
            {jobs.length ? `Nothing ${PERIODOS.find((x) => x[0] === periodo)![1].toLowerCase()}.` : vazio}
            {proximo && periodo !== "todos" ? (
              <button type="button" className="mt-1 block font-medium text-text-primary hover:underline" onClick={() => setPeriodo("todos")}>
                Next: {proximo.ref} on {dia(proximo.data)}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-light px-4 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">{titulo}</p>
        {acao}
      </div>
      {children}
    </div>
  );
}

const LinkDaSecao = ({ href, children = "Open", externo = false }: { href: string; children?: React.ReactNode; externo?: boolean }) =>
  externo ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-xs font-medium text-[var(--info-ink)] hover:underline">
      {children}
    </a>
  ) : (
    <Link href={href} className="text-xs font-medium text-[var(--info-ink)] hover:underline">
      {children}
    </Link>
  );

function Campos({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">{children}</dl>;
}

function Campo({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary">{k}</dt>
      <dd className="min-w-0 break-words text-text-primary">{v}</dd>
    </>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="text-[13px] text-text-tertiary">{texto}</p>;

/** A pílula do canto do cartão: o que o job está fazendo agora. */
function pilulaDoJob(j: JobDaCaixa, proximo: boolean): { texto: string; tom: Tom } | null {
  if (j.status === "in_progress") return { texto: "On site", tom: "green" };
  if (["final_check", "awaiting_payment", "completed"].includes(j.status)) return { texto: "Done", tom: "slate" };
  if (j.status === "late") return { texto: "Late", tom: "red" };
  if (j.status === "on_hold") return { texto: "On hold", tom: "amber" };
  if (proximo) return { texto: "Next", tom: "slate" };
  return null;
}

/** Cartão no formato da rota: ref e pílula, o que e onde, janela, origem e ticket. */
export function CartaoDeJob({ j, proximo = false, comData = false }: { j: JobDaCaixa; proximo?: boolean; comData?: boolean }) {
  const pilula = pilulaDoJob(j, proximo);
  const janela = j.inicio ? `${horaCurta(j.inicio)}${j.fim ? ` to ${horaCurta(j.fim)}` : ""}` : null;
  const onde = [j.titulo, j.endereco?.split(",").slice(-2).join(",").trim()].filter(Boolean).join(" · ");
  return (
    <Link href={`/jobs/${j.id}`} className="block rounded-xl border border-border-light px-3.5 py-2.5 transition-colors hover:bg-surface-secondary/60">
      <span className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-text-primary">{j.ref}</span>
        <span className="ml-auto">
          {pilula ? (
            <Chip tom={pilula.tom}>{pilula.texto}</Chip>
          ) : j.status ? (
            <ChipDaEtapa e={{ grupo: "job", status: j.status }} />
          ) : null}
        </span>
      </span>
      {onde ? <span className="block truncate text-[12.5px] text-text-secondary">{onde}</span> : null}
      <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-text-tertiary">
        {comData ? <span>{dia(j.data)}</span> : null}
        {janela ? <span>{janela}</span> : null}
        <span>{j.origem ?? "Direct"}</span>
        {j.ticket && /^\d+$/.test(j.ticket) ? <span>Ticket #{j.ticket}</span> : null}
      </span>
    </Link>
  );
}

/**
 * A rota de hoje como linha do tempo: uma parada por job, na ordem da janela.
 * O ponto diz o estado (feito, no local, próximo, depois) e a etiqueta à direita
 * é a mesma chegada da lista (At risk, Late), que anda com o relógio.
 */
function RotaDeHoje({ rota, proximoId, agora }: { rota: JobDaCaixa[]; proximoId: string | undefined; agora: number }) {
  // Só o que falta: o feito sai da rota (animando), e cabem 3 paradas antes de rolar.
  const ordem = [...rota].filter((j) => !JOB_FEITO.has(j.status)).sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? ""));
  if (!ordem.length) return <Vazio texto="All stops done for today." />;
  return (
    <ol className="relative max-h-[264px] overflow-y-auto pr-0.5">
      <AnimatePresence initial={false}>
      {ordem.map((j, i) => {
        const feito = JOB_FEITO.has(j.status);
        const noLocal = j.status === "in_progress";
        const proximo = j.id === proximoId;
        const ch = feito ? null : chegada(j, agora);
        const alerta = ch && (ch.tom === "red" || ch.tom === "amber") ? ch : null;
        const janela = j.inicio ? `${horaCurta(j.inicio)}${j.fim ? `–${horaCurta(j.fim)}` : ""}` : "No time set";
        const onde = j.endereco?.split(",").slice(-2).join(",").trim();
        return (
          <mo.li
            key={j.id}
            className="relative flex gap-3 pb-3 last:pb-0"
            layout="position"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0, transition: { ...tempo("md"), delay: i * 0.04 } }}
            exit={{ opacity: 0, x: 16, height: 0, paddingBottom: 0, transition: tempo("lg", "saida") }}
          >
            {i < ordem.length - 1 ? <span className="absolute bottom-0 left-[11px] top-7 w-px bg-border-light" aria-hidden /> : null}
            <span
              className={cn(
                "relative z-[1] mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                feito && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950",
                noLocal && "bg-emerald-500 text-white",
                !feito && !noLocal && proximo && (alerta?.tom === "red" ? "bg-red-600 text-white" : alerta ? "bg-amber-500 text-white" : "bg-primary text-[var(--on-brand)]"),
                !feito && !noLocal && !proximo && "bg-card text-text-tertiary ring-1 ring-border-light",
              )}
              aria-hidden
            >
              {feito ? <Check className="h-3.5 w-3.5" /> : noLocal ? <MapPin className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <Link
              href={`/jobs/${j.id}`}
              className={cn(
                "min-w-0 flex-1 rounded-xl border px-3 py-2 transition-colors hover:bg-surface-secondary/60",
                proximo || noLocal ? "border-border bg-card shadow-sm" : "border-border-light",
                feito && "opacity-60",
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn("text-[13.5px] font-semibold tabular-nums", feito ? "text-text-tertiary line-through" : "text-text-primary")}>{janela}</span>
                <span className="ml-auto shrink-0">
                  {feito ? (
                    <Chip tom="slate">Done</Chip>
                  ) : noLocal ? (
                    <Chip icone={MapPin} tom="green">On site</Chip>
                  ) : alerta ? (
                    <Chip icone={alerta.icone} tom={alerta.tom} title={alerta.title}>
                      {alerta.tom === "red" ? alerta.texto : "At risk"}
                    </Chip>
                  ) : proximo ? (
                    <Chip tom="blue">Next stop</Chip>
                  ) : null}
                </span>
              </span>
              <span className="block truncate text-[12.5px] text-text-secondary">
                <span className="font-medium text-text-primary">{j.ref}</span>
                {j.titulo ? ` · ${j.titulo}` : ""}
              </span>
              <span className="flex gap-x-3 text-[12px] text-text-tertiary">
                {onde ? <span className="truncate">{onde}</span> : null}
                <span className="shrink-0">{j.origem ?? "Direct"}</span>
              </span>
            </Link>
          </mo.li>
        );
      })}
      </AnimatePresence>
    </ol>
  );
}

function Cabeca({ c, online, sub, children }: { c: ConversaDaCaixa; online: boolean; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-border-light px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar c={c} tamanho="md" online={online} />
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold text-text-primary">{c.nome}</p>
          <p className="truncate text-[12px] text-text-tertiary">{sub ?? `+${c.contato}`}</p>
        </div>
      </div>
      {children ? <div className="mt-2.5 grid grid-cols-2 gap-2">{children}</div> : null}
    </div>
  );
}

function Abas<T extends string>({ abas, ativa, onTroca }: { abas: [T, string][]; ativa: T; onTroca: (a: T) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto border-b border-border-light px-4">
      {abas.map(([k, t]) => (
        <button
          key={k}
          type="button"
          onClick={() => onTroca(k)}
          className={cn(
            "relative -mb-px whitespace-nowrap py-3 text-[13px] font-medium transition-colors",
            ativa === k ? "text-text-primary" : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          {t}
          {ativa === k ? <mo.span layoutId="painel-aba-ativa" transition={tempo("lg")} className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-text-primary" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Compliance em chips: vencido em vermelho, vencendo em 30 dias em âmbar, o resto ok. */
function chipsDeCompliance(docs: DocumentoDoParceiro[], agora: number): { texto: string; tom: Tom }[] {
  const vivos = docs.filter((d) => !["rejected", "archived"].includes(String(d.status)));
  if (!vivos.length) return [{ texto: "No documents", tom: "slate" }];
  const chips: { texto: string; tom: Tom }[] = [];
  for (const d of vivos) {
    if (!d.expira) continue;
    const dias = Math.ceil((new Date(d.expira).getTime() - agora) / DIA_MS);
    const nome = (d.tipo ?? d.nome).replace(/_/g, " ");
    if (dias < 0) chips.push({ texto: `${nome} expired`, tom: "red" });
    else if (dias <= 30) chips.push({ texto: `${nome} ${dias}d left`, tom: "amber" });
  }
  const pendentes = vivos.filter((d) => d.status === "pending").length;
  if (pendentes) chips.push({ texto: `${pendentes} pending review`, tom: "amber" });
  return chips.length ? chips : [{ texto: "Documents valid", tom: "green" }];
}

function Arquivos({ c }: { c: ConversaDaCaixa }) {
  const midias = c.mensagens.filter((m) => m.midiaUrl).reverse();
  if (!midias.length) return <Vazio texto="No photos or files in this chat yet." />;
  const fotos = midias.filter((m) => m.tipo === "image" || m.tipo === "sticker");
  const outros = midias.filter((m) => !(m.tipo === "image" || m.tipo === "sticker"));
  return (
    <div className="space-y-3">
      {fotos.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {fotos.map((m) => (
            <a key={m.id} href={m.midiaUrl!} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border-light">
              {/* eslint-disable-next-line @next/next/no-img-element -- foto da conversa por URL assinada ou da uazapi */}
              <img src={m.midiaUrl!} alt="" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      ) : null}
      {outros.map((m) => (
        <a key={m.id} href={m.midiaUrl!} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2 text-[13px] text-text-primary hover:bg-surface-secondary/60">
          <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">{m.texto ?? rotulo(m.tipo)}</span>
          <span className="text-[11px] text-text-tertiary">{new Date(m.criadoEm).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        </a>
      ))}
    </div>
  );
}

export function Painel({
  c,
  agora,
  online,
  onCriar,
  onOferecer,
  onAbrirContato,
}: {
  c: ConversaDaCaixa;
  /** O relógio da caixa (anda a cada 10 s): a rota de hoje muda de estado com ele. */
  agora: number;
  online: boolean;
  onCriar: (t: TipoDoPrefill) => void;
  onOferecer: () => void;
  /** Abre a conversa particular de alguém (do grupo) na própria caixa. */
  onAbrirContato?: (numero: string, nome: string) => void;
}) {
  if (c.tipo === "grupo") return <PainelDoGrupo c={c} onAbrirContato={onAbrirContato} />;
  if (c.tipo === "parceiro" && c.parceiro) return <PainelDoParceiro c={c} agora={agora} online={online} onOferecer={onOferecer} />;
  if (c.tipo === "outro" && !c.cliente) return <NovoCliente c={c} online={online} />;
  return <PainelDoCliente c={c} online={online} onCriar={onCriar} />;
}

function PainelDoParceiro({ c, agora, online, onOferecer }: { c: ConversaDaCaixa; agora: number; online: boolean; onOferecer: () => void }) {
  const [aba, setAba] = useState<AbaParceiro>("parceiro");
  const p = c.parceiro!;
  const rota = c.jobHoje ? c.jobs.filter((j) => j.data === c.jobHoje!.data) : [];
  const depois = c.jobs.filter((j) => !rota.includes(j));
  // "Next" é o primeiro da rota que ainda não começou.
  const proximoId = rota.find((j) => !["in_progress", "final_check", "awaiting_payment", "completed"].includes(j.status))?.id;
  const sub = [p.oficio ?? "Partner", p.area].filter(Boolean).join(" · ");

  return (
    <div>
      <Cabeca c={c} online={online} sub={sub}>
        <Acao icone={Send} onClick={onOferecer}>
          Offer a job
        </Acao>
        <Link href={`/partners/${p.id}`} className="grid">
          <Acao icone={ExternalLink}>Open partner</Acao>
        </Link>
      </Cabeca>
      <Abas<AbaParceiro>
        abas={[
          ["parceiro", "Partner"],
          ["jobs", "Jobs"],
          ["selfbill", "Self-bill"],
          ["docs", "Docs"],
          ["arquivos", "Files"],
        ]}
        ativa={aba}
        onTroca={setAba}
      />

      {aba === "parceiro" ? (
        <>
          <Secao
            titulo="Today's route"
            acao={
              rota.length ? (
                <span className="text-[11.5px] tabular-nums text-text-tertiary">
                  {rota.filter((j) => JOB_FEITO.has(j.status)).length}/{rota.length} done
                </span>
              ) : undefined
            }
          >
            {rota.length ? (
              <RotaDeHoje rota={rota} proximoId={proximoId} agora={agora} />
            ) : (
              <div className="space-y-2">
                <Vazio texto="No job today." />
                {depois[0] ? <CartaoDeJob j={depois[0]} proximo comData /> : null}
              </div>
            )}
          </Secao>
          <Secao titulo="Partner">
            <Campos>
              <Campo k="Rating" v={p.nota ? `${p.nota.toFixed(1)} · ${p.jobsFeitos} jobs` : `${p.jobsFeitos} jobs`} />
              <Campo
                k="Compliance"
                v={
                  <span className="flex flex-wrap gap-1">
                    {chipsDeCompliance(p.documentos, agora).map((x) => (
                      <Chip key={x.texto} tom={x.tom}>
                        {x.texto}
                      </Chip>
                    ))}
                  </span>
                }
              />
              <Campo k="Status" v={p.status ? rotulo(p.status) : "-"} />
              <Campo
                k="Reports"
                v={
                  p.semRelatorio.length ? (
                    <span>
                      {p.semRelatorio.length} missing (
                      {p.semRelatorio.slice(0, 3).map((j, i) => (
                        <span key={j.id}>
                          {i ? ", " : ""}
                          <Link href={`/jobs/${j.id}`} className="hover:underline">
                            {j.ref}
                          </Link>
                        </span>
                      ))}
                      {p.semRelatorio.length > 3 ? "..." : ""})
                    </span>
                  ) : (
                    "Up to date"
                  )
                }
              />
              <Campo k="Email" v={p.email ?? "-"} />
              {c.perfil ? <Campo k="WhatsApp" v={c.perfil} /> : null}
            </Campos>
          </Secao>
          <Secao titulo="Trades & coverage" acao={<LinkDaSecao href={`/partners/${p.id}`} />}>
            <Cobertura p={p} />
          </Secao>
        </>
      ) : null}

      {aba === "jobs" ? (
        <JobsPorPeriodo key={c.contato} jobs={c.jobs} inicial="semana" vazio="Nothing booked from today on." />
      ) : null}

      {aba === "selfbill" ? <SelfBillsDoParceiro key={p.id} p={p} /> : null}

      {aba === "docs" ? (
        <Secao titulo={`Documents · ${p.documentos.length}`} acao={<LinkDaSecao href={`/partners/${p.id}`} />}>
          <div className="space-y-1.5">
            {p.documentos.length ? (
              p.documentos.map((d) => {
                const dias = d.expira ? Math.ceil((new Date(d.expira).getTime() - agora) / DIA_MS) : null;
                return (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2 text-[13px]">
                    <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-text-primary">{d.nome}</span>
                      <span className="block text-[11px] text-text-tertiary">{d.expira ? `Expires ${dia(d.expira.slice(0, 10))}` : "No expiry"}</span>
                    </span>
                    {dias != null && dias < 0 ? (
                      <Chip tom="red">Expired</Chip>
                    ) : dias != null && dias <= 30 ? (
                      <Chip tom="amber">{dias}d left</Chip>
                    ) : (
                      <Chip tom={d.status === "approved" ? "green" : d.status === "pending" ? "amber" : "slate"}>{rotulo(d.status ?? "")}</Chip>
                    )}
                  </div>
                );
              })
            ) : (
              <Vazio texto="No documents on file." />
            )}
          </div>
        </Secao>
      ) : null}

      {aba === "arquivos" ? (
        <Secao titulo="Files from this chat">
          <Arquivos c={c} />
        </Secao>
      ) : null}
    </div>
  );
}

function PainelDoCliente({ c, online, onCriar }: { c: ConversaDaCaixa; online: boolean; onCriar: (t: TipoDoPrefill) => void }) {
  const [aba, setAba] = useState<AbaCliente>("cliente");
  const cl = c.cliente;
  const emAberto = c.faturas.filter((f) => f.valor - f.pago > 0.01);
  const tickets = [...new Map(c.jobs.filter((j) => j.ticket && /^\d+$/.test(j.ticket)).map((j) => [j.ticket!, j])).values()];
  const origem = cl?.origem ? rotulo(cl.origem) : null;
  const sub = [c.tipo === "conta" ? (cl ? "Client" : "Account contact") : c.tipo === "cliente" ? "Client" : "New client", c.org?.nome ?? cl?.conta ?? origem].filter(Boolean).join(" · ");

  const listaDeQuotes = (qs: typeof c.quotes) =>
    qs.length ? (
      <div className="space-y-2">
        {qs.map((q) => (
          <Link key={q.id} href={`/quotes?quoteId=${q.id}`} className="block rounded-xl border border-border-light px-3.5 py-2.5 hover:bg-surface-secondary/60">
            <span className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-text-primary">{q.ref}</span>
              <span className="ml-auto">{q.status ? <ChipDaEtapa e={{ grupo: "quote", status: q.status }} /> : null}</span>
            </span>
            {q.titulo ? <span className="block truncate text-[12.5px] text-text-secondary">{q.titulo}</span> : null}
            <span className="block text-[12px] text-text-tertiary">{libra.format(q.total)}</span>
          </Link>
        ))}
      </div>
    ) : (
      <Vazio texto="No quotes yet." />
    );

  const listaDeFaturas = (fs: typeof c.faturas, vazio: string) =>
    fs.length ? (
      <div className="space-y-2">
        {fs.map((f) => (
          <div key={f.id} className="rounded-xl border border-border-light px-3.5 py-2.5">
            <span className="flex items-center gap-2">
              <Receipt className="h-3.5 w-3.5 text-text-tertiary" />
              <span className="text-[13.5px] font-semibold text-text-primary">{f.ref}</span>
              <span className="ml-auto">
                <Chip tom={f.valor - f.pago <= 0.01 ? "green" : "amber"}>{f.valor - f.pago <= 0.01 ? "Paid" : `${libra.format(f.valor - f.pago)} due`}</Chip>
              </span>
            </span>
            <span className="block text-[12px] text-text-tertiary">
              {f.job ?? ""} · {libra.format(f.valor)}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <Vazio texto={vazio} />
    );

  const cartaoDeTicket = (j: JobDaCaixa) => (
    <a key={j.ticket} href={`${ZENDESK}${j.ticket}`} target="_blank" rel="noreferrer" className="block rounded-xl border border-border-light px-3.5 py-2.5 hover:bg-surface-secondary/60">
      <span className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-text-primary">#{j.ticket}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-text-tertiary">
          Open in Zendesk
          <ExternalLink className="h-3 w-3" />
        </span>
      </span>
      <span className="block truncate text-[12.5px] text-text-secondary">{j.titulo ?? j.ref}</span>
      <span className="block text-[12px] text-text-tertiary">From {j.ref}</span>
    </a>
  );

  return (
    <div>
      <Cabeca c={c} online={online} sub={sub}>
        <Acao icone={Briefcase} variante="primario" onClick={() => onCriar("job")}>
          Create job
        </Acao>
        <Acao icone={FileText} onClick={() => onCriar("quote")}>
          Create quote
        </Acao>
      </Cabeca>
      <Abas<AbaCliente>
        abas={[
          ["cliente", "Client"],
          ["jobs", "Jobs"],
          ["quotes", "Quotes"],
          ["faturas", "Invoices"],
          ["ticket", "Ticket"],
          ["arquivos", "Files"],
        ]}
        ativa={aba}
        onTroca={setAba}
      />

      {aba === "cliente" ? (
        <>
          {c.jobHoje ? (
            <Secao titulo="Today">
              <CartaoDeJob j={c.jobHoje} />
            </Secao>
          ) : null}
          <Secao titulo="Client" acao={cl ? <LinkDaSecao href={`/clients/${cl.id}`}>Edit</LinkDaSecao> : null}>
            <Campos>
              <Campo k="Name" v={cl?.nome || c.nome} />
              <Campo k="Phone" v={`+${c.contato}`} />
              <Campo k="Email" v={cl?.email ?? <span className="text-text-tertiary">Ask in chat</span>} />
              <Campo k="Address" v={cl?.endereco ?? "-"} />
              <Campo k="Postcode" v={cl?.postcode ?? "-"} />
              <Campo k="Account" v={cl?.conta ?? "Fixfy (direct)"} />
              <Campo k="Source" v={[origem, "WhatsApp"].filter(Boolean).join(" · ")} />
            </Campos>
          </Secao>
          <Secao titulo="Zendesk">{tickets[0] ? cartaoDeTicket(tickets[0]) : <Vazio texto="No Zendesk ticket linked yet." />}</Secao>
          <Secao titulo="Jobs" acao={c.jobs.length > 2 ? <button type="button" onClick={() => setAba("jobs")} className="text-xs font-medium text-[var(--info-ink)] hover:underline">All {c.jobs.length}</button> : null}>
            <div className="space-y-2">{c.jobs.length ? c.jobs.slice(0, 2).map((j) => <CartaoDeJob key={j.id} j={j} comData />) : <Vazio texto="No jobs yet. Create one from this chat." />}</div>
          </Secao>
          <Secao titulo="Quotes">{listaDeQuotes(c.quotes.slice(0, 2))}</Secao>
          <Secao titulo="Invoices">{listaDeFaturas(emAberto, "Nothing to pay.")}</Secao>
        </>
      ) : null}

      {aba === "jobs" ? (
        <JobsPorPeriodo key={c.contato} jobs={c.jobs} inicial="todos" vazio="No jobs yet. Create one from this chat." />
      ) : null}
      {aba === "quotes" ? <Secao titulo={`Quotes · ${c.quotes.length}`}>{listaDeQuotes(c.quotes)}</Secao> : null}
      {aba === "faturas" ? <Secao titulo={`Invoices · ${c.faturas.length}`}>{listaDeFaturas(c.faturas, "No invoices.")}</Secao> : null}
      {aba === "ticket" ? (
        <Secao titulo="Zendesk tickets">
          <div className="space-y-2">{tickets.length ? tickets.map(cartaoDeTicket) : <Vazio texto="No ticket linked to this client's jobs." />}</div>
        </Secao>
      ) : null}
      {aba === "arquivos" ? (
        <Secao titulo="Files from this chat">
          <Arquivos c={c} />
        </Secao>
      ) : null}
    </div>
  );
}

/** Número sem cadastro: vira cliente aqui, com o telefone da conversa. */
function NovoCliente({ c, online }: { c: ConversaDaCaixa; online: boolean }) {
  const [nome, setNome] = useState(c.perfil ?? "");
  const [email, setEmail] = useState("");
  const [endereco, setEndereco] = useState("");
  const [postcode, setPostcode] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) {
      toast.error("Add the client's name");
      return;
    }
    setSalvando(true);
    try {
      await createClient({
        full_name: nome.trim(),
        phone: `+${c.contato}`,
        email: email.trim() || undefined,
        address: endereco.trim() || undefined,
        postcode: postcode.trim().toUpperCase() || undefined,
        client_type: "residential",
        source: "direct",
        status: "active",
      });
      toast.success("Client added. They move to Clients after their first job.");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the client");
    } finally {
      setSalvando(false);
    }
  }

  const campo = "w-full rounded-lg border border-border-light bg-card px-2.5 py-2 text-xs text-text-primary placeholder:text-text-tertiary";
  return (
    <div>
      <Cabeca c={c} online={online} />
      <Secao titulo="Not a client yet">
        <p className="mb-3 text-xs text-text-secondary">
          This inbox is for clients and partners. Sales and B2B stay in Zendesk. If this person already booked with us, add them here.
        </p>
        <div className="space-y-2">
          <input className={campo} placeholder="Full name" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className={campo} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={campo} placeholder="Address" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          <input className={campo} placeholder="Postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
          <p className="text-[11px] text-text-tertiary">Phone: +{c.contato}</p>
          <Acao icone={UserPlus} variante="primario" onClick={() => void salvar()} disabled={salvando} className="w-full">
            Add as client
          </Acao>
        </div>
      </Secao>
    </div>
  );
}

/** Oferecer um job sem parceiro a quem está na conversa: o assign do Jobs, e a mensagem aqui. */
export function OfertaDeJob({
  c,
  jobs,
  onFechar,
  onEnviado,
}: {
  c: ConversaDaCaixa;
  jobs: JobParaOferecer[];
  onFechar: () => void;
  onEnviado: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<JobParaOferecer | null>(null);
  const [mandarAqui, setMandarAqui] = useState(true);
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => [j.ref, j.titulo ?? "", j.endereco ?? "", j.cliente ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [jobs, busca]);
  const primeiro = c.nome.startsWith("+") ? "there" : c.nome.split(" ")[0];

  async function avisarAqui(j: JobParaOferecer, custo: number | null) {
    const linhas = [
      `Hi ${primeiro}, you have a new job: ${j.ref}`,
      j.titulo ?? "",
      `${dia(j.data)}${j.inicio ? ` at ${horaCurta(j.inicio)}` : ""}`,
      j.endereco ?? "",
      custo ? `Your pay: ${libra.format(custo)}${j.porHora ? " per hour" : ""}` : "",
      "",
      "Full details are in the Fixfy app and in your email. Reply here if anything is unclear.",
    ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
    const res = await fetch("/api/inbox/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contato: c.contato, texto: linhas.join("\n") }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <Send className="h-4 w-4 text-text-primary" />
        <p className="flex-1 text-[15px] font-semibold text-text-primary">Offer a job to {primeiro}</p>
        <button type="button" onClick={onFechar} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2 border-b border-border-light px-4 py-3 text-xs">
        <p className="rounded-lg bg-info-light px-3 py-2 text-[var(--info-ink)]">
          Same as assigning in Jobs: the job is booked to {primeiro}, who gets the email, the app push and the Zendesk note on the ticket.
        </p>
        <label className="flex items-center gap-2 text-text-secondary">
          <input type="checkbox" checked={mandarAqui} onChange={(e) => setMandarAqui(e.target.checked)} />
          Also send the job here on WhatsApp
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-tertiary" />
          <input
            className="w-full rounded-lg border border-border-light bg-card py-2 pl-8 pr-2.5 text-xs text-text-primary placeholder:text-text-tertiary"
            placeholder="Search ref, address, client"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {lista.length === 0 ? <Vazio texto="No unassigned jobs." /> : null}
        {lista.map((j) => (
          <div key={j.id} className="rounded-lg border border-border-light px-3 py-2">
            <div className="flex items-center gap-2">
              <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-text-primary hover:underline">
                {j.ref}
              </Link>
              {j.custoParceiro ? (
                <span className="ml-auto text-[11px] font-medium text-text-secondary">
                  {libra.format(j.custoParceiro)}
                  {j.porHora ? "/h" : ""}
                </span>
              ) : null}
            </div>
            {j.titulo ? <p className="truncate text-xs text-text-secondary">{j.titulo}</p> : null}
            <p className="flex items-center gap-1 text-[11px] text-text-tertiary">
              <CalendarClock className="h-3 w-3" />
              {dia(j.data)}
              {j.inicio ? ` · ${horaCurta(j.inicio)}` : ""}
            </p>
            {j.endereco ? (
              <p className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{j.endereco}</span>
              </p>
            ) : null}
            {j.cliente ? (
              <p className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
                <Home className="h-3 w-3 shrink-0" />
                {j.cliente}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Acao icone={Send} variante="primario" onClick={() => setEscolhido(j)}>
                Offer to {primeiro}
              </Acao>
            </div>
          </div>
        ))}
      </div>
      {escolhido && c.parceiro ? (
        <AssignPartnerModal
          jobId={escolhido.id}
          jobReference={escolhido.ref}
          isOpen
          initialPartnerId={c.parceiro.id}
          onClose={() => setEscolhido(null)}
          onAssigned={async (atualizado) => {
            const j = escolhido;
            setEscolhido(null);
            if (mandarAqui) {
              const porHora = atualizado.job_type === "hourly";
              const custo = Number(porHora ? atualizado.hourly_partner_rate : atualizado.partner_cost);
              try {
                await avisarAqui({ ...j, porHora }, Number.isFinite(custo) && custo > 0 ? custo : null);
              } catch (e) {
                toast.error(e instanceof Error ? `Assigned, but the WhatsApp failed: ${e.message}` : "Job assigned. The WhatsApp message failed");
              }
            }
            toast.success(`${j.ref} assigned to ${primeiro}`);
            onEnviado();
          }}
        />
      ) : null}
    </div>
  );
}

export function GavetaDeCriar({
  tipo,
  c,
  scope,
  setScope,
  endereco,
  setEndereco,
  marcadas,
  onFechar,
  onContinuar,
}: {
  tipo: TipoDoPrefill;
  c: ConversaDaCaixa;
  scope: string;
  setScope: (v: string) => void;
  endereco: string;
  setEndereco: (v: string) => void;
  marcadas: number;
  onFechar: () => void;
  onContinuar: () => void;
}) {
  const ticket = ticketDe(c);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        {tipo === "job" ? <Briefcase className="h-4 w-4 text-text-primary" /> : <FileText className="h-4 w-4 text-text-primary" />}
        <p className="flex-1 text-[15px] font-semibold text-text-primary">{tipo === "job" ? "New job from this chat" : "New quote from this chat"}</p>
        <button type="button" onClick={onFechar} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
        <p className="rounded-lg bg-info-light px-3 py-2 text-[var(--info-ink)]">
          {tipo === "job"
            ? "Check what the chat gave us, then continue in the job form for service, date, price and partner. Price never goes in the scope."
            : "Bespoke work goes by quote. Standard handyman work can be booked as a job at £72/h."}
        </p>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Client</p>
          <p className="rounded-lg border border-border-light px-2.5 py-2 text-text-primary">
            {c.cliente?.nome || c.nome} · +{c.contato}
            {c.cliente ? null : <span className="block text-[11px] text-text-tertiary">New client: the form creates it.</span>}
          </p>
        </div>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Property address</p>
          <input
            className="w-full rounded-lg border border-border-light bg-card px-2.5 py-2 text-xs text-text-primary placeholder:text-text-tertiary"
            placeholder="Flat 3, 22 Latchmere Road, SW11 5QT"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
          />
        </div>
        <div>
          <p className="mb-1 flex justify-between font-medium text-text-secondary">
            Scope (for the partner)
            <span className="font-normal text-text-tertiary">
              {marcadas} message{marcadas === 1 ? "" : "s"} picked
            </span>
          </p>
          <textarea
            className="min-h-[120px] w-full rounded-lg border border-border-light bg-card px-2.5 py-2 text-xs leading-relaxed text-text-primary"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-text-tertiary">Click messages in the chat to add or remove them.</p>
        </div>
        <div>
          <p className="mb-1 font-medium text-text-secondary">Zendesk ticket</p>
          <p className="rounded-lg border border-border-light px-2.5 py-2 text-text-primary">{ticket ? `#${ticket} · from the latest job` : "Pick or create one in the form"}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3">
        <Acao variante="fantasma" onClick={onFechar}>
          Cancel
        </Acao>
        <Acao variante="primario" icone={tipo === "job" ? Briefcase : FileText} onClick={onContinuar}>
          {tipo === "job" ? "Continue to job form" : "Continue to quote form"}
        </Acao>
      </div>
    </div>
  );
}

type ParceiroDaCaixa = NonNullable<ConversaDaCaixa["parceiro"]>;

/** Ofícios e onde atende, no formato que o cadastro guarda (raio, postcodes ou regiões). */
function Cobertura({ p }: { p: ParceiroDaCaixa }) {
  const cob = p.cobertura;
  const lugares = [...cob.postcodes, ...cob.regioes, ...cob.cidades.map((c) => c.replace(/\b\w/g, (l) => l.toUpperCase()))];
  const raio = cob.raioMilhas ? `${cob.raioMilhas} mi${cob.base ? ` from ${cob.base}` : ""}` : cob.base ? `From ${cob.base}` : null;
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[11.5px] text-text-tertiary">Trades</p>
        {p.oficios.length ? (
          <span className="flex flex-wrap gap-1">
            {p.oficios.map((t, i) => (
              <Chip key={t} tom={i ? "slate" : "blue"}>
                {t}
              </Chip>
            ))}
          </span>
        ) : (
          <Vazio texto="No trade on file." />
        )}
      </div>
      <div>
        <p className="mb-1.5 text-[11.5px] text-text-tertiary">Coverage</p>
        {raio || lugares.length ? (
          <span className="flex flex-wrap gap-1">
            {raio ? <Chip icone={MapPin}>{raio}</Chip> : null}
            {lugares.slice(0, 12).map((l) => (
              <Chip key={l}>{l}</Chip>
            ))}
            {lugares.length > 12 ? <Chip>+{lugares.length - 12}</Chip> : null}
          </span>
        ) : (
          <Vazio texto="No coverage on file." />
        )}
      </div>
    </div>
  );
}

/** O self-bill em aberto e os últimos, com o PDF e o envio ao parceiro (e-mail com o PDF, como no Finance). */
function SelfBillsDoParceiro({ p }: { p: ParceiroDaCaixa }) {
  const sb = p.selfBill;
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [enviados, setEnviados] = useState<Record<string, string>>({});

  async function enviar(b: SelfBillDaCaixa) {
    if (confirmar !== b.id) {
      setConfirmar(b.id);
      return;
    }
    setConfirmar(null);
    setEnviando(b.id);
    try {
      const r = await fetch("/api/self-bills/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfBillIds: [b.id] }),
      });
      const j = (await r.json().catch(() => ({}))) as { sent?: number; skipped?: { reason: string }[]; error?: string };
      if (!r.ok || !j.sent) throw new Error(j.skipped?.[0]?.reason ?? j.error ?? "Not sent");
      setEnviados((e) => ({ ...e, [b.id]: new Date().toISOString() }));
      toast.success(`${b.ref} sent to ${p.email ?? "the partner"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not sent");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <>
      <Secao titulo="Open self-bill" acao={<LinkDaSecao href="/finance/selfbill" />}>
        {sb ? (
          <Campos>
            <Campo k="Reference" v={sb.ref} />
            <Campo k="Period" v={sb.semana ?? "-"} />
            <Campo k="To pay" v={libra.format(sb.valor)} />
            <Campo k="Jobs" v={sb.jobs} />
            <Campo k="Payday" v={sb.vence ? dia(sb.vence) : "-"} />
            <Campo k="Status" v={rotulo(sb.status)} />
          </Campos>
        ) : (
          <Vazio texto="Nothing open for this partner." />
        )}
      </Secao>
      <Secao titulo={`Statements · ${p.selfBills.length}`}>
        <div className="space-y-1.5">
          {p.selfBills.length ? (
            p.selfBills.map((b) => {
              const enviadoEm = enviados[b.id] ?? b.enviadoEm;
              return (
                <div key={b.id} className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2 text-[13px]">
                  <Receipt className="h-4 w-4 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text-primary">
                      {b.ref} · {libra.format(b.valor)}
                    </span>
                    <span className="block truncate text-[11px] text-text-tertiary">
                      {[b.semana, rotulo(b.status), enviadoEm ? `Sent ${dia(enviadoEm.slice(0, 10))}` : "Not sent"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <a
                    href={`/api/self-bills/${b.id}/pdf?inline=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-7 shrink-0 place-items-center rounded-md px-2 text-[11.5px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                  >
                    PDF
                  </a>
                  <button
                    type="button"
                    disabled={!!enviando || !p.email}
                    title={p.email ? `Email the PDF to ${p.email}` : "No email on file"}
                    onClick={() => void enviar(b)}
                    onBlur={() => setConfirmar((c) => (c === b.id ? null : c))}
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors disabled:opacity-45",
                      confirmar === b.id ? "bg-primary text-[var(--on-brand)]" : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
                    )}
                  >
                    <Send className="h-3 w-3" />
                    {enviando === b.id ? "Sending..." : confirmar === b.id ? "Confirm" : enviadoEm ? "Resend" : "Send"}
                  </button>
                </div>
              );
            })
          ) : (
            <Vazio texto="No self-bill yet." />
          )}
        </div>
      </Secao>
    </>
  );
}

/**
 * Grupo: quem falou nele (o WhatsApp não manda a lista de membros com a
 * mensagem). Cada um abre a conversa particular, como o "responder no
 * particular" do VOS.
 */
function PainelDoGrupo({ c, onAbrirContato }: { c: ConversaDaCaixa; onAbrirContato?: (numero: string, nome: string) => void }) {
  const pessoas = useMemo(() => {
    const porChave = new Map<string, { numero: string | null; nome: string | null; n: number; ultima: string }>();
    for (const m of c.mensagens) {
      if (!m.autor) continue;
      const chave = m.autor.numero ?? m.autor.nome ?? "";
      const atual = porChave.get(chave);
      porChave.set(chave, { numero: m.autor.numero, nome: m.autor.nome ?? atual?.nome ?? null, n: (atual?.n ?? 0) + 1, ultima: m.criadoEm });
    }
    return [...porChave.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
  }, [c.mensagens]);

  return (
    <>
      <Cabeca c={c} online={false} sub={`WhatsApp group · ${pessoas.length} ${pessoas.length === 1 ? "person" : "people"} talking`} />
      <Secao titulo="People in this chat">
        {pessoas.length ? (
          <div className="space-y-1">
            {pessoas.map((p) => (
              <div key={p.numero ?? p.nome} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-secondary text-[11.5px] font-semibold", corDoAutor(p.numero ?? p.nome ?? ""))}>
                  {(p.nome ?? "#").trim().slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text-primary">{nomeDoAutor(p)}</span>
                  <span className="block truncate text-[11.5px] text-text-tertiary">
                    {[p.numero && p.nome ? `+${p.numero}` : null, `${p.n} message${p.n === 1 ? "" : "s"}`, `last ${dia(p.ultima.slice(0, 10))}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {p.numero && onAbrirContato ? (
                  <button
                    type="button"
                    onClick={() => onAbrirContato(p.numero!, nomeDoAutor(p))}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                    title="Reply privately"
                  >
                    <Send className="h-3 w-3" />
                    Private
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Vazio texto="Nobody has written here yet." />
        )}
      </Secao>
    </>
  );
}
