/** Approximate circle polygon on WGS84 (miles). No Turf dependency. */
export function circlePolygon(
  longitude: number,
  latitude: number,
  radiusMiles: number,
  steps = 64,
): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const earthRadiusMiles = 3958.7613;
  const distRad = radiusMiles / earthRadiusMiles;
  const latRad = (latitude * Math.PI) / 180;
  const lngRad = (longitude * Math.PI) / 180;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(distRad) +
        Math.cos(latRad) * Math.sin(distRad) * Math.cos(bearing),
    );
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(distRad) * Math.cos(latRad),
        Math.cos(distRad) - Math.sin(latRad) * Math.sin(lat2),
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }

  return { type: "Polygon", coordinates: [coords] };
}

export function circleBounds(
  longitude: number,
  latitude: number,
  radiusMiles: number,
): [[number, number], [number, number]] {
  const poly = circlePolygon(longitude, latitude, radiusMiles, 32);
  const ring = poly.coordinates[0] ?? [];
  let minLng = longitude;
  let maxLng = longitude;
  let minLat = latitude;
  let maxLat = latitude;
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
