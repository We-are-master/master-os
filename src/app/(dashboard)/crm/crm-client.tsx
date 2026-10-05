"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Building2, CalendarClock, Copy, List, Mail, Phone, PhoneCall, Plus, Settings2, SquareKanban, Trash2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Modal } from "@/components/ui/modal";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { csvToCrmRows, type CrmCsvRow } from "@/lib/crm-csv";
import { CALL_OUTCOMES, applyCallOutcome, isCallDue, isoDate, type CallOutcome } from "@/lib/crm-calls";
import {
  createCrmDeal, createCrmStage, deleteCrmDeal, deleteCrmStage, importAccountsToCrm, importRowsToCrm,
  listAccountsForCrm, listCrmDeals, listCrmStages, moveCrmDeal, reorderCrmStages, updateCrmDeal, updateCrmStage,
  type CrmAccountOption,
} from "@/services/crm";
import type { CrmDeal, CrmStage, CrmStageKind } from "@/types/database";

const COLORS: Record<string, { dot: string; label: string }> = {
  slate: { dot: "bg-stone-400", label: "Grey" },
  blue: { dot: "bg-blue-500", label: "Blue" },
  amber: { dot: "bg-amber-500", label: "Amber" },
  orange: { dot: "bg-orange-500", label: "Orange" },
  violet: { dot: "bg-violet-500", label: "Violet" },
  teal: { dot: "bg-teal-500", label: "Teal" },
  green: { dot: "bg-emerald-500", label: "Green" },
  red: { dot: "bg-red-500", label: "Red" },
};
const COLOR_OPTIONS = Object.entries(COLORS).map(([value, c]) => ({ value, label: c.label }));
const KIND_OPTIONS = [
  { value: "open", label: "Open (in progress)" },
  { value: "won", label: "Won (became an account)" },
  { value: "lost", label: "Lost" },
];
const SEGMENTS = [
  "Letting agent", "Property manager", "Block manager", "Short-let / Airbnb", "Student accommodation", "Build to rent",
  "Housing provider", "Facilities management", "Developer / Builder", "Commercial / Office", "Platform", "Certificates",
  "Public sector", "Other",
];
/** Cards drawn per board column before "Show more": the lead column holds hundreds. */
const BOARD_PAGE = 30;

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function siteHref(site: string) {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Could not copy"),
  );
}

function dot(color: string) {
  return COLORS[color]?.dot ?? COLORS.slate.dot;
}

function money(v: number | null | undefined) {
  return v != null && Number(v) > 0 ? `${formatCurrency(Number(v))}/mo` : null;
}

type Draft = Partial<CrmDeal> & { company_name: string; stage_id: string };

export function CrmClient() {
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [today] = useState(() => isoDate(new Date()));
  const [editing, setEditing] = useState<Draft | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([listCrmStages(), listCrmDeals()]);
      setStages(s);
      setDeals(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the CRM");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const segmentsInUse = useMemo(() => {
    const all = new Set(deals.map((d) => d.segment).filter((s): s is string => !!s));
    return [...all].sort();
  }, [deals]);

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const isDue = useCallback((d: CrmDeal) => isCallDue(d, stageById.get(d.stage_id)?.kind, today), [stageById, today]);
  const dueCount = useMemo(() => deals.filter(isDue).length, [deals, isDue]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = deals.filter((d) => {
      if (segment && d.segment !== segment) return false;
      if (dueOnly && !isDue(d)) return false;
      if (!q) return true;
      return [d.company_name, d.contact_name, d.contact_email, d.contact_phone, d.segment, d.next_step, d.notes]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
    // Na fila de ligações, a mais atrasada primeiro e depois a ordem do quadro.
    if (dueOnly) {
      rows.sort((a, b) => (a.next_step_date ?? "").localeCompare(b.next_step_date ?? "") || a.position - b.position);
    }
    return rows;
  }, [deals, search, segment, dueOnly, isDue]);

  const totals = useMemo(() => {
    let open = 0, openValue = 0, won = 0, wonValue = 0;
    for (const d of deals) {
      const k = stageById.get(d.stage_id)?.kind;
      if (k === "open") { open++; openValue += Number(d.monthly_value) || 0; }
      if (k === "won") { won++; wonValue += Number(d.monthly_value) || 0; }
    }
    return { open, openValue, won, wonValue };
  }, [deals, stageById]);

  const columns: KanbanColumn<CrmDeal>[] = useMemo(
    () => stages.map((s) => ({
      id: s.id,
      title: s.name,
      color: dot(s.color),
      items: filtered.filter((d) => d.stage_id === s.id),
    })),
    [stages, filtered],
  );

  async function moveTo(deal: CrmDeal, stageId: string) {
    const before = deals;
    setDeals((cur) => cur.map((d) => (d.id === deal.id ? { ...d, stage_id: stageId } : d)));
    setPending((p) => new Set(p).add(deal.id));
    try {
      const saved = await moveCrmDeal(deal.id, stageId);
      setDeals((cur) => cur.map((d) => (d.id === saved.id ? saved : d)));
    } catch (e) {
      setDeals(before);
      toast.error(e instanceof Error ? e.message : "Could not move the card");
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(deal.id); return n; });
    }
  }

  function newDeal(stageId?: string) {
    const first = stageId ?? stages[0]?.id;
    if (!first) { toast.error("Add a stage first"); return; }
    setEditing({ company_name: "", stage_id: first });
  }

  const empty = !loading && !loadError && deals.length === 0;

  return (
    // Altura da tela inteira, colado no header (mesmo padrão da tela de Jobs):
    // cada coluna do quadro rola sozinha.
    <div className="-mt-2 flex h-[calc(100dvh-6rem)] max-h-[calc(100dvh-6rem)] min-h-0 flex-col gap-3 overflow-hidden sm:-mt-3 lg:-mt-4 lg:h-[calc(100dvh-7rem)] lg:max-h-[calc(100dvh-7rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="mr-1 flex items-baseline gap-2">
          <h1 className="text-[18px] font-semibold leading-none tracking-[-0.01em] text-text-primary">CRM</h1>
          <span className="whitespace-nowrap text-[12px] tabular-nums text-text-tertiary">
            {deals.length} companies · {totals.won} won
            {totals.openValue > 0 ? ` · ${formatCurrency(totals.openValue)}/mo open` : ""}
          </span>
        </div>
        <ViewSwitch view={view} listCount={filtered.length} onChange={setView} />
        <div className="w-56"><SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies" aria-label="Search companies" /></div>
        <div className="w-44">
          <Select
            aria-label="Filter by segment"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            options={[{ value: "", label: "All segments" }, ...segmentsInUse.map((s) => ({ value: s, label: s }))]}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={dueOnly ? "primary" : "outline"}
            icon={<PhoneCall className="h-4 w-4" />}
            onClick={() => setDueOnly((v) => !v)}
            aria-pressed={dueOnly}
          >
            Calls due · {dueCount}
          </Button>
          <Button variant="outline" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Import</Button>
          <Button variant="outline" size="sm" icon={<Settings2 className="h-4 w-4" />} onClick={() => setStagesOpen(true)}>Stages</Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => newDeal()}>New lead</Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
          Could not load the CRM: {loadError}. If the CRM tables were just created, run migration 311 and reload.
        </div>
      ) : loading ? (
        <p className="py-10 text-center text-sm text-text-tertiary">Loading the CRM…</p>
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-semibold text-text-primary">No companies in the CRM yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-tertiary">
            Bring in the accounts you already work with, import a CSV list of target companies, or add a lead by hand.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Import accounts or CSV</Button>
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => newDeal()}>New lead</Button>
          </div>
        </div>
      ) : view === "board" ? (
        <KanbanBoard
          columns={columns}
          getCardId={(d) => d.id}
          onCardClick={(d) => setEditing({ ...d })}
          onCardDrop={(d, to) => moveTo(d, to)}
          pendingCardIds={pending}
          pageSize={BOARD_PAGE}
          fillHeight
          className="gap-3 pb-1 lg:overflow-x-auto"
          columnClassName="w-80 lg:w-80 lg:flex-none border border-border bg-surface-tertiary/50 p-2.5"
          renderCard={(d) => <DealCard deal={d} due={isDue(d)} />}
        />
      ) : (
        <ListView
          deals={filtered}
          stages={stages}
          isDue={isDue}
          keepOrder={dueOnly}
          onOpen={(d) => setEditing({ ...d })}
          onMove={moveTo}
        />
      )}

      {editing && (
        <DealDrawer
          draft={editing}
          stages={stages}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setDeals((cur) => (isNew ? [...cur, saved] : cur.map((d) => (d.id === saved.id ? saved : d))));
            setEditing(null);
          }}
          onDeleted={(id) => {
            setDeals((cur) => cur.filter((d) => d.id !== id));
            setEditing(null);
          }}
        />
      )}

      <StagesModal
        open={stagesOpen}
        onClose={() => setStagesOpen(false)}
        stages={stages}
        deals={deals}
        onChanged={load}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        stages={stages}
        onImported={load}
      />
    </div>
  );
}

function ViewSwitch({ view, listCount, onChange }: { view: "board" | "list"; listCount: number; onChange: (v: "board" | "list") => void }) {
  const item = (v: "board" | "list", label: string, icon: React.ReactNode, count?: number) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
        view === v ? "bg-surface-tertiary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
      )}
    >
      {icon}
      {label}
      {count != null ? <span className="tabular-nums text-text-tertiary">{count}</span> : null}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {item("board", "Board", <SquareKanban className="h-3.5 w-3.5" />)}
      {item("list", "List", <List className="h-3.5 w-3.5" />, listCount)}
    </div>
  );
}

function DealCard({ deal, due }: { deal: CrmDeal; due: boolean }) {
  const value = money(deal.monthly_value);
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] font-semibold leading-snug text-text-primary">{deal.company_name}</p>
        {deal.account_id ? <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-label="Linked account" /> : null}
      </div>
      {(deal.segment || value) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {deal.segment ? <Badge size="sm">{deal.segment}</Badge> : null}
          {value ? <span className="text-[11px] font-semibold text-text-secondary">{value}</span> : null}
        </div>
      )}
      {deal.next_step ? (
        <p className={cn("flex items-start gap-1 text-[11px]", due ? "font-semibold text-primary" : "text-text-tertiary")}>
          <CalendarClock className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0">
            {deal.next_step}
            {deal.next_step_date ? ` · ${formatDate(deal.next_step_date)}` : ""}
          </span>
        </p>
      ) : null}
      {deal.contact_phone ? (
        <p className="flex items-center gap-1 text-[11px] font-medium tabular-nums text-text-secondary">
          <Phone className="h-3 w-3 shrink-0" />
          {deal.contact_phone}
        </p>
      ) : null}
      {deal.contact_name ? <p className="truncate text-[11px] text-text-tertiary">{deal.contact_name}</p> : null}
    </div>
  );
}

function ListView({
  deals, stages, isDue, keepOrder, onOpen, onMove,
}: {
  deals: CrmDeal[];
  stages: CrmStage[];
  isDue: (d: CrmDeal) => boolean;
  /** Keeps the order it was given (the call queue) instead of stage then name. */
  keepOrder: boolean;
  onOpen: (d: CrmDeal) => void;
  onMove: (d: CrmDeal, stageId: string) => void;
}) {
  const order = new Map(stages.map((s, i) => [s.id, i]));
  const rows = keepOrder ? deals : [...deals].sort(
    (a, b) => (order.get(a.stage_id) ?? 99) - (order.get(b.stage_id) ?? 99) || a.position - b.position,
  );
  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));
  if (!rows.length) return <p className="py-10 text-center text-sm text-text-tertiary">No companies match this search.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1180px] text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-tertiary text-[11px] uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-3 py-2 font-semibold">Company</th>
            <th className="px-3 py-2 font-semibold">Phone</th>
            <th className="px-3 py-2 font-semibold">Next step</th>
            <th className="px-3 py-2 font-semibold">Stage</th>
            <th className="px-3 py-2 font-semibold">Segment</th>
            <th className="px-3 py-2 font-semibold">Contact</th>
            <th className="px-3 py-2 font-semibold">Value</th>
            <th className="px-3 py-2 font-semibold">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t border-border hover:bg-surface-hover/50">
              <td className="min-w-[12rem] px-3 py-2">
                <button type="button" className="text-left font-semibold text-text-primary hover:underline" onClick={() => onOpen(d)}>
                  {d.company_name}
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {d.contact_phone ? (
                  <a href={telHref(d.contact_phone)} className="font-medium text-text-primary hover:text-primary hover:underline">{d.contact_phone}</a>
                ) : null}
              </td>
              <td className={cn("min-w-[15rem] px-3 py-2", isDue(d) ? "font-semibold text-primary" : "text-text-secondary")}>
                {d.next_step ?? ""}
                {d.next_step_date ? <span className={isDue(d) ? undefined : "text-text-tertiary"}> · {formatDate(d.next_step_date)}</span> : null}
              </td>
              <td className="px-3 py-1.5">
                <div className="w-40">
                  <Select
                    aria-label={`Stage of ${d.company_name}`}
                    value={d.stage_id}
                    onChange={(e) => onMove(d, e.target.value)}
                    options={stageOptions}
                    className="h-8 text-[12px]"
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-text-secondary">{d.segment ?? ""}</td>
              <td className="px-3 py-2 text-text-secondary">
                <div className="max-w-[14rem]">
                  {d.contact_name ? <div className="truncate">{d.contact_name}</div> : null}
                  {d.contact_email ? <div className="truncate text-[11px] text-text-tertiary">{d.contact_email}</div> : null}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary">{money(d.monthly_value) ?? ""}</td>
              <td className="whitespace-nowrap px-3 py-2 text-[12px] text-text-tertiary">{formatDate(d.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealDrawer({
  draft, stages, onClose, onSaved, onDeleted,
}: {
  draft: Draft;
  stages: CrmStage[];
  onClose: () => void;
  onSaved: (d: CrmDeal, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [callNote, setCallNote] = useState("");
  const isNew = !draft.id;
  const set = (patch: Partial<Draft>) => setForm((f) => ({ ...f, ...patch }));
  const text = (v: string) => (v.trim() === "" ? null : v);

  async function save(f: Draft = form, okMessage?: string) {
    if (!f.company_name.trim()) { toast.error("Add the company name"); return; }
    setSaving(true);
    try {
      const payload = {
        company_name: f.company_name.trim(),
        stage_id: f.stage_id,
        segment: f.segment ?? null,
        contact_name: f.contact_name ?? null,
        contact_email: f.contact_email ?? null,
        contact_phone: f.contact_phone ?? null,
        website: f.website ?? null,
        monthly_value: f.monthly_value != null && Number(f.monthly_value) > 0 ? Number(f.monthly_value) : null,
        next_step: f.next_step ?? null,
        next_step_date: f.next_step_date || null,
        notes: f.notes ?? null,
        source: f.source ?? (isNew ? "Added by hand" : null),
      };
      const saved = isNew ? await createCrmDeal(payload) : await updateCrmDeal(draft.id as string, payload);
      toast.success(okMessage ?? (isNew ? "Lead added" : "Saved"));
      onSaved(saved, isNew);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  /** Grava o resultado da ligação junto com o que estiver editado na gaveta. */
  function logCall(outcome: CallOutcome) {
    const result = applyCallOutcome(
      { stage_id: form.stage_id, notes: form.notes ?? null, next_step: form.next_step ?? null, next_step_date: form.next_step_date ?? null },
      outcome, stages, new Date(), callNote,
    );
    const label = CALL_OUTCOMES.find((o) => o.id === outcome)?.label ?? outcome;
    const stageName = result.stage_id !== form.stage_id ? stages.find((s) => s.id === result.stage_id)?.name : null;
    const next = { ...form, ...result };
    setForm(next);
    save(next, [label, stageName ? `moved to ${stageName}` : null, result.next_step_date ? `next call ${formatDate(result.next_step_date)}` : null]
      .filter(Boolean).join(" · "));
  }

  async function remove() {
    if (!draft.id) return;
    setSaving(true);
    try {
      await deleteCrmDeal(draft.id);
      toast.success("Removed from the CRM");
      onDeleted(draft.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setSaving(false);
    }
  }

  const segmentOptions = [{ value: "", label: "No segment" }, ...SEGMENTS.map((s) => ({ value: s, label: s }))];
  if (form.segment && !SEGMENTS.includes(form.segment)) segmentOptions.push({ value: form.segment, label: form.segment });

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? "New lead" : form.company_name || "Company"}
      subtitle={isNew ? "Add a company to the CRM" : form.source ?? undefined}
      footer={
        <div className="flex w-full items-center justify-between gap-2 px-5 py-3">
          {!isNew ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-secondary">Remove from the CRM?</span>
                <Button size="sm" variant="danger" onClick={remove} disabled={saving}>Remove</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Remove</Button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : isNew ? "Add lead" : "Save"}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {!isNew && (form.contact_phone || form.website) ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-tertiary px-3 py-2.5 text-[13px]">
            {form.contact_phone ? (
              <span className="inline-flex items-center gap-1.5">
                <a href={telHref(form.contact_phone)} className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-text-primary hover:text-primary">
                  <PhoneCall className="h-4 w-4" />
                  {form.contact_phone}
                </a>
                <button type="button" aria-label="Copy phone number" className="rounded p-0.5 text-text-tertiary hover:text-text-primary" onClick={() => copyText(form.contact_phone as string)}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
            {form.website ? (
              <a href={siteHref(form.website)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-text-secondary hover:text-primary hover:underline sm:ml-auto">
                {form.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
              </a>
            ) : null}
          </div>
        ) : null}
        {!isNew ? (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Log this call</p>
            <Input
              id="crm-call-note"
              aria-label="What they said"
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              placeholder="What they said (optional)"
            />
            <div className="flex flex-wrap gap-1.5">
              {CALL_OUTCOMES.map((o) => (
                <Button
                  key={o.id}
                  size="sm"
                  variant={o.id === "meeting" ? "primary" : o.id === "not_interested" ? "ghost" : "outline"}
                  disabled={saving}
                  onClick={() => logCall(o.id)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-text-tertiary">
              Each button writes the call at the top of the notes and sets the next step. No answer: next working day. Voicemail and Call back: 2 working days. Meeting booked moves to the next stage.
            </p>
          </div>
        ) : null}
        <Field label="Company" htmlFor="crm-company">
          <Input id="crm-company" value={form.company_name} onChange={(e) => set({ company_name: e.target.value })} placeholder="Company name" autoFocus={isNew} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Select id="crm-stage" label="Stage" value={form.stage_id} onChange={(e) => set({ stage_id: e.target.value })} options={stages.map((s) => ({ value: s.id, label: s.name }))} />
          <Select id="crm-segment" label="Segment" value={form.segment ?? ""} onChange={(e) => set({ segment: text(e.target.value) })} options={segmentOptions} />
        </div>
        <Field label="Estimated value per month (£)" htmlFor="crm-value">
          <Input
            id="crm-value"
            type="number"
            min={0}
            step="50"
            value={form.monthly_value ?? ""}
            onChange={(e) => set({ monthly_value: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="For example 1500"
          />
        </Field>
        <div className="grid grid-cols-[1fr_9.5rem] gap-3">
          <Field label="Next step" htmlFor="crm-next">
            <Input id="crm-next" value={form.next_step ?? ""} onChange={(e) => set({ next_step: text(e.target.value) })} placeholder="For example: call the facilities manager" />
          </Field>
          <Field label="When" htmlFor="crm-next-date">
            <Input id="crm-next-date" type="date" value={form.next_step_date ?? ""} onChange={(e) => set({ next_step_date: e.target.value || null })} />
          </Field>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Contact</p>
          <div className="space-y-3">
            <Input id="crm-contact" aria-label="Contact name" value={form.contact_name ?? ""} onChange={(e) => set({ contact_name: text(e.target.value) })} placeholder="Name and role" />
            <Input id="crm-email" aria-label="Email" icon={<Mail className="h-4 w-4" />} type="email" value={form.contact_email ?? ""} onChange={(e) => set({ contact_email: text(e.target.value) })} placeholder="Email" />
            <Input id="crm-phone" aria-label="Phone" icon={<Phone className="h-4 w-4" />} value={form.contact_phone ?? ""} onChange={(e) => set({ contact_phone: text(e.target.value) })} placeholder="Phone" />
            <Input id="crm-website" aria-label="Website" value={form.website ?? ""} onChange={(e) => set({ website: text(e.target.value) })} placeholder="Website" />
          </div>
        </div>
        <Field label="Notes" htmlFor="crm-notes">
          <textarea
            id="crm-notes"
            value={form.notes ?? ""}
            onChange={(e) => set({ notes: text(e.target.value) })}
            rows={6}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-primary focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/15"
            placeholder="What they need, who decides, what was said"
          />
        </Field>
        {form.account_id ? (
          <Link href={`/accounts?search=${encodeURIComponent(form.company_name)}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
            <Building2 className="h-4 w-4" /> Open the account in Accounts
          </Link>
        ) : null}
      </div>
    </Drawer>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function StagesModal({
  open, onClose, stages, deals, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  stages: CrmStage[];
  deals: CrmDeal[];
  onChanged: () => Promise<void> | void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNames(Object.fromEntries(stages.map((s) => [s.id, s.name])));
  }, [open, stages]);

  const count = (id: string) => deals.filter((d) => d.stage_id === id).length;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function rename(s: CrmStage) {
    const name = (names[s.id] ?? "").trim();
    if (!name || name === s.name) { setNames((n) => ({ ...n, [s.id]: s.name })); return; }
    run(() => updateCrmStage(s.id, { name }), "Stage renamed");
  }

  function shift(index: number, dir: -1 | 1) {
    const ids = stages.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => reorderCrmStages(ids));
  }

  function remove(s: CrmStage) {
    const n = count(s.id);
    if (n > 0 && !moveTo) { toast.error("Choose where the cards should go"); return; }
    run(async () => {
      await deleteCrmStage(s.id, n > 0 ? moveTo : undefined);
      setDeleting(null);
      setMoveTo("");
    }, "Stage removed");
  }

  return (
    <Modal open={open} onClose={onClose} title="Stages" subtitle="Rename, recolour, reorder, add or remove the stages of the board." size="lg">
      <div className="space-y-2 px-5 py-4">
        {stages.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot(s.color))} />
              <div className="min-w-[10rem] flex-1">
                <Input
                  id={`stage-name-${s.id}`}
                  aria-label="Stage name"
                  value={names[s.id] ?? s.name}
                  onChange={(e) => setNames((n) => ({ ...n, [s.id]: e.target.value }))}
                  onBlur={() => rename(s)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
              </div>
              <div className="w-28">
                <Select aria-label="Colour" value={s.color} onChange={(e) => run(() => updateCrmStage(s.id, { color: e.target.value }))} options={COLOR_OPTIONS} />
              </div>
              <div className="w-52">
                <Select aria-label="Counts as" value={s.kind} onChange={(e) => run(() => updateCrmStage(s.id, { kind: e.target.value as CrmStageKind }))} options={KIND_OPTIONS} />
              </div>
              <span className="w-14 text-right text-[12px] tabular-nums text-text-tertiary">{count(s.id)} cards</span>
              <Button size="icon" variant="ghost" aria-label="Move up" disabled={busy || i === 0} onClick={() => shift(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Move down" disabled={busy || i === stages.length - 1} onClick={() => shift(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove stage"
                disabled={busy || stages.length <= 1}
                onClick={() => { setDeleting(deleting === s.id ? null : s.id); setMoveTo(""); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {deleting === s.id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-tertiary p-2.5 text-[13px]">
                {count(s.id) > 0 ? (
                  <>
                    <span className="text-text-secondary">Move its {count(s.id)} cards to</span>
                    <div className="w-48">
                      <Select
                        aria-label="Move cards to"
                        value={moveTo}
                        onChange={(e) => setMoveTo(e.target.value)}
                        options={[{ value: "", label: "Choose a stage" }, ...stages.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: x.name }))]}
                      />
                    </div>
                  </>
                ) : (
                  <span className="text-text-secondary">This stage is empty.</span>
                )}
                <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(s)}>Remove stage</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              </div>
            ) : null}
          </div>
        ))}
        <form
          className="flex items-center gap-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            run(async () => { await createCrmStage(name); setNewName(""); }, "Stage added");
          }}
        >
          <Input id="stage-new" aria-label="New stage name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New stage name" />
          <Button type="submit" size="sm" icon={<Plus className="h-4 w-4" />} disabled={busy || !newName.trim()}>Add stage</Button>
        </form>
      </div>
    </Modal>
  );
}

function ImportModal({
  open, onClose, stages, onImported,
}: {
  open: boolean;
  onClose: () => void;
  stages: CrmStage[];
  onImported: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<"accounts" | "csv">("accounts");
  const [accounts, setAccounts] = useState<CrmAccountOption[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [accStage, setAccStage] = useState("");
  const [csvRows, setCsvRows] = useState<CrmCsvRow[] | null>(null);
  const [csvName, setCsvName] = useState("");
  const [csvStage, setCsvStage] = useState("");
  const [csvSegment, setCsvSegment] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const won = stages.find((s) => s.kind === "won") ?? stages[stages.length - 1];
    setAccStage(won?.id ?? "");
    setCsvStage(stages[0]?.id ?? "");
    setAccounts(null);
    listAccountsForCrm()
      .then((list) => {
        setAccounts(list);
        // Marcadas por padrão: contas ativas que ainda não estão no CRM, menos a conta interna da Fixfy e testes.
        setPicked(new Set(list.filter((a) => !a.inCrm && a.status === "active" && !/^(fixfy|teste?\b)/i.test(a.company_name.trim())).map((a) => a.id)));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load accounts"));
  }, [open, stages]);

  async function importAccounts() {
    if (!accounts) return;
    const chosen = accounts.filter((a) => picked.has(a.id));
    setBusy(true);
    try {
      const n = await importAccountsToCrm(chosen, accStage);
      toast.success(n ? `${n} accounts added to the CRM` : "Those accounts are already in the CRM");
      await onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File) {
    const text = await file.text();
    const { rows } = csvToCrmRows(text);
    setCsvRows(rows);
    setCsvName(file.name);
    if (!rows.length) toast.error("No rows with a company name were found in this file");
  }

  async function importCsv() {
    if (!csvRows?.length) return;
    setBusy(true);
    try {
      const source = `Import · ${csvName}`;
      const { created, skipped } = await importRowsToCrm(
        csvRows.map((r) => ({ ...r, segment: r.segment ?? (csvSegment || null), source })),
        csvStage,
      );
      toast.success(`${created} companies added${skipped ? ` · ${skipped} already in the CRM` : ""}`);
      await onImported();
      setCsvRows(null);
      if (fileRef.current) fileRef.current.value = "";
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));

  return (
    <Modal open={open} onClose={onClose} title="Import" subtitle="Bring your accounts and target lists into the CRM." size="lg">
      <div className="space-y-4 px-5 py-4">
        <Tabs
          tabs={[{ id: "accounts", label: "Existing accounts" }, { id: "csv", label: "CSV list" }]}
          activeTab={tab}
          onChange={(id) => setTab(id as "accounts" | "csv")}
        />
        {tab === "accounts" ? (
          <div className="space-y-3">
            {!accounts ? (
              <p className="py-6 text-center text-sm text-text-tertiary">Loading accounts…</p>
            ) : (
              <>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                  {accounts.length === 0 ? <p className="py-4 text-center text-[13px] text-text-tertiary">No accounts found.</p> : null}
                  {accounts.map((a) => (
                    <label key={a.id} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px]", a.inCrm ? "opacity-50" : "cursor-pointer hover:bg-surface-hover/60")}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--color-primary,#ED4B00)]"
                        checked={a.inCrm || picked.has(a.id)}
                        disabled={a.inCrm}
                        onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{a.company_name}</span>
                      <span className="text-[11px] text-text-tertiary">{a.inCrm ? "already in the CRM" : a.status}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-56"><Select id="import-acc-stage" label="Add them to" value={accStage} onChange={(e) => setAccStage(e.target.value)} options={stageOptions} /></div>
                  <Button size="sm" onClick={importAccounts} disabled={busy || picked.size === 0 || !accStage}>
                    {busy ? "Importing…" : `Import ${picked.size} accounts`}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-text-secondary">
              Any CSV with a company column works (company, operator, business or name). Email, phone, website and segment columns are picked up on their own; every other column goes into the notes. Companies already in the CRM are skipped.
            </p>
            <input
              ref={fileRef}
              id="import-csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
              className="block w-full text-[13px] text-text-secondary file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-text-primary"
            />
            {csvRows ? (
              <div className="rounded-xl border border-border p-3 text-[13px]">
                <p className="font-semibold text-text-primary">{csvRows.length} companies found in {csvName}</p>
                <p className="mt-1 truncate text-text-tertiary">{csvRows.slice(0, 5).map((r) => r.company_name).join(" · ")}{csvRows.length > 5 ? " …" : ""}</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Select id="import-csv-stage" label="Add them to" value={csvStage} onChange={(e) => setCsvStage(e.target.value)} options={stageOptions} />
              <Select
                id="import-csv-segment"
                label="Segment when the file has none"
                value={csvSegment}
                onChange={(e) => setCsvSegment(e.target.value)}
                options={[{ value: "", label: "Leave empty" }, ...SEGMENTS.map((s) => ({ value: s, label: s }))]}
              />
            </div>
            <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={importCsv} disabled={busy || !csvRows?.length || !csvStage}>
              {busy ? "Importing…" : csvRows?.length ? `Import ${csvRows.length} companies` : "Import"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

