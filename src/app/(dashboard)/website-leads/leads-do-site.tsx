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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Mail, Phone, MessageCircle, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { ExpandingSearch, ToolbarIconButton } from "@/components/shared/page-toolbar";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  step_reached: number;
  status: "new" | "hot" | "contacted" | "won" | "lost" | "unsubscribed";
  lost_reason: string | null;
  sequence_state: "scheduled" | "paused" | "stopped" | "done";
  email1_due_at: string | null;
  email2_due_at: string | null;
  email3_due_at: string | null;
  email1_sent_at: string | null;
  email2_sent_at: string | null;
  email3_sent_at: string | null;
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

const PASSOS = ["Your job", "Details", "Date and access", "Checkout"];
const MOTIVOS = ["Price", "Date not available", "Outside our area", "Just researching", "No reply", "Booked elsewhere", "Other"];
const VAZIO = "·";

/** Link com cara de botão outline (botão dentro de <a> é HTML inválido). */
const LINK_ACAO =
  "inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border-[0.5px] border-[#D8D8DD] bg-white px-3 py-1.5 text-xs font-medium text-[#020040] shadow-sm transition-colors hover:bg-surface-hover dark:border-border dark:bg-card dark:text-text-primary";

const libras = (v: number | null) => (v == null ? VAZIO : `£${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);

function quando(iso: string | null): string {
  if (!iso) return VAZIO;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function origem(l: LeadDaTela): { linha: string; detalhe: string } {
  const s = l.source ?? {};
  if (s.utm_source === "meta") return { linha: `Meta · ${s.utm_campaign ?? ""}`.trim(), detalhe: s.utm_content ?? "" };
  if (s.utm_source) return { linha: `${s.utm_source}${s.utm_campaign ? ` · ${s.utm_campaign}` : ""}`, detalhe: s.utm_content ?? "" };
  return { linha: "Direct", detalhe: "" };
}

function sequencia(l: LeadDaTela): string {
  if (l.status === "won") return l.email3_sent_at ? "Recovered by email 3" : l.email2_sent_at ? "Recovered by email 2" : l.email1_sent_at ? "Recovered by email 1" : "Paid, no email";
  if (l.sequence_state === "paused") return "Paused (in contact)";
  if (l.sequence_state === "stopped") return "Stopped";
  if (l.sequence_state === "done") return "3 of 3 sent";
  const [nome, hora] = !l.email1_sent_at ? ["Email 1", l.email1_due_at] : !l.email2_sent_at ? ["Email 2", l.email2_due_at] : ["Email 3", l.email3_due_at];
  return `${nome} · ${quando(hora)}`;
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

export function LeadsDoSite({ leads, motorLigado, exemplo = false }: { leads: LeadDaTela[]; motorLigado: boolean; exemplo?: boolean }) {
  const router = useRouter();
  const [aba, setAba] = useState<string>("open");
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [abaDoLead, setAbaDoLead] = useState("overview");
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const abas = useMemo(() => ABAS.map((a) => ({ id: a.id, label: a.label, count: leads.filter(a.filtro).length })), [leads]);

  const lista = useMemo(() => {
    const filtro = ABAS.find((a) => a.id === aba)?.filtro ?? ABAS[0].filtro;
    const q = busca.trim().toLowerCase();
    return leads
      .filter(filtro)
      .filter((l) => !q || [l.full_name, l.email, l.postcode, l.service_label, l.phone].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [leads, aba, busca]);

  const aberto = leads.find((l) => l.id === abertoId) ?? null;

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
      render: (l) => (
        <div>
          <p className="text-sm text-text-primary">Step {l.step_reached}</p>
          <p className="text-xs text-text-tertiary">{PASSOS[l.step_reached - 1] ?? ""}</p>
        </div>
      ),
    },
    {
      key: "source",
      label: "Source",
      render: (l) => {
        const o = origem(l);
        return (
          <div className="min-w-0">
            <p className="truncate text-sm text-text-primary">{o.linha}</p>
            {o.detalhe ? <p className="truncate font-mono text-xs text-text-tertiary">{o.detalhe}</p> : null}
          </div>
        );
      },
    },
    { key: "sequence", label: "Recovery emails", render: (l) => <span className="text-sm text-text-secondary">{sequencia(l)}</span> },
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
        ["Stopped at", `Step ${aberto.step_reached} · ${PASSOS[aberto.step_reached - 1] ?? ""}`],
        ["Source", [origem(aberto).linha, origem(aberto).detalhe].filter(Boolean).join(" · ")],
        ["Started", quando(aberto.created_at)],
        ["Last activity", quando(aberto.last_activity_at)],
        ["Email 1", linhaEmail(aberto.email1_sent_at, aberto.email1_due_at)],
        ["Email 2", linhaEmail(aberto.email2_sent_at, aberto.email2_due_at)],
        ["Email 3 · 10%", linhaEmail(aberto.email3_sent_at, aberto.email3_due_at)],
        ...(aberto.promo_code ? ([["Promo code", aberto.promo_code]] as Array<[string, string]>) : []),
      ]
    : [];

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader
          title="Leads"
          infoTooltip={
            "People who started a booking at getfixfy.com and did not pay.\n\n" +
            "Each one gets three recovery emails (30 min, +4 h, next day 10:00 with 10% off). Paying turns the lead into a customer and it leaves this list.\n\n" +
            "In contact pauses the emails. Numbers and the funnel live in the office Leads Room."
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={motorLigado ? "success" : "warning"} dot>
              {motorLigado ? "Recovery emails on" : "Recovery emails off (dry run)"}
            </Badge>
            <ToolbarIconButton icon={RefreshCw} label="Refresh leads" onClick={() => router.refresh()} />
          </div>
        </PageHeader>

        {exemplo ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            Local example: migration 294 has not run, so these rows are built from the 4 real leads with made-up details. Nothing here writes to the database.
          </div>
        ) : null}

        <div>
          <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="-mb-1 min-w-0 flex-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
              <Tabs tabs={abas} activeTab={aba} onChange={setAba} />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ExpandingSearch value={busca} onChange={setBusca} placeholder="Search leads…" />
            </div>
          </div>

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
                  </div>
                </section>

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
                    </span>
                  </li>
                ))}
                {aberto.atividades.length === 0 ? <li className="text-sm text-text-tertiary">No activity yet.</li> : null}
              </ol>
            )}
          </div>
        ) : null}
      </Drawer>
    </PageTransition>
  );
}
