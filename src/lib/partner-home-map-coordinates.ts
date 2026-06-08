import { MAPBOX_UK_CENTER_LON_LAT } from "@/lib/mapbox-uk-geography";
import { normalizeLiveMapCoordinate } from "@/lib/live-map-coordinate";

export type PartnerHomeMapFields = {
  id: string;
  partner_address?: string | null;
  partner_address_latitude?: number | null;
  partner_address_longitude?: number | null;
  coverage_latitude?: number | null;
  coverage_longitude?: number | null;
  included_postcodes?: string[] | null;
  coverage_cities?: string[] | null;
  service_radius_miles?: number | null;
  coverage_base_postcode?: string | null;
};

/** Spread markers that share the same fallback hub so they remain clickable. */
export function partnerMapJitter(partnerId: string, spreadDeg: number): { dLat: number; dLng: number } {
  let hash = 0;
  for (let i = 0; i < partnerId.length; i++) {
    hash = (hash * 31 + partnerId.charCodeAt(i)) >>> 0;
  }
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = spreadDeg * (0.35 + ((hash >> 8) % 65) / 100);
  return {
    dLat: Math.sin(angle) * radius,
    dLng: Math.cos(angle) * radius,
  };
}

function ukCenterJitter(partnerId: string, spreadDeg: number): { latitude: number; longitude: number } {
  const [baseLng, baseLat] = MAPBOX_UK_CENTER_LON_LAT;
  const jitter = partnerMapJitter(partnerId, spreadDeg);
  return {
    latitude: baseLat + jitter.dLat,
    longitude: baseLng + jitter.dLng,
  };
}

/** Sync fallback when home coords are not stored and geocode has not run yet. */
export function fallbackPartnerHomeMapCoordinates(
  partner: PartnerHomeMapFields,
): { latitude: number; longitude: number } {
  const fromHome = normalizeLiveMapCoordinate(
    partner.partner_address_latitude,
    partner.partner_address_longitude,
  );
  if (fromHome) return fromHome;

  const fromCoverage = normalizeLiveMapCoordinate(
    partner.coverage_latitude,
    partner.coverage_longitude,
  );
  if (fromCoverage) return fromCoverage;

  const hasCoverage =
    (partner.included_postcodes?.length ?? 0) > 0 ||
    (partner.coverage_cities?.length ?? 0) > 0 ||
    Number(partner.service_radius_miles ?? 0) > 0 ||
    Boolean(partner.coverage_base_postcode?.trim());

  return ukCenterJitter(partner.id, hasCoverage ? 0.06 : 0.2);
}

/**
 * Resolve map pin from home / business address — never live GPS.
 * Uses stored home lat/lng, then geocodes `partner_address`, then coverage pin, then UK jitter.
 */
export async function resolvePartnerHomeMapCoordinates(
  partner: PartnerHomeMapFields,
  geocodeAddress?: (address: string) => Promise<{ latitude: number; longitude: number } | null>,
): Promise<{ latitude: number; longitude: number }> {
  const fromStored = normalizeLiveMapCoordinate(
    partner.partner_address_latitude,
    partner.partner_address_longitude,
  );
  if (fromStored) return fromStored;

  const address = partner.partner_address?.trim();
  if (address && geocodeAddress) {
    const geocoded = await geocodeAddress(address);
    const fromGeocode = normalizeLiveMapCoordinate(geocoded?.latitude, geocoded?.longitude);
    if (fromGeocode) return fromGeocode;
  }

  return fallbackPartnerHomeMapCoordinates(partner);
}

/** Geocode home address for persistence when saving a partner profile. */
export async function partnerHomeAddressGeocodePatch(
  address: string | null | undefined,
  geocodeAddress: (address: string) => Promise<{ latitude: number; longitude: number } | null>,
): Promise<{
  partner_address: string | null;
  partner_address_latitude: number | null;
  partner_address_longitude: number | null;
}> {
  const trimmed = address?.trim() ?? "";
  if (!trimmed) {
    return {
      partner_address: null,
      partner_address_latitude: null,
      partner_address_longitude: null,
    };
  }
  const coords = await geocodeAddress(trimmed);
  return {
    partner_address: trimmed,
    partner_address_latitude: coords?.latitude ?? null,
    partner_address_longitude: coords?.longitude ?? null,
  };
}
