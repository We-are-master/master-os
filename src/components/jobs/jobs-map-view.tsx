"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
  ScheduleLiveMap,
  LIVE_MAP_TOOLBAR_BTN_CLASS,
  type ScheduleLiveMapPoint,
  type ScheduleLiveMapJobPoint,
} from "@/components/dashboard/schedule-live-map";
import {
  LiveMapDayRoutePanel,
  type DayRouteData,
  type DayRouteStop,
} from "@/components/dashboard/live-map-day-route-panel";
import { getDrivingRouteMulti } from "@/lib/mapbox-directions";
import { createClient } from "@/lib/supabase/client";
import type { LiveMapJobStatusCategory } from "@/components/dashboard/live-map-marker-icons";
import type { Job } from "@/types/database";

/** Mesma régua do Live View (schedule/page): status do job → cor do pin. */
function liveMapCategoryForStatus(status: string): LiveMapJobStatusCategory {
  if (status === "completed" || status === "awaiting_payment") return "completed";
  if (status === "unassigned" || status === "auto_assigning") return "unassigned";
  if (status === "scheduled" || status === "late") return "scheduled";
  if (
    status.startsWith("in_progress") ||
    status === "final_check" ||
    status === "on_hold" ||
    status === "need_attention"
  ) {
    return "in_progress";
  }
  return "attention";
}

const STATUS_LABEL: Record<string, string> = {
  unassigned: "Unassigned", auto_assigning: "Assigning", scheduled: "Scheduled", late: "Late",
  in_progress: "In Progress", on_hold: "On Hold", final_check: "Final Check",
  awaiting_payment: "Awaiting Payment", need_attention: "Final Check", completed: "Completed",
};

/**
 * O modo MAPA do Jobs Management: a experiência do Live View dentro da página
 * onde o trabalho de alocar acontece de verdade.
 *
 * O Live View já sabia tudo — jobs do dia como pins, parceiros no mapa, clique
 * no parceiro abrindo o dia inteiro dele com rota real de carro e drag que
 * grava `route_seq` (que manda no email das 17h). Só que ele mora no Schedule,
 * e quem está alocando está no Jobs, com os filtros de data/status/parceiro já
 * do jeito que quer. Trocar de página para VER o mapa era o atrito.
 *
 * Este componente NÃO refaz nada disso: renderiza o mesmo `ScheduleLiveMap`,
 * chama a mesma `/api/partners/[id]/day-route` e grava pela mesma
 * `/api/jobs/route-order`. A única lógica própria é a tradução dos jobs
 * FILTRADOS DA PÁGINA em pins — o mapa mostra exatamente o que a lista mostra.
 *
 * Parceiro aqui não tem presença (isso é do Live View, que olha o app): o
 * status do pin vem do dia — com job na data = in_job, sem job = available.
 * Casa cadastrada é o critério de aparecer: parceiro sem coordenada de base
 * não tem onde ser desenhado.
 */

type PartnerPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  trade: string | null;
  trades: string[] | null;
};

export function JobsMapView({
  jobs,
  dateYmd,
  onOpenJob,
  onAssignJob,
}: {
  /** Já filtrados pela página (aba, data, parceiro, busca): o mapa é a lista. */
  jobs: Job[];
  /** A data que o clique no parceiro roteia (dia único do filtro, ou hoje). */
  dateYmd: string;
  onOpenJob?: (job: Job) => void;
  /** Abre o assign com o parceiro pré-escolhido (o modal decide preço e avisa). */
  onAssignJob?: (job: Job, partnerId: string) => void;
}) {
  const [nearestFor, setNearestFor] = useState<Job | null>(null);
  const [partners, setPartners] = useState<PartnerPin[]>([]);
  const [dayRoute, setDayRoute] = useState<DayRouteData | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<{
    type: "LineString";
    coordinates: [number, number][];
  } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routedPartnerId, setRoutedPartnerId] = useState<string | null>(null);
  const [routeNonce, setRouteNonce] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);

  // Parceiros com casa cadastrada. Uma carga por montagem basta: base de
  // parceiro muda em dias, não em cliques.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("partners")
        .select("id, company_name, contact_name, trade, trades, partner_address_latitude, partner_address_longitude, status")
        .is("deleted_at", null)
        .not("partner_address_latitude", "is", null)
        .not("partner_address_longitude", "is", null);
      if (cancelled) return;
      const rows = (data ?? []) as Array<{
        id: string;
        company_name: string | null;
        contact_name: string | null;
        trade: string | null;
        trades: string[] | null;
        partner_address_latitude: number | null;
        partner_address_longitude: number | null;
        status: string | null;
      }>;
      setPartners(
        rows
          .filter((p) => (p.status ?? "active") !== "inactive")
          .map((p) => ({
            id: p.id,
            name: p.company_name?.trim() || p.contact_name?.trim() || "Partner",
            latitude: Number(p.partner_address_latitude),
            longitude: Number(p.partner_address_longitude),
            trade: p.trade,
            trades: p.trades,
          })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const partnersWithJobs = useMemo(() => {
    const s = new Set<string>();
    for (const j of jobs) if (j.partner_id) s.add(j.partner_id);
    return s;
  }, [jobs]);

  const partnerPoints = useMemo<ScheduleLiveMapPoint[]>(
    () =>
      partners.map((p) => ({
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        lastUpdateIso: new Date().toISOString(),
        // Sem presença aqui: o dia decide. Com job na lista filtrada = in_job.
        status: partnersWithJobs.has(p.id) ? "in_job" : "available",
        trade: p.trade ?? undefined,
        trades: p.trades,
        jobsInWindow: jobs.filter((j) => j.partner_id === p.id).length,
      })),
    [partners, partnersWithJobs, jobs],
  );

  const jobPoints = useMemo<ScheduleLiveMapJobPoint[]>(() => {
    const pts: ScheduleLiveMapJobPoint[] = [];
    for (const j of jobs) {
      const lat = Number(j.latitude);
      const lng = Number(j.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      pts.push({
        id: j.id,
        latitude: lat,
        longitude: lng,
        reference: j.reference,
        title: j.title,
        partnerName: j.partner_name?.trim() ? j.partner_name : null,
        clientName: j.client_name?.trim() || undefined,
        propertyAddress: j.property_address ?? "",
        statusLabel: STATUS_LABEL[j.status] ?? j.status,
        statusCategory: liveMapCategoryForStatus(j.status),
        tradeLabel: j.title ?? "",
        scheduleLine: j.scheduled_date ?? "",
      });
    }
    return pts;
  }, [jobs]);

  const semCoordenada = jobs.length - jobPoints.length;

  /** Clique no parceiro: o dia inteiro dele, com a rota real de carro. */
  const loadDayRoute = useCallback(
    async (partnerId: string) => {
      setRoutedPartnerId(partnerId);
      setRouteLoading(true);
      try {
        const res = await fetch(`/api/partners/${partnerId}/day-route?date=${dateYmd}`);
        const json = (await res.json().catch(() => null)) as {
          partner?: { id: string; name: string; home: { latitude: number; longitude: number; label: string } | null };
          date?: string;
          stops?: DayRouteStop[];
          openNearby?: DayRouteStop[];
        } | null;
        if (!res.ok || !json?.partner) {
          setDayRoute(null);
          setRouteGeometry(null);
          toast.error("Could not load this partner's day.");
          return;
        }
        const stops = (json.stops ?? []).filter(
          (st) => typeof st.latitude === "number" && typeof st.longitude === "number",
        );
        const waypoints = [
          ...(json.partner.home ? [json.partner.home] : []),
          ...stops.map((st) => ({ latitude: st.latitude as number, longitude: st.longitude as number })),
        ];
        const multi = waypoints.length >= 2 ? await getDrivingRouteMulti(waypoints) : null;
        const legs = multi
          ? json.partner.home
            ? multi.legs
            : [{ durationSec: 0, distanceM: 0 }, ...multi.legs]
          : [];
        setDayRoute({
          partnerId: json.partner.id,
          partnerName: json.partner.name,
          date: json.date ?? dateYmd,
          home: json.partner.home,
          stops: json.stops ?? [],
          openNearbyCount: (json.openNearby ?? []).length,
          legs,
          totalSec: multi?.durationSec ?? 0,
          totalM: multi?.distanceM ?? 0,
        });
        setRouteGeometry(multi ? multi.geometry : null);
      } finally {
        setRouteLoading(false);
      }
    },
    [dateYmd],
  );

  // O drag do painel grava a MESMA ordem que manda no email das 17h.
  const handleReorder = useCallback(
    (orderedJobIds: string[]) => {
      setDayRoute((atual) => {
        if (!atual) return atual;
        const porId = new Map(atual.stops.map((s) => [s.id, s]));
        const stops = orderedJobIds.map((id) => porId.get(id)).filter((s): s is DayRouteStop => !!s);
        return stops.length === atual.stops.length ? { ...atual, stops } : atual;
      });
      void fetch("/api/jobs/route-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedJobIds }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const json = (await res.json().catch(() => null)) as { error?: string } | null;
            toast.error(json?.error ?? "Failed to save route order");
          }
        })
        .catch(() => toast.error("Failed to save route order"))
        .finally(() => {
          // Recalcula a rota na nova ordem, sem esperar o próximo clique.
          if (routedPartnerId) void loadDayRoute(routedPartnerId);
        });
    },
    [routedPartnerId, loadDayRoute],
  );

  const closeRoute = useCallback(() => {
    setDayRoute(null);
    setRouteGeometry(null);
    setRoutedPartnerId(null);
  }, []);

  // Data mudou com um parceiro roteado: o dia na tela ficaria de outra data.
  useEffect(() => {
    if (routedPartnerId) void loadDayRoute(routedPartnerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateYmd]);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  return (
    <div className="flex h-[calc(100vh-250px)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-fx-line">
      <ScheduleLiveMap
        className="flex min-h-0 flex-1 flex-col"
        regionPreset="london"
        points={partnerPoints}
        jobPoints={jobPoints}
        embeddedInCard
        onJobMarkerClick={(jobId) => {
          const j = jobById.get(jobId);
          if (!j) return;
          // Job sem dono: a pergunta certa não é "o que é este job", é "quem
          // está mais perto dele". O ranking responde; o job abre pelo botão.
          if (j.status === "unassigned" || j.status === "auto_assigning") setNearestFor(j);
          else if (onOpenJob) onOpenJob(j);
        }}
        onPartnerMarkerClick={(partnerId) => void loadDayRoute(partnerId)}
        routeGeometry={routeGeometry}
        panToPartnerId={routedPartnerId}
        panNonce={routeNonce}
        resetToLondonNonce={resetNonce}
        searchMarker={
          dayRoute?.home
            ? { latitude: dayRoute.home.latitude, longitude: dayRoute.home.longitude, label: "🏠 " + dayRoute.partnerName }
            : null
        }
        toolbarExtra={
          semCoordenada > 0 ? (
            <span className={LIVE_MAP_TOOLBAR_BTN_CLASS} title="Jobs without coordinates cannot be drawn. Fix the address to place them.">
              <RefreshCw className="hidden" aria-hidden />
              {semCoordenada} job{semCoordenada === 1 ? "" : "s"} off-map
            </span>
          ) : undefined
        }
        bottomRightOverlay={
          nearestFor ? (
            <NearestPartnersPanel
              job={nearestFor}
              partners={partners}
              jobs={jobs}
              onClose={() => setNearestFor(null)}
              onOpenJob={onOpenJob}
              onAssign={(partnerId) => {
                if (onAssignJob) onAssignJob(nearestFor, partnerId);
                setNearestFor(null);
              }}
            />
          ) : undefined
        }
        filterOverlay={
          dayRoute || routeLoading ? (
            <LiveMapDayRoutePanel
              route={dayRoute}
              loading={routeLoading}
              onClose={closeRoute}
              onBackToLondon={() => {
                closeRoute();
                setResetNonce((n) => n + 1);
              }}
              onStopClick={(jobId) => {
                const j = jobById.get(jobId);
                if (j && onOpenJob) onOpenJob(j);
                else setRouteNonce((n) => n + 1);
              }}
              onReorder={handleReorder}
            />
          ) : undefined
        }
      />
    </div>
  );
}

/** Distância em linha reta (haversine), em metros. Serve para RANQUEAR. */
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Quem está mais perto de um job sem dono — medido do jeito que importa.
 *
 * "Perto" aqui não é distância da casa: é o quanto a ROTA DO DIA do parceiro
 * cresce se este job entrar nela (melhor ponto de inserção no caminho
 * casa → paradas). Um parceiro a 8 milhas que já passa na porta ganha de um a
 * 3 milhas que teria que desviar. Parceiro sem job no dia conta da casa.
 *
 * Haversine, não Matrix: isto é um RANKING, não uma promessa de minutos. Uma
 * chamada de Matrix por parceiro a cada clique custaria caro e mudaria pouco a
 * ordem; o número mostrado é "+X mi", explícito em ser distância.
 */
function NearestPartnersPanel({
  job,
  partners,
  jobs,
  onClose,
  onOpenJob,
  onAssign,
}: {
  job: Job;
  partners: PartnerPin[];
  jobs: Job[];
  onClose: () => void;
  onOpenJob?: (job: Job) => void;
  onAssign: (partnerId: string) => void;
}) {
  const ranking = useMemo(() => {
    const jLat = Number(job.latitude);
    const jLng = Number(job.longitude);
    if (!Number.isFinite(jLat) || !Number.isFinite(jLng)) return [];
    const out: Array<{ p: PartnerPin; detourM: number; stops: number }> = [];
    for (const p of partners) {
      // A rota do dia dele: casa + paradas com coordenada, na ordem da lista.
      const pts: Array<[number, number]> = [[p.latitude, p.longitude]];
      const dele = jobs.filter(
        (x) => x.partner_id === p.id && Number.isFinite(Number(x.latitude)) && Number.isFinite(Number(x.longitude)),
      );
      for (const x of dele) pts.push([Number(x.latitude), Number(x.longitude)]);
      let detourM: number;
      if (pts.length === 1) {
        detourM = distM(p.latitude, p.longitude, jLat, jLng);
      } else {
        // Melhor inserção: min sobre as pernas de (a→job→b) − (a→b), mais a
        // opção de pendurar no fim do dia.
        detourM = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[i + 1] ?? null;
          const custo = b
            ? distM(a[0], a[1], jLat, jLng) + distM(jLat, jLng, b[0], b[1]) - distM(a[0], a[1], b[0], b[1])
            : distM(a[0], a[1], jLat, jLng);
          if (custo < detourM) detourM = custo;
        }
      }
      out.push({ p, detourM, stops: dele.length });
    }
    return out.sort((a, b) => a.detourM - b.detourM).slice(0, 6);
  }, [job, partners, jobs]);

  return (
    <div className="w-[280px] max-w-[80vw] space-y-2 rounded-lg border border-[#E4E4E8] bg-white/95 p-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9A2A00]">Nearest partners</p>
          <p className="truncate text-[12px] font-semibold text-[#020040]">
            {job.reference} · {job.title}
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-[10px] font-medium text-[#64748B] hover:text-[#020040]">
          Clear ✕
        </button>
      </div>
      {onOpenJob ? (
        <button type="button" onClick={() => onOpenJob(job)} className="text-[10px] font-medium text-[#020040] hover:underline">
          Open job details →
        </button>
      ) : null}
      {ranking.length === 0 ? (
        <p className="text-[11px] text-[#64748B]">No partner with a saved base address to measure from.</p>
      ) : (
        <div className="max-h-[280px] space-y-1 overflow-y-auto overscroll-contain pr-0.5">
          {ranking.map(({ p, detourM, stops }) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md border border-[#E4E4E8] bg-[#FAFAFB] px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-[#020040]">{p.name}</span>
                <span className="block text-[10px] text-[#64748B]">
                  +{(detourM / 1609).toFixed(1)} mi off route · {stops === 0 ? "free today" : `${stops} job${stops === 1 ? "" : "s"} today`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onAssign(p.id)}
                className="shrink-0 rounded-md bg-[#020040] px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-[#0A0A5E]"
              >
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-[#64748B]">Straight-line detour on today&apos;s route — a ranking, not an ETA.</p>
    </div>
  );
}
