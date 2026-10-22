/**
 * Cria a macro "Get partner quotes" no Zendesk (plano do dono, 22/10/2026, etapa D).
 *
 * A macro põe a tag `b2b_cotar` e uma nota interna "Partner quotes requested". O
 * ciclo do Harvey (scripts/harvey/poll.ts → src/lib/processo/b2b-cotar.ts) acha o
 * ticket, roda o preparo e os convites aos parceiros com as fotos do ticket e
 * carimba `b2b_cotado`. Uma vez por ticket.
 *
 *   npx tsx scripts/zendesk/criar-macro-b2b-cotar.mts            (ensaio: mostra o que criaria)
 *   npx tsx scripts/zendesk/criar-macro-b2b-cotar.mts --aplicar  (cria; o dono roda)
 *
 * Já existe uma macro ativa com o mesmo título: não cria outra.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
for (const a of [".env.local", ".env"]) {
  try { for (const l of readFileSync(join(process.cwd(), a), "utf8").split("\n")) { const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!; } } catch {}
}
const APLICAR = process.argv.includes("--aplicar");

const { TAG_B2B_COTAR } = await import("../../src/lib/processo/b2b-humano");

const TITULO = "Get partner quotes";
const macro = {
  title: TITULO,
  active: true,
  description: "B2B: ask Harvey to invite partners to quote this ticket (once). The quote stops at Quote Ready for the team to review and send.",
  actions: [
    { field: "current_tags", value: TAG_B2B_COTAR },
    { field: "comment_mode_is_public", value: "false" },
    { field: "comment_value", value: "Partner quotes requested" },
  ],
};

const sub = process.env.ZENDESK_SUBDOMAIN, em = process.env.ZENDESK_EMAIL, tk = process.env.ZENDESK_API_TOKEN;
const temZendesk = Boolean(sub && em && tk);
const auth = `Basic ${Buffer.from(`${em}/token:${tk}`).toString("base64")}`;
const api = (u: string, init?: RequestInit) =>
  fetch(`https://${sub}.zendesk.com/api/v2${u}`, { ...init, headers: { Authorization: auth, "content-type": "application/json", ...(init?.headers ?? {}) } });

let jaExiste: { id: number; title: string } | null = null;
if (temZendesk) {
  const r = await api(`/macros/search.json?query=${encodeURIComponent(TITULO)}`);
  if (r.ok) {
    const j = (await r.json()) as { macros?: Array<{ id: number; title: string; active: boolean }> };
    jaExiste = (j.macros ?? []).find((m) => m.active && m.title.trim().toLowerCase() === TITULO.toLowerCase()) ?? null;
  } else {
    console.error(`busca de macros: HTTP ${r.status}`);
  }
} else {
  console.log("(sem credenciais do Zendesk: só mostro o corpo)");
}

console.log(JSON.stringify({ macro }, null, 2));
if (jaExiste) {
  console.log(`\nJá existe: macro #${jaExiste.id} "${jaExiste.title}". Nada a fazer.`);
} else if (!APLICAR) {
  console.log("\nENSAIO: nada criado. Rode com --aplicar para criar.");
} else {
  if (!temZendesk) throw new Error("Zendesk não configurado");
  const r = await api("/macros.json", { method: "POST", body: JSON.stringify({ macro }) });
  if (!r.ok) throw new Error(`criar macro: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { macro: { id: number } };
  console.log(`\nCriada: macro #${j.macro.id} "${TITULO}".`);
}
