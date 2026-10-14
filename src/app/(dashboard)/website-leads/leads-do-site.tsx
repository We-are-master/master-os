"use client";

/**
 * A aba Leads: quem começou a reservar no site e não pagou. Só a lista.
 *
 * Mesmo molde de Quotes e Jobs (PageHeader, abas com contagem, busca,
 * DataTable e o Drawer com abas), para quem opera não trocar de gramática
 * entre as telas. Os números e o gráfico moram na Leads Room do office
 * virtual (dono, 24/09: "pra o OS não ficar carregado à toa"). Quem pagou vira
 * cliente e sai da lista. Texto de tela em inglês, como o resto do OS, e sem
 * travessão (vazio é "·").
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Mail, Phone, MessageCircle, ExternalLink, Plus, Upload, SquareKanban, List, CalendarClock } from "lucide-react";
import { PageHeader, PageToolbar } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rotuloCanal, type Canal, type CanalDef } from "@/lib/site-leads/manual";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { LadoToggle } from "@/components/leads/lado-toggle";
import { HistoricoDoLead } from "@/components/leads/historico-do-lead";
import { AdicionarLead, ImportarLeads } from "./adicionar-leads";

export type AtividadeDaTela = {
  id: string;
  at: string;
  kind: string;
  detail: string;
  opened_at: string | null;
  clicked_at: string | null;
};

export type LeadDaTela = {
  id: string;
  created_at: string;
  last_activity_at: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  postcode: string | null;
  service_label: string | null;
  price: number | null;
  resume_url: string | null;
  source: Record<string, string> | null;
  channel: Canal;
  notes: string | null;
  tags: string[] | null;
  step_reached: number;
  status: "new" | "hot" | "contacted" | "won" | "lost" | "unsubscribed";
  lost_reason: string | null;
  sequence_state: "scheduled" | "paused" | "stopped" | "done" | "none";
  email1_due_at: string | null;
  email2_due_at: string | null;
  email3_due_at: string | null;
  email1_sent_at: string | null;
  email2_sent_at: string | null;
  email3_sent_at: string | null;
  /** Cliente do OS, quando o lead já foi casado com um (histórico e reputação na ficha). */
  client_id?: string | null;
  /** 302: o quarto toque, o ticket do lead e a resposta do cliente. */
  whatsapp_due_at?: string | null;
  whatsapp_sent_at?: string | null;
  zendesk_ticket_id?: number | null;
  replied_at?: string | null;
  promo_code: string | null;
  won_at: string | null;
  booking_ref: string | null;
  atividades: AtividadeDaTela[];
};

const ESTADO: Record<LeadDaTela["status"], { rotulo: string; badge: BadgeVariant }> = {
  new: { rotulo: "New", badge: "info" },
  hot: { rotulo: "Hot", badge: "orange" },
  contacted: { rotulo: "In contact", badge: "warning" },
  won: { rotulo: "Customer", badge: "success" },
  lost: { rotulo: "Lost", badge: "danger" },
  unsubscribed: { rotulo: "Opted out", badge: "default" },
};

const ABAS = [
  { id: "open", label: "Open", filtro: (l: LeadDaTela) => ["new", "hot", "contacted"].includes(l.status) },
  { id: "hot", label: "Hot", filtro: (l: LeadDaTela) => l.status === "hot" },
  { id: "contacted", label: "In contact", filtro: (l: LeadDaTela) => l.status === "contacted" },
  { id: "lost", label: "Lost", filtro: (l: LeadDaTela) => l.status === "lost" || l.status === "unsubscribed" },
  { id: "all", label: "All", filtro: (l: LeadDaTela) => l.status !== "won" },
] as const;

/** As colunas do quadro, na ordem do funil. "Customer" mostra quem pagou nos últimos 30 dias. */
const COLUNAS: Array<{ id: LeadDaTela["status"]; titulo: string; cor: string }> = [
  { id: "new", titulo: "New", cor: "#3B82F6" },
  { id: "hot", titulo: "Hot", cor: "#ED4B00" },
  { id: "contacted", titulo: "In contact", cor: "#D97706" },
  { id: "won", titulo: "Customer", cor: "#16A34A" },
  { id: "lost", titulo: "Lost", cor: "#9CA3AF" },
];
const VISAO_KEY = "fixfy-leads-b2c-view";

const PASSOS = ["Your job", "Details", "Date and access", "Checkout"];
const MOTIVOS = ["Price", "Date not available", "Outside our area", "Just researching", "No reply", "Booked elsewhere", "Other"];
const VAZIO = "·";

/** Link com cara de botão outline (botão dentro de <a> é HTML inválido). */
const LINK_ACAO =
  "inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border-[0.5px] border-[var(--line-2)] bg-white px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm transition-colors hover:bg-surface-hover dark:border-border dark:bg-card dark:text-text-primary";

const libras = (v: number | null) => (v == null ? VAZIO : `£${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);

function quando(iso: string | null): string {
  if (!iso) return VAZIO;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Origem do lead: o canal por onde chegou e, quando tem, a campanha e o cartão do anúncio. */
function origem(l: LeadDaTela, canais: CanalDef[]): { linha: string; detalhe: string } {
  const s = l.source ?? {};
  const canal = rotuloCanal(l.channel, canais);
  if (s.utm_source === "meta") return { linha: `${canal} · Meta ads`, detalhe: [s.utm_campaign, s.utm_content].filter(Boolean).join(" · ") };
  if (s.utm_source) return { linha: `${canal} · ${s.utm_source}`, detalhe: [s.utm_campaign, s.utm_content].filter(Boolean).join(" · ") };
  if (s.utm_campaign) return { linha: canal, detalhe: s.utm_campaign };
  return { linha: l.channel === "website" ? "Website · direct" : canal, detalhe: "" };
}

function sequencia(l: LeadDaTela): string {
  if (l.status === "won") {
    return l.whatsapp_sent_at
      ? "Recovered by WhatsApp"
      : l.email3_sent_at ? "Recovered by email 3" : l.email2_sent_at ? "Recovered by email 2" : l.email1_sent_at ? "Recovered by email 1" : "Paid, no email";
  }
  if (l.replied_at && l.sequence_state !== "scheduled") return `Replied ${quando(l.replied_at)}`;
  if (l.sequence_state === "paused") return "Paused (in contact)";
  if (l.sequence_state === "stopped") return "Stopped";
  if (l.sequence_state === "done") return l.whatsapp_sent_at ? "4 of 4 sent" : "3 of 3 sent";
  if (l.sequence_state === "none") return "No automatic flow yet";
  const [nome, hora] = !l.email1_sent_at
    ? ["Email 1", l.email1_due_at]
    : !l.email2_sent_at
      ? ["Email 2", l.email2_due_at]
      : !l.email3_sent_at || !l.whatsapp_due_at
        ? ["Email 3", l.email3_due_at]
        : ["WhatsApp", l.whatsapp_due_at ?? null];
  return `${nome} · ${quando(hora)}`;
}

/** O ticket do lead no Zendesk (o mesmo subdomínio padrão do selo de ticket do OS). */
function linkDoTicket(id: number): string {
  return `https://${process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN || "fixfy"}.zendesk.com/agent/tickets/${id}`;
}

function linhaEmail(enviado: string | null, agendado: string | null): string {
  if (enviado) return `Sent ${quando(enviado)}`;
  if (agendado) return `Scheduled ${quando(agendado)}`;
  return VAZIO;
}

function whatsappDe(tel: string): string {
  const d = tel.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("0") ? `44${d.slice(1)}` : d}`;
}

export function LeadsDoSite({ leads, canais, exemplo = false }: { leads: LeadDaTela[]; canais: CanalDef[]; exemplo?: boolean }) {
  const router = useRouter();
  const [aba, setAba] = useState<string>("open");
  const [busca, setBusca] = useState("");
  const [canal, setCanal] = useState<"all" | Canal>("all");
  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [abaDoLead, setAbaDoLead] = useState("overview");
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [visao, setVisao] = useState<"list" | "board">("board");
  const [movendo, setMovendo] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    try { const v = localStorage.getItem(VISAO_KEY); if (v === "list" || v === "board") setVisao(v); } catch { /* sem storage, fica o padrão */ }
  }, []);
  function trocarVisao(v: "list" | "board") {
    setVisao(v);
    try { localStorage.setItem(VISAO_KEY, v); } catch { /* idem */ }
  }

  const abas = useMemo(() => ABAS.map((a) => ({ id: a.id, label: a.label, count: leads.filter(a.filtro).length })), [leads]);

  const lista = useMemo(() => {
    const filtro = ABAS.find((a) => a.id === aba)?.filtro ?? ABAS[0].filtro;
    const q = busca.trim().toLowerCase();
    return leads
      .filter(filtro)
      .filter((l) => canal === "all" || (l.channel ?? "website") === canal)
      .filter((l) => !q || [l.full_name, l.email, l.postcode, l.service_label, l.phone, l.notes, ...(l.tags ?? [])].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [leads, aba, busca, canal]);

  const aberto = leads.find((l) => l.id === abertoId) ?? null;

  /** O resumo ao lado do título, como "N companies · M won" no lado B2B. */
  const resumo = useMemo(() => {
    const abertosAgora = leads.filter((l) => ["new", "hot", "contacted"].includes(l.status));
    return {
      abertos: abertosAgora.length,
      clientes: leads.filter((l) => l.status === "won").length,
      valorAberto: abertosAgora.reduce((t, l) => t + Number(l.price ?? 0), 0),
    };
  }, [leads]);

  /** O quadro ignora as abas (cada coluna já é um estado) e respeita origem e busca. */
  const colunasDoQuadro = useMemo<KanbanColumn<LeadDaTela>[]>(() => {
    const q = busca.trim().toLowerCase();
    const visiveis = leads
      .filter((l) => canal === "all" || (l.channel ?? "website") === canal)
      .filter((l) => !q || [l.full_name, l.email, l.postcode, l.service_label, l.phone, l.notes, ...(l.tags ?? [])].some((v) => (v ?? "").toLowerCase().includes(q)));
    return COLUNAS.map((c) => {
      const itens = visiveis.filter((l) => (c.id === "lost" ? l.status === "lost" || l.status === "unsubscribed" : l.status === c.id));
      const soma = itens.reduce((t, l) => t + Number(l.price ?? 0), 0);
      return { id: c.id, title: c.titulo, color: c.cor, items: itens, meta: soma > 0 ? libras(soma) : undefined };
    });
  }, [leads, busca, canal]);

  /** Arrastar no quadro: muda o estado. "Lost" pede o motivo na ficha; "Customer" só o pagamento marca. */
  async function soltar(l: LeadDaTela, para: string) {
    setAviso("");
    if (para === l.status || (para === "lost" && l.status === "unsubscribed")) return;
    if (para === "won") { setAviso("A lead becomes a customer when the booking is paid, not by moving the card."); return; }
    if (l.status === "won") { setAviso("This lead already paid: it stays in Customer."); return; }
    if (para === "lost") { setAbertoId(l.id); setAbaDoLead("overview"); setAviso("Pick the reason and press Mark lost."); return; }
    setMovendo((m) => new Set(m).add(l.id));
    try {
      const r = await fetch(`/api/site-leads/${l.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: para }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Error ${r.status}`);
      router.refresh();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Not moved. Try again.");
    } finally {
      setMovendo((m) => { const n = new Set(m); n.delete(l.id); return n; });
    }
  }

  async function agir(corpo: Record<string, string>) {
    if (!aberto) return;
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch(`/api/site-leads/${aberto.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Error ${r.status}`);
      if (corpo.note) setNota("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Not saved. Try again.");
    } finally {
      setSalvando(false);
    }
  }

  const colunas: Column<LeadDaTela>[] = [
    {
      key: "lead",
      label: "Lead",
      render: (l) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">{l.full_name || l.email}</p>
          <p className="truncate text-xs text-text-tertiary">{[l.postcode, quando(l.last_activity_at)].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    {
      key: "service",
      label: "Service",
      render: (l) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-text-primary first-letter:uppercase">{l.service_label ?? VAZIO}</p>
          <p className="text-xs text-text-tertiary">{libras(l.price)}</p>
        </div>
      ),
    },
    {
      key: "step",
      label: "Stopped at",
      width: "140px",
      render: (l) =>
        l.channel === "website" ? (
          <div>
            <p className="text-sm text-text-primary">Step {l.step_reached}</p>
            <p className="text-xs text-text-tertiary">{PASSOS[l.step_reached - 1] ?? ""}</p>
          </div>
        ) : (
          <span className="text-sm text-text-tertiary">Not a booking</span>
        ),
    },
    {
      key: "source",
      label: "Origin",
      render: (l) => {
        const o = origem(l, canais);
        return (
          <div className="min-w-0">
            <p className="truncate text-sm text-text-primary">{o.linha}</p>
            {o.detalhe ? <p className="truncate font-mono text-xs text-text-tertiary">{o.detalhe}</p> : null}
          </div>
        );
      },
    },
    { key: "sequence", label: "Recovery", render: (l) => <span className="text-sm text-text-secondary">{sequencia(l)}</span> },
    {
      key: "status",
      label: "Status",
      width: "120px",
      render: (l) => (
        <Badge variant={ESTADO[l.status].badge} dot>
          {ESTADO[l.status].rotulo}
        </Badge>
      ),
    },
  ];

  const info: Array<[string, string]> = aberto
    ? [
        ["Service", aberto.service_label ?? VAZIO],
        ["Price", libras(aberto.price)],
        ["Stopped at", aberto.channel === "website" ? `Step ${aberto.step_reached} · ${PASSOS[aberto.step_reached - 1] ?? ""}` : "Not a website booking"],
        ["Origin", [origem(aberto, canais).linha, origem(aberto, canais).detalhe].filter(Boolean).join(" · ")],
        ["Started", quando(aberto.created_at)],
        ["Last activity", quando(aberto.last_activity_at)],
        ["Email 1", linhaEmail(aberto.email1_sent_at, aberto.email1_due_at)],
        ["Email 2", linhaEmail(aberto.email2_sent_at, aberto.email2_due_at)],
        ["Email 3 · 10%", linhaEmail(aberto.email3_sent_at, aberto.email3_due_at)],
        ...(aberto.whatsapp_sent_at || aberto.whatsapp_due_at
          ? ([["WhatsApp · 10%", linhaEmail(aberto.whatsapp_sent_at ?? null, aberto.whatsapp_due_at ?? null)]] as Array<[string, string]>)
          : []),
        ...(aberto.replied_at ? ([["Replied", quando(aberto.replied_at)]] as Array<[string, string]>) : []),
        ...(aberto.zendesk_ticket_id ? ([["Zendesk", `#${aberto.zendesk_ticket_id}`]] as Array<[string, string]>) : []),
        ...(aberto.promo_code ? ([["Promo code", aberto.promo_code]] as Array<[string, string]>) : []),
        ...(aberto.tags?.length ? ([["Tags", aberto.tags.join(", ")]] as Array<[string, string]>) : []),
        ...(aberto.notes ? ([["Notes", aberto.notes]] as Array<[string, string]>) : []),
      ]
    : [];

  return (
    <PageTransition>
      {/* Mesma estrutura do lado B2B (crm-client.tsx): barra de uma linha, quadro de altura
          cheia com colunas que rolam sozinhas, mesmo cartão e a lista (dono, 12/10/2026). */}
      <div className="flex h-[calc(100dvh-106px)] max-h-[calc(100dvh-106px)] min-h-0 flex-col gap-3 overflow-hidden">
        <PageHeader
          title="Leads"
          titleAddon={
            <>
              <LadoToggle lado="b2c" />
              <span className="hidden whitespace-nowrap text-[12px] tabular-nums text-text-tertiary xl:inline">
                {resumo.abertos} open · {resumo.clientes} became customers
                {resumo.valorAberto > 0 ? ` · ${libras(resumo.valorAberto)} open` : ""}
              </span>
            </>
          }
        >
          <Button variant="outline" size="icon" aria-label="Refresh" title="Refresh leads" onClick={() => router.refresh()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Import" title="Import a CSV of leads" onClick={() => setImportarAberto(true)}>
            <Upload className="h-4 w-4" />
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdicionarAberto(true)}>New lead</Button>
        </PageHeader>
        <PageToolbar>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5" role="group" aria-label="View">
            {([["board", "Board", SquareKanban, null], ["list", "List", List, lista.length]] as const).map(([v, rotulo, Icone, n]) => (
              <button
                key={v}
                type="button"
                aria-pressed={visao === v}
                onClick={() => trocarVisao(v)}
                className={cn(
                  "inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                  visao === v ? "bg-surface-tertiary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icone className="h-3.5 w-3.5" />
                {rotulo}
                {n != null ? <span className="tabular-nums text-text-tertiary">{n}</span> : null}
              </button>
            ))}
          </div>
          <div className="w-60"><SearchInput value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Search leads" aria-label="Search leads" /></div>
          <div className="w-44">
            <Select
              aria-label="Filter by origin"
              value={canal}
              onChange={(e) => setCanal(e.target.value as "all" | Canal)}
              options={[{ value: "all", label: "All origins" }, ...canais.map((c) => ({ value: c.key, label: `${c.label}${c.active ? "" : " (inactive)"}` }))]}
            />
          </div>
        </PageToolbar>

        {exemplo ? (
          <div className="shrink-0 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            Local example: migration 294 has not run, so these rows are built from the 4 real leads with made-up details. Nothing here writes to the database.
          </div>
        ) : null}

        {aviso ? <p role="status" className="m-0 shrink-0 text-[12px] text-text-secondary">{aviso}</p> : null}

        {visao === "board" ? (
          <KanbanBoard
            columns={colunasDoQuadro}
            getCardId={(l) => l.id}
            onCardClick={(l) => { setAbertoId(l.id); setAbaDoLead("overview"); setErro(""); }}
            onCardDrop={soltar}
            pendingCardIds={movendo}
            pageSize={30}
            fillHeight
            className="gap-3 pb-1 lg:overflow-x-auto"
            columnClassName="w-80 lg:w-80 lg:flex-none border border-border bg-surface-tertiary/50 p-2.5"
            renderCard={(l) => {
              const o = origem(l, canais);
              return (
                <div className="space-y-1.5 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md">
                  <p className="min-w-0 text-[13px] font-semibold leading-snug text-text-primary">{l.full_name || l.email || l.phone || "Lead"}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge size="sm">{rotuloCanal(l.channel, canais)}</Badge>
                    {l.price != null ? <span className="text-[11px] font-semibold text-text-secondary">{libras(l.price)}</span> : null}
                  </div>
                  {l.service_label ? <p className="line-clamp-2 text-[11px] text-text-secondary first-letter:uppercase">{l.service_label}</p> : null}
                  <p className="flex items-start gap-1 text-[11px] text-text-tertiary">
                    <CalendarClock className="mt-px h-3 w-3 shrink-0" />
                    <span className="min-w-0">{[quando(l.last_activity_at), o.detalhe || null, l.postcode].filter(Boolean).join(" · ")}</span>
                  </p>
                  {l.phone ? (
                    <p className="flex items-center gap-1 text-[11px] font-medium tabular-nums text-text-secondary">
                      <Phone className="h-3 w-3 shrink-0" />
                      {l.phone}
                    </p>
                  ) : null}
                  {l.email ? <p className="truncate text-[11px] text-text-tertiary">{l.email}</p> : null}
                </div>
              );
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="shrink-0 overflow-x-auto pb-1 [scrollbar-width:thin]">
              <Tabs tabs={abas} activeTab={aba} onChange={setAba} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <DataTable
                columns={colunas}
                data={lista}
                getRowId={(l) => l.id}
                selectedId={abertoId ?? undefined}
                onRowClick={(l) => { setAbertoId(l.id); setAbaDoLead("overview"); setErro(""); }}
                emptyMessage="No leads in this tab."
              />
            </div>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(aberto)}
        onClose={() => { setAbertoId(null); setErro(""); }}
        title={aberto?.full_name || aberto?.email || "Lead"}
        titleAddon={aberto ? <Badge variant={ESTADO[aberto.status].badge} dot>{ESTADO[aberto.status].rotulo}</Badge> : null}
        subtitle={aberto ? `${aberto.service_label ?? "Booking"} · ${libras(aberto.price)}` : undefined}
        headerPadding="wide"
        width="w-full max-w-[560px]"
      >
        {aberto ? (
          <div className="flex min-h-0 min-w-0 flex-col">
            <Tabs
              tabs={[{ id: "overview", label: "Overview" }, { id: "timeline", label: "Timeline", count: aberto.atividades.length }]}
              activeTab={abaDoLead}
              onChange={setAbaDoLead}
              variant="quote-drawer"
            />

            {abaDoLead === "overview" ? (
              <div className="space-y-6 px-7 py-5">
                <section>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Booking</h4>
                  <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
                    {info.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-text-tertiary">{k}</dt>
                        <dd className="m-0 text-text-primary first-letter:uppercase">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Contact</h4>
                  <div className="space-y-0.5 text-sm text-text-primary">
                    <p className="m-0">{aberto.email}</p>
                    {aberto.phone ? <p className="m-0">{aberto.phone}</p> : null}
                    {aberto.postcode ? <p className="m-0">{aberto.postcode}</p> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={`mailto:${aberto.email}`} className={LINK_ACAO}><Mail className="h-3.5 w-3.5" />Email</a>
                    {aberto.phone ? (
                      <a href={whatsappDe(aberto.phone)} target="_blank" rel="noreferrer" className={LINK_ACAO}><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>
                    ) : null}
                    {aberto.phone ? (
                      <a href={`tel:${aberto.phone}`} className={LINK_ACAO}><Phone className="h-3.5 w-3.5" />Call</a>
                    ) : null}
                    {aberto.resume_url ? (
                      <a href={aberto.resume_url} target="_blank" rel="noreferrer" className={LINK_ACAO}><ExternalLink className="h-3.5 w-3.5" />Open booking</a>
                    ) : null}
                    {aberto.zendesk_ticket_id ? (
                      <a href={linkDoTicket(aberto.zendesk_ticket_id)} target="_blank" rel="noreferrer" className={LINK_ACAO}><ExternalLink className="h-3.5 w-3.5" />Zendesk ticket</a>
                    ) : null}
                  </div>
                </section>

                <HistoricoDoLead clientId={aberto.client_id} email={aberto.email} phone={aberto.phone} />

                {["new", "hot", "contacted", "lost"].includes(aberto.status) ? (
                  <section>
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Status</h4>
                    {aberto.status === "lost" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text-secondary">Lost{aberto.lost_reason ? `: ${aberto.lost_reason}` : ""}.</span>
                        <Button size="sm" variant="outline" disabled={salvando} onClick={() => agir({ status: aberto.step_reached >= 3 ? "hot" : "new" })}>Reopen</Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {aberto.status === "contacted" ? (
                          <Button size="sm" variant="outline" disabled={salvando} onClick={() => agir({ status: aberto.step_reached >= 3 ? "hot" : "new" })}>Resume emails</Button>
                        ) : (
                          <Button size="sm" disabled={salvando} onClick={() => agir({ status: "contacted" })}>In contact (pause emails)</Button>
                        )}
                        <select
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          className="h-8 rounded-lg border border-border bg-card px-2 text-sm text-text-primary"
                          aria-label="Lost reason"
                        >
                          {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                        <Button size="sm" variant="outline" disabled={salvando} onClick={() => agir({ status: "lost", reason: motivo })}>Mark lost</Button>
                      </div>
                    )}
                  </section>
                ) : null}

                <section>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Note</h4>
                  <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={3}
                    placeholder="What was said, next step…"
                    className="w-full resize-y rounded-lg border border-border bg-card p-2.5 text-sm text-text-primary placeholder:text-text-tertiary"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <Button size="sm" disabled={salvando || !nota.trim()} onClick={() => agir({ note: nota })}>Save note</Button>
                    {erro ? <span role="alert" className="text-sm text-red-600 dark:text-red-400">{erro}</span> : null}
                  </div>
                </section>
              </div>
            ) : (
              <ol className="m-0 list-none space-y-3 px-7 py-5">
                {aberto.atividades.map((a) => (
                  <li key={a.id} className="grid grid-cols-[110px_1fr] gap-3 text-sm">
                    <span className="font-mono text-xs text-text-tertiary">{quando(a.at)}</span>
                    <span className="text-text-primary">
                      {a.detail}
                      {a.kind === "email_sent" ? (
                        <span className="ml-1 text-xs text-text-tertiary">· {a.clicked_at ? "clicked" : a.opened_at ? "opened" : "not opened yet"}</span>
                      ) : null}
                      {a.kind === "whatsapp" ? (
                        <span className="ml-1 text-xs text-text-tertiary">· {a.opened_at ? "read" : "not read yet"}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {aberto.atividades.length === 0 ? <li className="text-sm text-text-tertiary">No activity yet.</li> : null}
              </ol>
            )}
          </div>
        ) : null}
      </Drawer>

      <AdicionarLead canais={canais} aberto={adicionarAberto} fechar={() => setAdicionarAberto(false)} pronto={() => router.refresh()} />
      <ImportarLeads canais={canais} aberto={importarAberto} fechar={() => setImportarAberto(false)} pronto={() => router.refresh()} />
    </PageTransition>
  );
}
