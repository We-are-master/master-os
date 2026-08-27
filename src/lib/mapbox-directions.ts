/**
 * Thin wrapper around the Mapbox Directions API used by the Live View map's
 * "route partner → next job" affordance. Only fires on explicit user intent
 * (partner pin click) so the cost stays predictable.
 *
 * Docs: https://docs.mapbox.com/api/navigation/directions/
 */

export type Coord = { latitude: number; longitude: number };

export type DrivingRoute = {
  /** GeoJSON LineString geometry — pass directly into a Mapbox source. */
  geometry: { type: "LineString"; coordinates: [number, number][] };
  /** Total driving duration in seconds. */
  durationSec: number;
  /** Total distance in metres. */
  distanceM: number;
};

const ENDPOINT = "https://api.mapbox.com/directions/v5/mapbox/driving";

/**
 * Fetch a driving route between two points. Returns `null` when:
 *   - the env token is missing
 *   - the coordinates are invalid
 *   - Mapbox returns zero routes
 *   - the network call fails
 *
 * Caller decides UX on null (e.g. fall back to a straight line + great-circle
 * distance), so this never throws.
 */
export async function getDrivingRoute(from: Coord, to: Coord): Promise<DrivingRoute | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  if (!Number.isFinite(from.latitude) || !Number.isFinite(from.longitude)) return null;
  if (!Number.isFinite(to.latitude) || !Number.isFinite(to.longitude)) return null;

  const path = `${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`;
  const url = `${ENDPOINT}/${path}?geometries=geojson&overview=simplified&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{
        geometry?: { type: string; coordinates: [number, number][] };
        duration?: number;
        distance?: number;
      }>;
    };
    const route = json.routes?.[0];
    if (!route?.geometry || !Array.isArray(route.geometry.coordinates)) return null;
    return {
      geometry: { type: "LineString", coordinates: route.geometry.coordinates },
      durationSec: Number(route.duration ?? 0),
      distanceM: Number(route.distance ?? 0),
    };
  } catch {
    return null;
  }
}

/** Human-friendly duration formatter: 47s → "1 min", 1230s → "21 min", 7320s → "2 h 2 min". */
export function formatDuration(sec: number): string {
  const totalMin = Math.max(0, Math.round(sec / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Human-friendly distance formatter in miles (UK convention). 5230m → "3.2 mi". */
export function formatDistanceMiles(metres: number): string {
  const miles = metres / 1609.344;
  if (miles < 0.1) return "< 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}

export type DrivingRouteMulti = DrivingRoute & {
  /** Duração/distância de cada perna (waypoint N → N+1), na ordem. */
  legs: Array<{ durationSec: number; distanceM: number }>;
};

/**
 * Rota de carro por VÁRIAS paradas na ordem dada (casa do parceiro → job 1 →
 * job 2…). Directions aceita até 25 waypoints — um dia de parceiro nunca chega
 * perto. Mesmo contrato do single: null em vez de throw, o caller decide.
 */
export async function getDrivingRouteMulti(points: Coord[]): Promise<DrivingRouteMulti | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const valid = points.filter(
    (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (valid.length < 2) return null;

  const path = valid
    .slice(0, 25)
    .map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
    .join(";");
  const url = `${ENDPOINT}/${path}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{
        geometry?: { type: string; coordinates: [number, number][] };
        duration?: number;
        distance?: number;
        legs?: Array<{ duration?: number; distance?: number }>;
      }>;
    };
    const route = json.routes?.[0];
    if (!route?.geometry || !Array.isArray(route.geometry.coordinates)) return null;
    return {
      geometry: { type: "LineString", coordinates: route.geometry.coordinates },
      durationSec: Number(route.duration ?? 0),
      distanceM: Number(route.distance ?? 0),
      legs: (route.legs ?? []).map((l) => ({
        durationSec: Number(l.duration ?? 0),
        distanceM: Number(l.distance ?? 0),
      })),
    };
  } catch {
    return null;
  }
}

/**
 * A ORDEM ótima de visita, via Matrix API + menor caminho em JS.
 *
 * A Optimization v1 devolve NotImplemented para roundtrip=false sem
 * destination fixo (visto na prática, 25/08). A Matrix dá a tabela de
 * durações em UMA chamada e, com até 8 paradas, o caminho mínimo por força
 * bruta é instantâneo e determinístico. Partindo de `start` quando existir;
 * caso contrário, o melhor ponto de partida entra na conta.
 *
 * Devolve os índices de `stops` na ordem de visita, ou null (caller mantém a
 * ordem que já tinha).
 */
export async function getOptimizedStopOrder(
  stops: Coord[],
  opts?: { start?: Coord | null },
): Promise<number[] | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const valid = stops.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (valid.length < 2 || valid.length !== stops.length || stops.length > 8) return null;

  // Casa a mais de ~50km do miolo das paradas é dado sujo (ex.: "Hope Farm"
  // geocodado na outra ponta do país) — melhor otimizar sem ponto de partida
  // do que partir de um lugar onde o parceiro não está.
  let start = opts?.start ?? null;
  if (start) {
    const cLat = stops.reduce((a, p) => a + p.latitude, 0) / stops.length;
    const cLng = stops.reduce((a, p) => a + p.longitude, 0) / stops.length;
    const km =
      Math.hypot(start.latitude - cLat, (start.longitude - cLng) * Math.cos((cLat * Math.PI) / 180)) * 111;
    if (!Number.isFinite(km) || km > 50) start = null;
  }

  const coords = [...(start ? [start] : []), ...stops];
  const path = coords.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(";");
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${path}?annotations=duration&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { code?: string; durations?: number[][] };
    const dur = json.durations;
    if (json.code !== "Ok" || !dur) return null;

    const offset = start ? 1 : 0;
    const n = stops.length;
    let melhor: number[] | null = null;
    let melhorCusto = Infinity;
    const permutar = (resto: number[], atual: number[], custo: number, pos: number | null) => {
      if (custo >= melhorCusto) return;
      if (resto.length === 0) {
        melhorCusto = custo;
        melhor = atual;
        return;
      }
      for (const idx of resto) {
        const de = pos == null ? (start ? 0 : null) : idx0(pos);
        const perna = de == null ? 0 : dur[de]?.[idx0(idx)] ?? Infinity;
        permutar(resto.filter((r) => r !== idx), [...atual, idx], custo + perna, idx);
      }
    };
    const idx0 = (stopIdx: number) => stopIdx + offset;
    permutar([...Array(n).keys()], [], 0, null);
    return melhor;
  } catch {
    return null;
  }
}
