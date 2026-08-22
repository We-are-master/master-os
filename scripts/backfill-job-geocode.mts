/**
 * Fills `jobs.latitude` / `jobs.longitude` from `jobs.property_address`.
 *
 * Why this exists: `OPENCAGE_API_KEY` was never set, so `/api/geocode/opencage`
 * answered 503 to every lookup and jobs were saved with a full address and no
 * coordinates. They have no pin on the Live View map. The route now falls back
 * to Mapbox for new jobs; this backfills the ones already in the database.
 *
 * Dry run (default):
 *   npx tsx scripts/backfill-job-geocode.mts --from=2026-08-01 --to=2026-08-31
 * Write:
 *   npx tsx scripts/backfill-job-geocode.mts --from=2026-08-01 --to=2026-08-31 --write
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const WRITE = args.includes("--write");
const FROM = flag("from");
const TO = flag("to");
const LIMIT = Number(flag("limit") ?? 5000);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY");
if (!MAPBOX_TOKEN) throw new Error("Missing NEXT_PUBLIC_MAPBOX_TOKEN");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

type Row = {
  id: string;
  reference: string;
  scheduled_date: string | null;
  property_address: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** GB-only forward geocode, one result. Same call the API route now falls back to. */
async function geocode(q: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?access_token=${encodeURIComponent(MAPBOX_TOKEN!)}&limit=1` +
    `&types=postcode,address,district,place,locality,neighborhood&country=gb`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
  const c = data.features?.[0]?.center;
  if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  return { lat: c[1], lng: c[0] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let q = supabase
    .from("jobs")
    .select("id, reference, scheduled_date, property_address, latitude, longitude")
    .is("deleted_at", null)
    .neq("status", "deleted")
    .neq("status", "cancelled")
    .is("latitude", null)
    .order("scheduled_date", { ascending: true })
    .limit(LIMIT);
  if (FROM) q = q.gte("scheduled_date", FROM);
  if (TO) q = q.lte("scheduled_date", TO);

  const { data, error } = await q;
  if (error) throw error;

  const rows = ((data ?? []) as Row[]).filter((j) => (j.property_address ?? "").trim().length > 5);
  console.log(`${rows.length} jobs without coordinates${FROM ? ` between ${FROM} and ${TO ?? "…"}` : ""}`);
  console.log(WRITE ? "MODE: WRITE\n" : "MODE: dry run (pass --write to save)\n");

  let ok = 0;
  let notFound = 0;
  let failed = 0;

  for (const j of rows) {
    const addr = (j.property_address ?? "").trim();
    const hit = await geocode(addr);
    if (!hit) {
      notFound++;
      console.log(`  ✕ ${j.reference}  no match  ← ${addr.slice(0, 52)}`);
      await sleep(120);
      continue;
    }
    if (WRITE) {
      const { error: upErr } = await supabase
        .from("jobs")
        .update({ latitude: hit.lat, longitude: hit.lng })
        .eq("id", j.id)
        .is("latitude", null); // never overwrite a coordinate someone already set
      if (upErr) {
        failed++;
        console.log(`  ! ${j.reference}  write failed: ${upErr.message}`);
        await sleep(120);
        continue;
      }
    }
    ok++;
    console.log(
      `  ${WRITE ? "✔" : "·"} ${j.reference}  ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}  ← ${addr.slice(0, 46)}`,
    );
    await sleep(120);
  }

  console.log(`\n${WRITE ? "written" : "would write"}: ${ok} · no match: ${notFound} · failed: ${failed}`);
}

await main();
