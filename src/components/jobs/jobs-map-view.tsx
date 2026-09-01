"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getDrivingRouteMulti, formatDuration, formatDistanceMiles, type Coord } from "@/lib/mapbox-directions";
import { formatArrivalTimeRange } from "@/lib/schedule-calendar";
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

/** Uma cor por rota de parceiro — repetem a partir da sétima. */
const ROUTE_COLORS = ["#ED4B00", "#020040", "#12704F", "#7C3AED", "#0E7490", "#B45309"];

/** Só rotas de dia de trabalho: entregue/cancelado não dirige mais. */
const ROUTED_STATUSES = new Set(["scheduled", "late", "in_progress", "on_hold", "final_check"]);

/** Teto de chamadas do Directions por render — acima disso o mapa vira macarrão. */
const MAX_AUTO_ROUTES = 6;

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

type PartnerPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  trade: string | null;
  trades: string[] | null;
};

type AutoRoute = {
  partnerId: string;
  partnerName: string;
  color: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  totalSec: number;
  totalM: number;
  stops: number;
  /** ETA por job: fim da janela anterior + perna — a regra do painel do dia. */
  etaByJobId: Map<string, string>;
};

/**
 * O melhor ponto de inserção do job na rota do dia de um parceiro, em metros
 * de DESVIO — não distância da casa. Parceiro sem parada conta da casa.
 */
function detourM(p: PartnerPin, dele: Job[], jLat: number, jLng: number): number {
  const pts: Array<[number, number]> = [[p.latitude, p.longitude]];
  for (const x of dele) pts.push([Number(x.latitude), Number(x.longitude)]);
  if (pts.length === 1) return distM(p.latitude, p.longitude, jLat, jLng);
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1] ?? null;
    const custo = b
      ? distM(a[0], a[1], jLat, jLng) + distM(jLat, jLng, b[0], b[1]) - distM(a[0], a[1], b[0], b[1])
      : distM(a[0], a[1], jLat, jLng);
    if (custo < best) best = custo;
  }
  return best;
}

/**
 * O modo MAPA do Jobs Management: a experiência do Live View dentro da página
 * onde o trabalho de alocar acontece de verdade.
 *
 * Três comportamentos, um por pergunta que a tela responde (dono, 27/08):
 *
 * 1. ABRIU, JÁ MOSTRA O DIA. Cada parceiro com job na lista ganha a rota
 *    desenhada (casa → paradas, Directions real) com a própria cor, e a
 *    legenda diz milhas e minutos por parceiro. Ninguém precisa clicar para
 *    saber quem roda o quê.
 *
 * 2. JOB SEM DONO responde "quem está mais perto". Hover no pin desenha a
 *    linha até o melhor parceiro; clique abre o ranking por DESVIO de rota
 *    (não distância da casa), com milhas e minutos REAIS de carro para o
 *    primeiro. O Assign abre o modal de sempre — preço e avisos continuam lá.
 *
 * 3. CADA PIN CONTA O JOB. O popup traz janela de chegada, ETA da rota (fim da
 *    parada anterior + perna, a regra do painel) e as primeiras linhas do
 *    scope.
 *
 * Nada aqui refaz infra: mesmo ScheduleLiveMap, mesma /day-route, mesma
 * /route-order. Directions é pago: as rotas automáticas param em 6 parceiros e
 * são cacheadas pela assinatura (parceiro + paradas); pan/zoom não regera nada.
 */
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
  const [nearestFor, setNearestFor] = useState<Job | null>(null);
  const [hoverLine, setHoverLine] = useState<{ id: string; coords: [number, number][] } | null>(null);
  const [autoRoutes, setAutoRoutes] = useState<AutoRoute[]>([]);
  /** Milhas/minutos REAIS de carro casa→job para o topo do ranking. */
  const [nearestDrive, setNearestDrive] = useState<{ partnerId: string; sec: number; m: number } | null>(null);

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

  /**
   * ABRIU, JÁ MOSTRA O DIA: uma rota real por parceiro com job roteável na
   * lista. Cache pela assinatura (parceiro + ordem das paradas): filtrar,
   * abrir painel ou reordenar regera só o que mudou de fato.
   */
  const autoRouteCache = useRef(new Map<string, AutoRoute>());
  const roteaveisPorParceiro = useMemo(() => {
    const por = new Map<string, Job[]>();
    for (const j of jobs) {
      if (!j.partner_id || !ROUTED_STATUSES.has(j.status)) continue;
      if (!Number.isFinite(Number(j.latitude)) || !Number.isFinite(Number(j.longitude))) continue;
      por.set(j.partner_id, [...(por.get(j.partner_id) ?? []), j]);
    }
    for (const lista of por.values()) {
      lista.sort((a, b) => {
        const am = a.scheduled_start_at ? new Date(a.scheduled_start_at).getTime() : Infinity;
        const bm = b.scheduled_start_at ? new Date(b.scheduled_start_at).getTime() : Infinity;
        return am - bm;
      });
    }
    return por;
  }, [jobs]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: AutoRoute[] = [];
      let i = 0;
      for (const [pid, lista] of roteaveisPorParceiro) {
        if (out.length >= MAX_AUTO_ROUTES) break;
        const p = partners.find((x) => x.id === pid);
        if (!p) continue;
        const cor = ROUTE_COLORS[i % ROUTE_COLORS.length]!;
        i++;
        const sig = `${pid}:${lista.map((j) => j.id).join(",")}`;
        const cached = autoRouteCache.current.get(sig);
        if (cached) {
          out.push({ ...cached, color: cor });
          continue;
        }
        const waypoints: Coord[] = [
          { latitude: p.latitude, longitude: p.longitude },
          ...lista.map((j) => ({ latitude: Number(j.latitude), longitude: Number(j.longitude) })),
        ];
        const multi = waypoints.length >= 2 ? await getDrivingRouteMulti(waypoints) : null;
        if (cancelled) return;
        if (!multi) continue;
        // ETA da parada i = fim da janela anterior + perna. A primeira não tem
        // estimativa: depende de quando ele sai de casa, e chute não é ETA.
        const etaByJobId = new Map<string, string>();
        for (let k = 1; k < lista.length; k++) {
          const prevEnd = lista[k - 1]?.scheduled_end_at;
          const leg = multi.legs[k];
          if (!prevEnd || !leg) continue;
          const eta = new Date(new Date(prevEnd).getTime() + leg.durationSec * 1000);
          etaByJobId.set(
            lista[k]!.id,
            `ETA ${eta.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`,
          );
        }
        const rota: AutoRoute = {
          partnerId: pid,
          partnerName: p.name,
          color: cor,
          geometry: multi.geometry,
          totalSec: multi.durationSec,
          totalM: multi.distanceM,
          stops: lista.length,
          etaByJobId,
        };
        autoRouteCache.current.set(sig, rota);
        out.push(rota);
      }
      if (!cancelled) setAutoRoutes(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [roteaveisPorParceiro, partners]);

  const etaGeral = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of autoRoutes) for (const [id, eta] of r.etaByJobId) m.set(id, eta);
    return m;
  }, [autoRoutes]);

  const jobPoints = useMemo<ScheduleLiveMapJobPoint[]>(() => {
    const pts: ScheduleLiveMapJobPoint[] = [];
    for (const j of jobs) {
      const lat = Number(j.latitude);
      const lng = Number(j.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const janela =
        j.scheduled_start_at && j.scheduled_end_at
          ? formatArrivalTimeRange(j.scheduled_start_at, j.scheduled_end_at)
          : null;
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
        scheduleLine: [j.scheduled_date, janela].filter(Boolean).join(" · "),
        scopePreview: (j.scope ?? "").slice(0, 220) || null,
        etaLabel: etaGeral.get(j.id) ?? null,
      });
    }
    return pts;
  }, [jobs, etaGeral]);

  const semCoordenada = jobs.length - jobPoints.length;
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

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

  /** Hover num job sem dono: linha tracejada até o parceiro de menor desvio. */
  const handleJobHover = useCallback(
    (jobId: string | null) => {
      if (!jobId) {
        setHoverLine(null);
        return;
      }
      const j = jobById.get(jobId);
      if (!j || (j.status !== "unassigned" && j.status !== "auto_assigning")) return;
      const jLat = Number(j.latitude);
      const jLng = Number(j.longitude);
      if (!Number.isFinite(jLat) || !Number.isFinite(jLng)) return;
      let best: { p: PartnerPin; d: number } | null = null;
      for (const p of partners) {
        const d = detourM(p, roteaveisPorParceiro.get(p.id) ?? [], jLat, jLng);
        if (!best || d < best.d) best = { p, d };
      }
      if (!best) return;
      setHoverLine({
        id: `hover:${jobId}:${best.p.id}`,
        coords: [
          [jLng, jLat],
          [best.p.longitude, best.p.latitude],
        ],
      });
    },
    [jobById, partners, roteaveisPorParceiro],
  );

  /**
   * Abriu o ranking: milhas e minutos REAIS de carro (casa → job) para o
   * primeiro colocado. Uma chamada só — os demais ficam no desvio em linha
   * reta, que é o que os ordena.
   */
  useEffect(() => {
    setNearestDrive(null);
    if (!nearestFor) return;
    const jLat = Number(nearestFor.latitude);
    const jLng = Number(nearestFor.longitude);
    if (!Number.isFinite(jLat) || !Number.isFinite(jLng) || partners.length === 0) return;
    let best: { p: PartnerPin; d: number } | null = null;
    for (const p of partners) {
      const d = detourM(p, roteaveisPorParceiro.get(p.id) ?? [], jLat, jLng);
      if (!best || d < best.d) best = { p, d };
    }
    if (!best) return;
    const alvo = best.p;
    let cancelled = false;
    void (async () => {
      const multi = await getDrivingRouteMulti([
        { latitude: alvo.latitude, longitude: alvo.longitude },
        { latitude: jLat, longitude: jLng },
      ]);
      if (!cancelled && multi) setNearestDrive({ partnerId: alvo.id, sec: multi.durationSec, m: multi.distanceM });
    })();
    return () => {
      cancelled = true;
    };
  }, [nearestFor, partners, roteaveisPorParceiro]);

  const extraRoutes = useMemo(() => {
    const rotas: Array<{
      id: string;
      geometry: { type: "LineString"; coordinates: [number, number][] };
      color: string;
      dashed?: boolean;
    }> = autoRoutes
      // Com o dia de um parceiro aberto, a rota principal assume; as outras ficam.
      .filter((r) => r.partnerId !== routedPartnerId)
      .map((r) => ({ id: `auto:${r.partnerId}`, geometry: r.geometry, color: r.color }));
    if (hoverLine) {
      rotas.push({
        id: hoverLine.id,
        geometry: { type: "LineString", coordinates: hoverLine.coords },
        color: "#ED4B00",
        dashed: true,
      });
    }
    return rotas;
  }, [autoRoutes, routedPartnerId, hoverLine]);

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
        onJobMarkerHover={handleJobHover}
        onPartnerMarkerClick={(partnerId) => void loadDayRoute(partnerId)}
        routeGeometry={routeGeometry}
        extraRoutes={extraRoutes}
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
        bottomLeftOverlay={
          autoRoutes.length > 0 ? (
            <div className="max-w-[300px] space-y-1 rounded-lg border border-[#E4E4E8] bg-white/95 p-2 shadow-lg backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Routes today</p>
              {autoRoutes.map((r) => (
                <button
                  key={r.partnerId}
                  type="button"
                  onClick={() => void loadDayRoute(r.partnerId)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[#F1F5F9]"
                >
                  <span className="h-2 w-5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#020040]">{r.partnerName}</span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#64748B]">
                    {r.stops} stop{r.stops === 1 ? "" : "s"} · {formatDistanceMiles(r.totalM)} · {formatDuration(r.totalSec)}
                  </span>
                </button>
              ))}
            </div>
          ) : undefined
        }
        bottomRightOverlay={
          nearestFor ? (
            <NearestPartnersPanel
              job={nearestFor}
              partners={partners}
              roteaveisPorParceiro={roteaveisPorParceiro}
              nearestDrive={nearestDrive}
              onClose={() => setNearestFor(null)}
              onOpenJob={onOpenJob}
              onHoverPartner={(p) => {
                const jLat = Number(nearestFor.latitude);
                const jLng = Number(nearestFor.longitude);
                if (!p || !Number.isFinite(jLat) || !Number.isFinite(jLng)) {
                  setHoverLine(null);
                  return;
                }
                setHoverLine({
                  id: `pick:${nearestFor.id}:${p.id}`,
                  coords: [
                    [jLng, jLat],
                    [p.longitude, p.latitude],
                  ],
                });
              }}
              onAssign={(partnerId) => {
                if (onAssignJob) onAssignJob(nearestFor, partnerId);
                setNearestFor(null);
                setHoverLine(null);
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

/**
 * Quem está mais perto de um job sem dono — medido do jeito que importa.
 *
 * "Perto" não é distância da casa: é o quanto a ROTA DO DIA do parceiro
 * cresce se este job entrar nela. O primeiro colocado ganha milhas e minutos
 * REAIS de carro (uma chamada de Directions); os demais ficam no desvio em
 * linha reta, que é o que os ordena. Hover numa linha desenha o traço até o
 * parceiro no mapa; Assign abre o modal de sempre.
 */
function NearestPartnersPanel({
  job,
  partners,
  roteaveisPorParceiro,
  nearestDrive,
  onClose,
  onOpenJob,
  onHoverPartner,
  onAssign,
}: {
  job: Job;
  partners: PartnerPin[];
  roteaveisPorParceiro: Map<string, Job[]>;
  nearestDrive: { partnerId: string; sec: number; m: number } | null;
  onClose: () => void;
  onOpenJob?: (job: Job) => void;
  onHoverPartner: (p: PartnerPin | null) => void;
  onAssign: (partnerId: string) => void;
}) {
  const ranking = useMemo(() => {
    const jLat = Number(job.latitude);
    const jLng = Number(job.longitude);
    if (!Number.isFinite(jLat) || !Number.isFinite(jLng)) return [];
    return partners
      .map((p) => ({
        p,
        detourM: detourM(p, roteaveisPorParceiro.get(p.id) ?? [], jLat, jLng),
        stops: (roteaveisPorParceiro.get(p.id) ?? []).length,
      }))
      .sort((a, b) => a.detourM - b.detourM)
      .slice(0, 6);
  }, [job, partners, roteaveisPorParceiro]);

  return (
    <div className="w-[290px] max-w-[80vw] space-y-2 rounded-lg border border-[#E4E4E8] bg-white/95 p-2.5 shadow-lg backdrop-blur">
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
          {ranking.map(({ p, detourM: d, stops }, i) => (
            <div
              key={p.id}
              onMouseEnter={() => onHoverPartner(p)}
              onMouseLeave={() => onHoverPartner(null)}
              className="flex items-center gap-2 rounded-md border border-[#E4E4E8] bg-[#FAFAFB] px-2 py-1.5 transition-colors hover:border-[#ED4B00]/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-[#020040]">{p.name}</span>
                <span className="block text-[10px] text-[#64748B]">
                  {i === 0 && nearestDrive?.partnerId === p.id
                    ? `${formatDistanceMiles(nearestDrive.m)} · ${formatDuration(nearestDrive.sec)} drive`
                    : `+${(d / 1609).toFixed(1)} mi off route`}
                  {" · "}
                  {stops === 0 ? "free today" : `${stops} job${stops === 1 ? "" : "s"} today`}
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
      <p className="text-[10px] text-[#64748B]">
        Top result is real driving from home · others are straight-line detour on today&apos;s route.
      </p>
    </div>
  );
}
