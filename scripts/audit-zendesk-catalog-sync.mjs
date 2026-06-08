#!/usr/bin/env node
/**
 * Compare OS service_catalog + pricing_presets against live Zendesk dropdown fields.
 *
 * Usage:
 *   node scripts/audit-zendesk-catalog-sync.mjs
 *   node scripts/audit-zendesk-catalog-sync.mjs --fix   # dry-run backfill plan only
 *
 * Requires: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN,
 *             SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL + key)
 */

import { createClient } from "@supabase/supabase-js";

const FIX = process.argv.includes("--fix");

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL = process.env.ZENDESK_EMAIL?.trim();
const API_TOKEN = process.env.ZENDESK_API_TOKEN?.trim();
const TOW_FIELD_ID = process.env.ZENDESK_TYPE_OF_WORK_FIELD_ID?.trim() || "5687087915551";

const BAND_FIELD_BY_SERVICE_ID = {
  "06271726-30ca-4f5f-9579-384de83d8ecf": 5853839193247,
  "a1f8b034-28d4-4775-8c47-272df6701aa2": 5853837434527,
  "e0cbd852-c10c-4aac-b52c-dfd274b65848": 5853864806559,
  "7796473e-c22b-4452-a22f-de1b8a87045a": 5853839199903,
  "d978384e-d1be-45ef-914a-9172f8d9fe62": 5853819554335,
  "ea6d7f17-1a9b-44ea-87d8-0e9ebf857431": 5854678454047,
};

function authHeader() {
  return "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
}

async function fetchZendeskField(fieldId) {
  const res = await fetch(
    `https://${SUBDOMAIN}.zendesk.com/api/v2/ticket_fields/${fieldId}.json`,
    { headers: { Authorization: authHeader(), Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Zendesk GET ${fieldId}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.ticket_field?.custom_field_options ?? [];
}

function fromServiceTag(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const stripped = t.replace(/^os_/i, "");
  return /^[0-9a-f-]{36}$/i.test(stripped) ? stripped : null;
}

function fromBandTag(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const stripped = t.replace(/^band_/i, "");
  return /^[0-9a-f-]{36}$/i.test(stripped) ? stripped : null;
}

function formatBandName(label, price) {
  const p = Number(price);
  if (Number.isFinite(p) && p > 0) return `${label} - £${p.toFixed(2)}`;
  return label;
}

function parsePresets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p) => p && typeof p.id === "string");
}

async function main() {
  if (!SUBDOMAIN || !EMAIL || !API_TOKEN) {
    console.error("Missing ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, or ZENDESK_API_TOKEN");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const issues = [];

  const { data: catalogRows, error: catErr } = await supabase
    .from("service_catalog")
    .select("id, name, pricing_presets, is_active")
    .is("deleted_at", null)
    .eq("is_active", true);
  if (catErr) throw catErr;

  console.log("\n=== Type of Work ===");
  const towOptions = await fetchZendeskField(TOW_FIELD_ID);
  const towByCatalogId = new Map();
  for (const o of towOptions) {
    const id = fromServiceTag(o.value);
    if (id) towByCatalogId.set(id, o);
    else if (o.value && !o.value.startsWith("os_")) {
      issues.push({ kind: "tow_bad_tag", value: o.value, name: o.name });
    }
  }

  for (const row of catalogRows ?? []) {
    const zd = towByCatalogId.get(row.id);
    const expectedTag = `os_${row.id}`;
    if (!zd) {
      issues.push({ kind: "tow_missing", catalogId: row.id, name: row.name });
    } else if (zd.value !== expectedTag) {
      issues.push({ kind: "tow_wrong_tag", catalogId: row.id, expected: expectedTag, got: zd.value });
    } else if (zd.name !== row.name) {
      issues.push({ kind: "tow_name_drift", catalogId: row.id, os: row.name, zd: zd.name });
    }
  }

  for (const [catalogId, fieldId] of Object.entries(BAND_FIELD_BY_SERVICE_ID)) {
    const row = (catalogRows ?? []).find((r) => r.id === catalogId);
    if (!row) {
      issues.push({ kind: "band_service_missing", catalogId });
      continue;
    }
    const presets = parsePresets(row.pricing_presets);
    console.log(`\n=== Bands: ${row.name} (${presets.length}) ===`);
    const bandOptions = await fetchZendeskField(fieldId);
    const bandById = new Map();
    for (const o of bandOptions) {
      const id = fromBandTag(o.value);
      if (id) bandById.set(id, o);
    }
    for (const p of presets) {
      const zd = bandById.get(p.id);
      const expectedTag = `band_${p.id}`;
      const expectedName = formatBandName(p.label ?? "Band", p.fixed_price);
      if (!zd) {
        issues.push({ kind: "band_missing", catalogId, bandId: p.id, label: p.label });
      } else {
        if (zd.value !== expectedTag) {
          issues.push({ kind: "band_wrong_tag", bandId: p.id, expected: expectedTag, got: zd.value });
        }
        if (zd.name !== expectedName) {
          issues.push({ kind: "band_name_drift", bandId: p.id, os: expectedName, zd: zd.name });
        }
      }
    }
    for (const o of bandOptions) {
      const id = fromBandTag(o.value);
      if (id && !presets.some((p) => p.id === id)) {
        issues.push({ kind: "band_orphan", catalogId, bandId: id, name: o.name });
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Issues: ${issues.length}`);
  if (issues.length) {
    for (const i of issues) console.log(JSON.stringify(i));
  } else {
    console.log("OK — OS and Zendesk are in sync.");
  }

  if (FIX && issues.length) {
    console.log("\nRun backfill via OS API:");
    console.log("  POST /api/admin/service-catalog/zendesk-sync");
    console.log("  Body: { \"syncBands\": true }");
    console.log("(requires admin session + Zendesk env on the server)");
  }

  process.exit(issues.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
