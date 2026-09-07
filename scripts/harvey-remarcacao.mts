/**
 * ENSAIO da remarcação: lê o ticket e diz o que faria. Não move, não avisa.
 *
 *   npx tsx scripts/harvey-remarcacao.mts 50154
 *   npx tsx scripts/harvey-remarcacao.mts 50154 --aplicar
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const APLICAR = process.argv.includes("--aplicar");
const { lerTicketCompleto } = await import("../src/lib/zendesk-quoter/quoter");
const { tratarRemarcacao, mensagemMaisNova } = await import("../src/lib/zendesk-quoter/remarcacao");
const { triarTicket } = await import("../src/lib/zendesk-triage");
const apiKey = process.env.OPENAI_API_KEY!.trim();

for (const id of process.argv.slice(2).filter((x) => /^\d+$/.test(x))) {
  const t = await lerTicketCompleto(Number(id));
  const tri = triarTicket({ subject: t.subject, description: t.thread.slice(0, 2000), tags: [] });
  console.log(`\n${id} · ${t.subject}`);
  console.log(`  triagem: ${tri.classe}  (${tri.motivo})`);

  const r = await tratarRemarcacao(
    { id: Number(id), subject: t.subject, texto: await mensagemMaisNova(Number(id)), html: "" },
    apiKey,
    undefined,
    { simular: !APLICAR },
  );
  console.log(`  ação: ${r.acao}`);
  if ("nota" in r) console.log("  " + r.nota.split("\n").join("\n  "));
}
