"use client";

import { cn } from "@/lib/utils";
import { formatDuration, formatDistanceMiles } from "@/lib/mapbox-directions";

/** Uma parada do dia, já com coordenada resolvida pela API day-route. */
export type DayRouteStop = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  client_name: string | null;
  property_address: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};

export type DayRouteData = {
  partnerId: string;
  partnerName: string;
  date: string;
  home: { latitude: number; longitude: number; label: string } | null;
  stops: DayRouteStop[];
  openNearbyCount: number;
  /** Perna N = deslocamento até a parada N (0 = casa → parada 1). */
  legs: Array<{ durationSec: number; distanceM: number }>;
  totalSec: number;
  totalM: number;
};

function hm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

/**
 * A timeline do dia do parceiro, ao lado do mapa: paradas numeradas na ordem
 * agendada, o deslocamento real entre elas, e o aviso vermelho quando a conta
 * não fecha (chegada estimada depois do fim da janela da próxima parada).
 */
export function LiveMapDayRoutePanel({
  route,
  loading,
  onClose,
  onBackToLondon,
  onStopClick,
}: {
  route: DayRouteData | null;
  loading: boolean;
  onClose: () => void;
  onBackToLondon: () => void;
  onStopClick?: (jobId: string) => void;
}) {
  return (
    <div className="w-[280px] max-w-[80vw] space-y-2 rounded-lg border border-[#E4E4E8] bg-white/95 p-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">Day route</p>
          <p className="truncate text-[12px] font-semibold text-[#020040]">
            {route?.partnerName ?? "Partner"}
            {route ? (
              <span className="ml-1 font-normal text-[#64748B]">
                · {new Date(`${route.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onBackToLondon} className="text-[10px] font-medium text-[#020040] hover:underline">
            London
          </button>
          <button type="button" onClick={onClose} className="text-[10px] font-medium text-[#64748B] hover:text-[#020040]">
            Clear ✕
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[11px] text-[#64748B]">Loading day route…</p>
      ) : !route ? null : route.stops.length === 0 ? (
        <p className="text-[11px] text-[#64748B]">No jobs assigned on this day.</p>
      ) : (
        <>
          {route.home ? (
            <p className="truncate text-[10.5px] text-[#64748B]">
              🏠 Starts from {route.home.label}
            </p>
          ) : (
            <p className="text-[10.5px] text-[#B45309]">No home address on file — route starts at the first job.</p>
          )}

          <div className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-0.5">
            {route.stops.map((stop, i) => {
              const leg = route.legs[i] ?? null;
              // Chegada estimada: fim da parada anterior (ou saída de casa) +
              // deslocamento. Sem horário anterior, sem estimativa — melhor
              // nada do que número inventado.
              const prevEnd = i === 0 ? null : route.stops[i - 1]?.scheduled_end_at ?? null;
              const etaMs =
                leg && prevEnd ? new Date(prevEnd).getTime() + leg.durationSec * 1000 : null;
              const windowEndMs = stop.scheduled_end_at ? new Date(stop.scheduled_end_at).getTime() : null;
              const aperto = etaMs != null && windowEndMs != null && etaMs > windowEndMs;
              return (
                <div key={stop.id}>
                  {leg ? (
                    <p className="py-0.5 pl-[26px] text-[10px] text-[#64748B]">
                      ↓ {formatDuration(leg.durationSec)} drive · {formatDistanceMiles(leg.distanceM)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onStopClick?.(stop.id)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                      aperto
                        ? "border-[#FCA5A5] bg-[#FEF2F2] hover:bg-[#FEE2E2]"
                        : "border-[#E4E4E8] bg-[#FAFAFB] hover:bg-[#F1F5F9]",
                    )}
                  >
                    <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#020040] text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-[#020040]">
                        {stop.title || stop.reference}
                      </span>
                      <span className="block truncate text-[10px] text-[#64748B]">
                        {hm(stop.scheduled_start_at)}–{hm(stop.scheduled_end_at)}
                        {stop.client_name ? ` · ${stop.client_name}` : ""}
                      </span>
                      {aperto ? (
                        <span className="block text-[10px] font-semibold text-[#991B1B]">
                          ⚠ ETA {hm(new Date(etaMs!).toISOString())} — past this window
                        </span>
                      ) : null}
                      {stop.latitude == null ? (
                        <span className="block text-[10px] font-medium text-[#B45309]">No location — out of the route line</span>
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-md bg-[#020040]/5 px-2 py-1.5 text-[11px]">
            <span className="font-semibold text-[#020040]">
              {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} on the road
            </span>
            <span className="font-mono tabular-nums text-[#020040]">
              {route.totalSec > 0 ? `${formatDuration(route.totalSec)} · ${formatDistanceMiles(route.totalM)}` : "—"}
            </span>
          </div>
          {route.openNearbyCount > 0 ? (
            <p className="text-[10.5px] text-[#9A2A00]">
              {route.openNearbyCount} open job{route.openNearbyCount === 1 ? "" : "s"} nearby on the map — click one to assign.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
