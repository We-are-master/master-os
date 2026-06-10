/**
 * Generate Fixfy School Services & Pricing PDF from live service_catalog.
 * Run: npm run generate:school-pricing-pdf
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildSchoolServiceCatalogPayloadFromRows } from "../src/lib/fixfy-school-service-catalog.ts";
import { SchoolServicesPricingPDF } from "../src/lib/pdf/school-services-pricing-template.tsx";
import type { CatalogService } from "../src/types/database.ts";

function loadEnvFile(name: string) {
  const path = join(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    console.error("Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("service_catalog")
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const payload = await buildSchoolServiceCatalogPayloadFromRows((data ?? []) as CatalogService[]);
  if (payload.totalActive === 0) {
    console.error("No active services in service_catalog.");
    process.exit(1);
  }

  const buffer = await renderToBuffer(
    React.createElement(SchoolServicesPricingPDF, { payload }) as Parameters<typeof renderToBuffer>[0],
  );

  const outDir = join(process.cwd(), "public/school/fixfy-school");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "Fixfy-School-Services-Pricing.pdf");
  writeFileSync(outPath, buffer);

  console.log(`Wrote ${outPath}`);
  console.log(`${payload.totalActive} active services · ${payload.categories.length} categories`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
