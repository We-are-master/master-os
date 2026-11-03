"use client";

/**
 * A coluna da direita da /inbox: quem está falando e o que a operação sabe
 * dele. Parceiro: o job de hoje, os próximos e "Offer job" (o mesmo assign do
 * Jobs, com e-mail e Zendesk). Cliente: a etapa em que ele está, jobs,
 * cotações e faturas. Número sem cadastro: "Add as client".
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Briefcase,
  CalendarClock,
  ExternalLink,
  FileText,
  Home,
  MapPin,
  Receipt,
  Search,
  Send,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { AssignPartnerModal } from "@/components/jobs/assign-partner-modal";
import { createClient } from "@/services/clients";
import type { TipoDoPrefill } from "@/lib/inbox/prefill";
import { cn } from "@/lib/utils";
import { Acao, Avatar, Chip, ChipDaEtapa, ChipDoTipo } from "./ui";
import type { ConversaDaCaixa, JobDaCaixa, JobParaOferecer } from "./tipos";

export const ZENDESK = "https://fixfy.zendesk.com/agent/tickets/";
const libra = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
export const dia = (data: string | null) =>
  data ? new Date(`${data}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "No date";
const rotulo = (s: string) => (s ? s.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase()) : "");
export const ticketDe = (c: ConversaDaCaixa) => c.jobs.map((j) => j.ticket).find((t) => t && /^\d+$/.test(t)) ?? null;

type Aba = "info" | "jobs" | "quotes" | "faturas";

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-light px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{titulo}</p>
        {acao}
      </div>
      {children}
    </div>
  );
}

function Campo({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary">{k}</dt>
      <dd className="min-w-0 break-words text-text-primary">{v}</dd>
    </>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="text-xs text-text-tertiary">{texto}</p>;

export function CartaoDeJob({ j, mostrarParceiro = true, destaque = false }: { j: JobDaCaixa; mostrarParceiro?: boolean; destaque?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", destaque ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30" : "border-border-light")}>
      <div className="flex items-center gap-2">
        <Link href={`/jobs/${j.id}`} className="text-xs font-semibold text-text-primary hover:underline">
          {j.ref}
        </Link>
        <span className="ml-auto">{j.status ? <ChipDaEtapa e={{ grupo: "job", status: j.status }} /> : null}</span>
      </div>
      {j.titulo ? <p className="truncate text-xs text-text-secondary">{j.titulo}</p> : null}
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-tertiary">
        <CalendarClock className="h-3 w-3" />
        {dia(j.data)}
        {j.inicio ? ` · ${horaCurta(j.inicio)}` : ""}
        {mostrarParceiro && j.parceiro ? ` · ${j.parceiro}` : ""}
      </p>
      {j.endereco ? (
        <p className="flex items-center gap-1 truncate text-[11px] text-text-tertiary">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{j.endereco}</span>
        </p>
      ) : null}
      {j.ticket && /^\d+$/.test(j.ticket) ? (
        <a className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-primary hover:underline" href={`${ZENDESK}${j.ticket}`} target="_blank" rel="noreferrer">
          Ticket #{j.ticket}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function Cabeca({ c, online, children }: { c: ConversaDaCaixa; online: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center border-b border-border-light px-4 pb-4 pt-5 text-center">
      <Avatar c={c} grande online={online} />
      <p className="mt-2 text-[15px] font-semibold text-text-primary">{c.nome}</p>
      <p className="text-xs text-text-tertiary">+{c.contato}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-1">
        <ChipDoTipo c={c} />
        {c.parceiro?.oficio ? <Chip icone={Wrench}>{c.parceiro.oficio}</Chip> : null}
        {c.cliente?.conta ? <Chip icone={Briefcase}>{c.cliente.conta}</Chip> : null}
        {c.etapa ? <ChipDaEtapa e={c.etapa} /> : null}
      </div>
      {children ? <div className="mt-3 flex w-full justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Painel({
  c,
  online,
  onCriar,
  onOferecer,
}: {
  c: ConversaDaCaixa;
  online: boolean;
  onCriar: (t: TipoDoPrefill) => void;
  onOferecer: () => void;
}) {
  const [aba, setAba] = useState<Aba>("info");

  if (c.tipo === "parceiro") {
    const hojeDele = c.jobHoje ? c.jobs.filter((j) => j.data === c.jobHoje!.data) : [];
    const proximos = c.jobs.filter((j) => !hojeDele.includes(j));
    return (
      <div>
        <Cabeca c={c} online={online}>
          <Acao icone={Send} variante="primario" onClick={onOferecer}>
            Offer job
          </Acao>
          {c.parceiro ? (
            <Link href={`/partners/${c.parceiro.id}`}>
              <Acao icone={ExternalLink}>Open partner</Acao>
            </Link>
          ) : null}
        </Cabeca>
        <Secao titulo="Today's route">
          <div className="space-y-2">
            {hojeDele.length ? hojeDele.map((j, i) => <CartaoDeJob key={j.id} j={j} mostrarParceiro={false} destaque={i === 0} />) : <Vazio texto="No job today." />}
          </div>
        </Secao>
        <Secao titulo={`Upcoming · ${proximos.length}`}>
          <div className="space-y-2">{proximos.length ? proximos.map((j) => <CartaoDeJob key={j.id} j={j} mostrarParceiro={false} />) : <Vazio texto="Nothing else booked." />}</div>
        </Secao>
        <Secao titulo="Partner">
          <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1.5 text-xs">
            <Campo k="Company" v={c.parceiro?.empresa ?? "-"} />
            <Campo k="Trade" v={c.parceiro?.oficio ?? "-"} />
            <Campo k="Email" v={c.parceiro?.email ?? "-"} />
            <Campo k="Status" v={c.parceiro?.status ? rotulo(c.parceiro.status) : "-"} />
            {c.perfil ? <Campo k="WhatsApp" v={c.perfil} /> : null}
          </dl>
        </Secao>
      </div>
    );
  }

  if (c.tipo === "outro" && !c.cliente) return <NovoCliente c={c} online={online} />;

  const abas: [Aba, string, number | null][] = [
    ["info", "Client", null],
    ["jobs", "Jobs", c.jobs.length],
    ["quotes", "Quotes", c.quotes.length],
    ["faturas", "Invoices", c.faturas.length],
  ];
  const emAberto = c.faturas.filter((f) => f.valor - f.pago > 0.01);
  return (
    <div>
      <Cabeca c={c} online={online}>
        <Acao icone={Briefcase} variante="primario" onClick={() => onCriar("job")}>
          Create job
        </Acao>
        <Acao icone={FileText} onClick={() => onCriar("quote")}>
          Create quote
        </Acao>
      </Cabeca>

      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-2">
        {abas.map(([k, t, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={cn(
              "whitespace-nowrap border-b-2 px-2 py-2.5 text-xs font-medium",
              aba === k ? "border-text-primary text-text-primary" : "border-transparent text-text-tertiary hover:text-text-secondary",
            )}
          >
            {t}
            {n ? <span className="ml-1 text-text-tertiary">{n}</span> : null}
          </button>
        ))}
      </div>

      {aba === "info" ? (
        <>
          {c.jobHoje ? (
            <Secao titulo="Today">
              <CartaoDeJob j={c.jobHoje} destaque />
            </Secao>
          ) : null}
          <Secao titulo="Where they are">
            {c.etapa ? (
              <div className="flex items-center gap-2 text-xs">
                <ChipDaEtapa e={c.etapa} />
                <Link href={c.etapa.grupo === "job" ? `/jobs/${c.etapa.id}` : `/quotes?quoteId=${c.etapa.id}`} className="font-medium text-text-primary hover:underline">
                  {c.etapa.ref}
                </Link>
              </div>
            ) : (
              <Vazio texto="No job or quote yet." />
            )}
          </Secao>
          <Secao titulo="Client" acao={c.cliente ? <Link href={`/clients/${c.cliente.id}`} className="text-xs text-text-primary hover:underline">Open</Link> : null}>
            {c.cliente ? (
              <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1.5 text-xs">
                <Campo k="Name" v={c.cliente.nome} />
                <Campo k="Email" v={c.cliente.email ?? <span className="text-text-tertiary">Ask in chat</span>} />
                <Campo k="Address" v={c.cliente.endereco ?? "-"} />
                <Campo k="Postcode" v={c.cliente.postcode ?? "-"} />
                <Campo k="Account" v={c.cliente.conta ?? "Fixfy direct"} />
                {c.perfil ? <Campo k="WhatsApp" v={c.perfil} /> : null}
              </dl>
            ) : null}
          </Secao>
          <Secao titulo="Open invoices">
            {emAberto.length ? (
              <div className="space-y-1.5">
                {emAberto.map((f) => (
                  <div key={f.id} className="flex items-center justify-between text-xs">
                    <span className="text-text-primary">{f.ref}</span>
                    <span className="text-text-secondary">{libra.format(f.valor - f.pago)} due</span>
                  </div>
                ))}
              </div>
            ) : (
              <Vazio texto="Nothing to pay." />
            )}
          </Secao>
        </>
      ) : null}

      {aba === "jobs" ? <div className="space-y-2 p-4">{c.jobs.length ? c.jobs.map((j) => <CartaoDeJob key={j.id} j={j} />) : <Vazio texto="No jobs." />}</div> : null}

      {aba === "quotes" ? (
        <div className="space-y-2 p-4">
          {c.quotes.length ? (
            c.quotes.map((q) => (
              <Link key={q.id} href={`/quotes?quoteId=${q.id}`} className="block rounded-lg border border-border-light px-3 py-2 hover:bg-surface-secondary/60">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{q.ref}</span>
                  <span className="ml-auto">{q.status ? <ChipDaEtapa e={{ grupo: "quote", status: q.status }} /> : null}</span>
                </span>
                {q.titulo ? <span className="block truncate text-xs text-text-secondary">{q.titulo}</span> : null}
                <span className="block text-[11px] text-text-tertiary">{libra.format(q.total)}</span>
              </Link>
            ))
          ) : (
            <Vazio texto="No quotes." />
          )}
        </div>
      ) : null}

      {aba === "faturas" ? (
        <div className="space-y-2 p-4">
          {c.faturas.length ? (
            c.faturas.map((f) => (
              <div key={f.id} className="rounded-lg border border-border-light px-3 py-2">
                <span className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-xs font-semibold text-text-primary">{f.ref}</span>
                  <span className="ml-auto">
                    <Chip tom={f.valor - f.pago <= 0.01 ? "green" : "amber"}>{rotulo(f.status)}</Chip>
                  </span>
                </span>
                <span className="block text-[11px] text-text-tertiary">
                  {f.job ?? ""} · {libra.format(f.valor)}
                  {f.pago > 0.01 ? ` · ${libra.format(f.pago)} paid` : ""}
                </span>
              </div>
            ))
          ) : (
            <Vazio texto="No invoices." />
          )}
        </div>
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
                toast.error(e instanceof Error ? `Assigned, but the WhatsApp failed: ${e.message}` : "Assigned, but the WhatsApp failed");
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
