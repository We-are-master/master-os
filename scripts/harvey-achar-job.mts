/**
 * ENSAIO do matcher: dá um ticket, mostra qual job ele acharia. Não escreve.
 *
 *   npx tsx scripts/harvey-achar-job.mts 50069 50072 50154 50155
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const { acharJobDoTicket } = await import("../src/lib/zendesk-quoter/achar-job");

const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const auth = "Basic " + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");

for (const id of process.argv.slice(2)) {
  const t: any = await (await fetch(`${base}/tickets/${id}.json`, { headers: { Authorization: auth } })).json();
  const c: any = await (await fetch(`${base}/tickets/${id}/comments.json`, { headers: { Authorization: auth } })).json();
  const cs = c.comments ?? [];
  const texto = [t.ticket.subject, ...cs.map((x: any) => x.plain_body ?? x.body ?? "")].join("\n").slice(0, 6000);
  const html = cs.map((x: any) => x.html_body ?? "").join("\n");
  const anexos = cs.flatMap((x: any) => (x.attachments ?? []).map((a: any) => a.file_name as string));

  const r = await acharJobDoTicket({ texto, html, anexos }, "recente");
  console.log(`\n${id} · ${String(t.ticket.subject).slice(0, 62)}`);
  console.log(`  anexos: ${anexos.join(", ") || "nenhum"}`);
  if (r.job) {
    console.log(`  ✔ ${r.job.reference} · ${r.job.client_name} · ${r.job.property_address}`);
    console.log(`     ${r.job.scheduled_date} · ${r.job.status} · parceiro ${r.job.partner_name ?? "—"}`);
    console.log(`     como: ${r.como}`);
  } else {
    console.log(`  ✖ ${r.como}`);
    for (const a of r.ambiguos ?? []) console.log(`     candidato: ${a.reference} · ${a.property_address} · ${a.scheduled_date}`);
  }
}
