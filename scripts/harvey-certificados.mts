/**
 * Arquiva certificados que chegaram por e-mail no relatório do job.
 *
 *   npx tsx scripts/harvey-certificados.mts 50069 50072            # ensaio
 *   npx tsx scripts/harvey-certificados.mts 50069 50072 --aplicar
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const APLICAR = process.argv.includes("--aplicar");
const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

const { guardarCertificadoDoTicket } = await import("../src/lib/zendesk-quoter/certificado-anexado");
const { acharJobDoTicket } = await import("../src/lib/zendesk-quoter/achar-job");

const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
const auth = "Basic " + Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");

for (const id of ids) {
  const t: any = await (await fetch(`${base}/tickets/${id}.json`, { headers: { Authorization: auth } })).json();
  const c: any = await (await fetch(`${base}/tickets/${id}/comments.json`, { headers: { Authorization: auth } })).json();
  const cs = c.comments ?? [];
  const ticket = {
    id: Number(id),
    subject: String(t.ticket.subject ?? ""),
    texto: cs.map((x: any) => x.plain_body ?? x.body ?? "").join("\n").slice(0, 6000),
    html: cs.map((x: any) => x.html_body ?? "").join("\n"),
    anexos: cs.flatMap((x: any) => x.attachments ?? []),
  };
  const pdfs = ticket.anexos.filter((a: any) => /pdf/i.test(a.content_type) || /\.pdf$/i.test(a.file_name));
  console.log(`\n${id} · ${ticket.subject} · ${pdfs.length} PDF(s)`);

  if (!APLICAR) {
    const r = await acharJobDoTicket({ texto: `${ticket.subject}\n${ticket.texto}`, html: ticket.html, anexos: pdfs.map((p: any) => p.file_name) }, "recente");
    console.log(r.job
      ? `  ENSAIO → arquivaria ${pdfs[0]?.file_name} em ${r.job.reference} (${r.job.property_address}) · ${r.como}`
      : `  ENSAIO → não arquivaria: ${r.como}`);
    continue;
  }

  const r = await guardarCertificadoDoTicket(ticket, auth);
  console.log(`  ${r.acao}${"reference" in r ? ` · ${r.reference}` : ""}`);
  if ("nota" in r) console.log("  " + r.nota.split("\n").join("\n  "));
}
