import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { geocodeUkAddressServer } from "@/lib/job-geocode-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/partners/[id]/day-route?date=YYYY-MM-DD
 *
 * O dia de UM parceiro, pronto para o modo rota do Live View:
 *   - `home`: de onde ele SAI — o endereço de casa (partner_address, decisão
 *     do dono 24/08), com fallback no postcode base de cobertura;
 *   - `stops`: os jobs dele na data, ordenados pela janela de chegada;
 *   - `openNearby`: jobs SEM dono (unassigned/auto_assigning) da mesma data ou
 *     sem data, com coordenada — a camada de oportunidades do mapa.
 *
 * Parada sem coordenada é geocodada aqui e PERSISTIDA: o mapa nunca recebe
 * parada cega duas vezes. A rota em si (linha + tempos) é desenhada no client
 * via Mapbox Directions — esta API é só o dado.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "invalid partner id" }, { status: 400 });
  const date = req.nextUrl.searchParams.get("date")?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // O pin do Live View identifica o parceiro pelo AUTH USER id quando a conta
  // está linkada (mapId = auth_user_id || id) — aceita os dois, senão o clique
  // no mapa morre num 404 silencioso.
  const { data: partnerRow } = await supabase
    .from("partners")
    .select(
      "id, company_name, contact_name, partner_address, partner_address_latitude, partner_address_longitude, coverage_base_postcode, coverage_latitude, coverage_longitude",
    )
    .or(`id.eq.${id},auth_user_id.eq.${id}`)
    .limit(1)
    .maybeSingle();
  if (!partnerRow) return NextResponse.json({ error: "partner not found" }, { status: 404 });
  const p = partnerRow as {
    id: string;
    company_name: string | null;
    contact_name: string | null;
    partner_address: string | null;
    partner_address_latitude: number | null;
    partner_address_longitude: number | null;
    coverage_base_postcode: string | null;
    coverage_latitude: number | null;
    coverage_longitude: number | null;
  };

  // A casa do parceiro. Sem coordenada gravada, tenta geocodar e PERSISTE.
  let home: { latitude: number; longitude: number; label: string } | null = null;
  if (p.partner_address_latitude != null && p.partner_address_longitude != null) {
    home = {
      latitude: p.partner_address_latitude,
      longitude: p.partner_address_longitude,
      label: p.partner_address?.trim() || "Partner base",
    };
  } else {
    const alvo = p.partner_address?.trim() || p.coverage_base_postcode?.trim() || null;
    const geo = alvo ? await geocodeUkAddressServer(alvo) : null;
    if (geo) {
      home = { ...geo, label: alvo ?? "Partner base" };
      await supabase
        .from("partners")
        .update({ partner_address_latitude: geo.latitude, partner_address_longitude: geo.longitude })
        .eq("id", p.id);
    } else if (p.coverage_latitude != null && p.coverage_longitude != null) {
      home = {
        latitude: p.coverage_latitude,
        longitude: p.coverage_longitude,
        label: p.coverage_base_postcode?.trim() || "Coverage base",
      };
    }
  }

  // select("*") defensivo (padrão da mig 281): route_seq só existe pós-282 e a
  // rota não pode morrer num 400 de coluna enquanto o SQL não for colado.
  const STOP_SELECT = "*";

  const [{ data: stopRows }, { data: openRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select(STOP_SELECT)
      .eq("partner_id", p.id)
      .eq("scheduled_date", date)
      .is("deleted_at", null)
      .not("status", "in", "(cancelled,deleted)")
      .order("scheduled_start_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("jobs")
      .select(STOP_SELECT)
      .is("partner_id", null)
      .in("status", ["unassigned", "auto_assigning"])
      .is("deleted_at", null)
      .or(`scheduled_date.eq.${date},scheduled_date.is.null`),
  ]);

  type Row = {
    id: string;
    reference: string;
    title: string | null;
    status: string;
    client_name: string | null;
    property_address: string | null;
    latitude: number | null;
    longitude: number | null;
    scheduled_date: string | null;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
    client_price: number | null;
    partner_cost: number | null;
    job_type: string | null;
    hourly_partner_rate: number | null;
    route_seq?: number | null;
  };

  // Parada cega geocoda na hora e grava — uma vez só por job.
  const completar = async (rows: Row[]): Promise<Row[]> => {
    for (const r of rows) {
      if (r.latitude != null && r.longitude != null) continue;
      const geo = await geocodeUkAddressServer(r.property_address);
      if (!geo) continue;
      r.latitude = geo.latitude;
      r.longitude = geo.longitude;
      await supabase
        .from("jobs")
        .update({ latitude: geo.latitude, longitude: geo.longitude })
        .eq("id", r.id);
    }
    return rows;
  };

  const stops = await completar((stopRows ?? []) as Row[]);
  // Ordem decidida à mão (drag no painel, mig 282) vence a janela de chegada;
  // sem route_seq, fica a ordem do banco (scheduled_start_at asc).
  if (stops.some((s) => s.route_seq != null)) {
    stops.sort((a, b) => (a.route_seq ?? Number.MAX_SAFE_INTEGER) - (b.route_seq ?? Number.MAX_SAFE_INTEGER));
  }
  const openNearby = ((openRows ?? []) as Row[]).filter(
    (r) => r.latitude != null && r.longitude != null,
  );

  return NextResponse.json({
    partner: {
      id: p.id,
      name: p.company_name?.trim() || p.contact_name?.trim() || "Partner",
      home,
    },
    date,
    stops,
    openNearby,
    stopsWithoutLocation: stops.filter((s) => s.latitude == null).map((s) => s.reference),
  });
}
