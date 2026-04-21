"use client";

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const UK_BOUNDS: Bounds = { minLat: 49.5, maxLat: 58.9, minLng: -8.8, maxLng: 2.5 };
const EUROPE_BOUNDS: Bounds = { minLat: 35.0, maxLat: 71.5, minLng: -12.5, maxLng: 41.5 };

function inBounds(lat: number, lng: number, b: Bounds): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function normalizeLiveMapCoordinate(
  latitudeRaw: unknown,
  longitudeRaw: unknown,
): { latitude: number; longitude: number; swapped: boolean } | null {
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return null;

  const directValid = Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const swappedValid = Math.abs(longitude) <= 90 && Math.abs(latitude) <= 180;
  if (!directValid && !swappedValid) return null;

  if (directValid && !swappedValid) {
    return { latitude, longitude, swapped: false };
  }
  if (!directValid && swappedValid) {
    return { latitude: longitude, longitude: latitude, swapped: true };
  }

  const directInUk = inBounds(latitude, longitude, UK_BOUNDS);
  const swappedInUk = inBounds(longitude, latitude, UK_BOUNDS);
  const directInEurope = inBounds(latitude, longitude, EUROPE_BOUNDS);
  const swappedInEurope = inBounds(longitude, latitude, EUROPE_BOUNDS);

  if ((swappedInUk && !directInUk) || (swappedInEurope && !directInEurope && !directInUk)) {
    return { latitude: longitude, longitude: latitude, swapped: true };
  }

  return { latitude, longitude, swapped: false };
}
