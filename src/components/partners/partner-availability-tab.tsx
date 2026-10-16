"use client";

/**
 * Disponibilidade do parceiro, pelo lado do escritório. É o MESMO dado que o
 * parceiro edita no portal (partners.availability + job_preferences): quem
 * mexer por último vale. Daqui sai a capacidade do dia e quem pode receber a
 * oferta do auto-assign (src/lib/elegibilidade-parceiro.ts).
 *
 * Sem nenhum dia ligado, o parceiro conta como indisponível: não entra na
 * capacidade nem recebe oferta.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import type { Partner } from "@/types/database";

type Dia = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DIAS: Array<{ id: Dia; rotulo: string }> = [
  { id: "mon", rotulo: "Mon" },
  { id: "tue", rotulo: "Tue" },
  { id: "wed", rotulo: "Wed" },
  { id: "thu", rotulo: "Thu" },
  { id: "fri", rotulo: "Fri" },
  { id: "sat", rotulo: "Sat" },
  { id: "sun", rotulo: "Sun" },
];

type DiaCfg = { on: boolean; start: string; end: string };
type Disponibilidade = {
  days?: Partial<Record<Dia, Partial<DiaCfg>>>;
  maxJobsPerDay?: number;
  daysOff?: string[];
  [k: string]: unknown;
};
type Preferencias = { minJobValue?: number; maxActiveJobs?: number; [k: string]: unknown };

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function inicial(av: Disponibilidade | null | undefined): Record<Dia, DiaCfg> {
  const out = {} as Record<Dia, DiaCfg>;
  for (const d of DIAS) {
    const c = av?.days?.[d.id];
    out[d.id] = { on: c?.on === true, start: c?.start || "08:00", end: c?.end || "18:00" };
  }
  return out;
}

export function PartnerAvailabilityTab({
  partner,
  onPartnerUpdate,
  canEdit,
}: {
  partner: Partner;
  onPartnerUpdate: (p: Partner) => void;
  canEdit: boolean;
}) {
  const atual = (partner as Partner & { availability?: Disponibilidade | null }).availability ?? null;
  const prefs = (partner as Partner & { job_preferences?: Preferencias | null }).job_preferences ?? null;
  const [dias, setDias] = useState(() => inicial(atual));
  const [maxPorDia, setMaxPorDia] = useState(String(atual?.maxJobsPerDay ?? 5));
  const [folgas, setFolgas] = useState<string[]>(() => [...(atual?.daysOff ?? [])].sort());
  const [novaFolga, setNovaFolga] = useState("");
  const [salvando, setSalvando] = useState(false);

  const nenhumDia = useMemo(() => !Object.values(dias).some((d) => d.on), [dias]);
  const hoje = new Date().toISOString().slice(0, 10);

  const mudar = (id: Dia, parte: Partial<DiaCfg>) => setDias((prev) => ({ ...prev, [id]: { ...prev[id], ...parte } }));

  async function salvar() {
    for (const d of DIAS) {
      const c = dias[d.id];
      if (!c.on) continue;
      if (!HORA.test(c.start) || !HORA.test(c.end) || c.start >= c.end) {
        toast.error(`${d.rotulo}: use HH:MM and make the end later than the start`);
        return;
      }
    }
    const max = Math.floor(Number(maxPorDia));
    if (!(max >= 1 && max <= 20)) {
      toast.error("Max jobs per day must be between 1 and 20");
      return;
    }
    setSalvando(true);
    try {
      const availability: Disponibilidade = {
        ...(atual ?? {}),
        days: Object.fromEntries(DIAS.map((d) => [d.id, dias[d.id]])),
        maxJobsPerDay: max,
        daysOff: folgas.filter((f) => f >= hoje),
      };
      const { data, error } = await getSupabase().from("partners").update({ availability }).eq("id", partner.id).select().single();
      if (error) throw error;
      onPartnerUpdate(data as Partner);
      toast.success("Availability saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save availability");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      {nenhumDia ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No working days set: this partner gets no auto-assign offers and adds nothing to daily capacity.
        </p>
      ) : null}

      <div className="space-y-2">
        {DIAS.map((d) => {
          const c = dias[d.id];
          return (
            <div key={d.id} className="flex items-center gap-3">
              <label className="flex w-16 items-center gap-2 text-sm font-medium text-text-primary">
                <input type="checkbox" checked={c.on} disabled={!canEdit} onChange={(e) => mudar(d.id, { on: e.target.checked })} />
                {d.rotulo}
              </label>
              <Input className={cn("h-8 w-24", !c.on && "opacity-40")} value={c.start} disabled={!canEdit || !c.on} onChange={(e) => mudar(d.id, { start: e.target.value })} aria-label={`${d.rotulo} start`} />
              <span className="text-xs text-text-tertiary">to</span>
              <Input className={cn("h-8 w-24", !c.on && "opacity-40")} value={c.end} disabled={!canEdit || !c.on} onChange={(e) => mudar(d.id, { end: e.target.value })} aria-label={`${d.rotulo} end`} />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-text-secondary" htmlFor={`max-${partner.id}`}>
          Max jobs per day
        </label>
        <Input id={`max-${partner.id}`} className="h-8 w-20" value={maxPorDia} disabled={!canEdit} onChange={(e) => setMaxPorDia(e.target.value)} />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-text-secondary">Days off</p>
        <div className="flex flex-wrap gap-2">
          {folgas.filter((f) => f >= hoje).map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-primary">
              {f}
              {canEdit ? (
                <button type="button" className="text-text-tertiary hover:text-text-primary" aria-label={`Remove ${f}`} onClick={() => setFolgas((prev) => prev.filter((x) => x !== f))}>
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {!folgas.some((f) => f >= hoje) ? <span className="text-xs text-text-tertiary">None</span> : null}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Input type="date" className="h-8 w-44" min={hoje} value={novaFolga} onChange={(e) => setNovaFolga(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!novaFolga}
              onClick={() => {
                setFolgas((prev) => [...new Set([...prev, novaFolga])].sort());
                setNovaFolga("");
              }}
            >
              Add day off
            </Button>
          </div>
        ) : null}
      </div>

      {prefs?.minJobValue || prefs?.maxActiveJobs ? (
        <p className="text-xs text-text-tertiary">
          Set by the partner in the portal: {prefs.minJobValue ? `minimum job £${prefs.minJobValue}` : null}
          {prefs.minJobValue && prefs.maxActiveJobs ? " · " : null}
          {prefs.maxActiveJobs ? `up to ${prefs.maxActiveJobs} active jobs` : null}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end border-t border-border-light pt-3">
          <Button type="button" loading={salvando} onClick={() => void salvar()}>
            Save availability
          </Button>
        </div>
      ) : null}
    </div>
  );
}
