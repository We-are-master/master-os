/**
 * Replay de conversas reais: cada ponto de decisão (mensagem do cliente que o Harvey
 * respondeu) roda duas vezes, com o prompt que está valendo (edições da tela) e com o
 * texto do código (o playbook novo). Nada vai ao WhatsApp nem ao banco: as contas são
 * de mentira e o site só dá preço e datas.
 *
 *   npx tsx scripts/harvey-wa/replay.mts            (20 conversas de outubro)
 *   N=5 npx tsx scripts/harvey-wa/replay.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const SITE = process.env.HARVEY_WA_SITE_DIR || `${process.env.HOME}/master-website-harvey`;
const { handleAgent, catalog } = await import(`${SITE}/server/b2c/agent.js`);
const { b2cServerEnv } = await import(`${SITE}/server/b2c/env.js`);
const { pensar } = await import("../../src/lib/harvey-wa/cerebro");
const { createClient } = await import("@supabase/supabase-js");
type Fala = { papel: "cliente" | "harvey" | "equipe"; texto: string; midia?: string };

const env = b2cServerEnv();
const chave = { "x-agent-key": env.osLeadKey || env.osKey };
const site = async (corpo: Record<string, unknown>) => {
  if (corpo.action === "checkout" || corpo.action === "bank") {
    const b = corpo.booking as { selection: unknown; postcode: string };
    const q = await handleAgent({ action: "quote", selection: b.selection, postcode: b.postcode }, chave);
    return { status: 200, data: { url: "https://checkout.stripe.com/c/pay/TESTE", ref: "FX-TESTE1", total: q.data.total, payNow: q.data.deposit, payLater: q.data.total - q.data.deposit } };
  }
  return handleAgent(corpo, chave);
};
const CONTAS = {
  reservas: async () => ({ encontrado: false, reservas: [] }),
  statusDasCotacoes: async () => ({ quotes: [{ reference: "QT-TESTE", status: "being priced by our professionals" }] }),
  pedirCotacao: async () => ({ reference: "QT-TESTE", invited: 2 }),
  perguntarAoParceiro: async () => ({ ok: true }),
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);
const SC = `https://fixfy.zendesk.com/sc/v2/apps/${process.env.SUNSHINE_APP_ID}`;
const SA = "Basic " + Buffer.from(`${process.env.SUNSHINE_KEY_ID}:${process.env.SUNSHINE_KEY_SECRET}`).toString("base64");
type Msg = { received: string; author: { type: string; displayName?: string }; content: { type: string; text?: string } };
async function mensagens(id: string): Promise<Msg[]> {
  const r = await fetch(`${SC}/conversations/${id}/messages?page[size]=100`, { headers: { Authorization: SA } });
  return ((await r.json()) as { messages?: Msg[] }).messages ?? [];
}
const comoFala = (m: Msg): Fala => ({
  papel: m.author.type === "user" ? "cliente" : /harvey/i.test(m.author.displayName ?? "Harvey") || !m.author.displayName ? "harvey" : "equipe",
  texto: m.content.text?.trim() || `[${m.content.type} sent]`,
});

const N = Number(process.env.N ?? 20);
// Primeiro as que passaram para a equipe (onde mais se perde), depois as outras.
const { data: convs } = await sb
  .from("harvey_wa_conversas")
  .select("conversation_id, name, estado, passou_em, motivo_passagem, criado_em")
  .eq("tipo", "cliente")
  .gte("criado_em", "2026-10-01")
  .order("passou_em", { ascending: false, nullsFirst: false })
  .limit(120);
const cat = catalog();
const linhas: string[] = ["# Replay: prompt ao vivo × playbook novo", ""];
let feitas = 0;
for (const c of convs ?? []) {
  if (feitas >= N) break;
  const msgs = (await mensagens(c.conversation_id)).filter((m) => m.content.type === "text" || m.author.type === "user");
  const falas = msgs.map(comoFala);
  // Pontos de decisão: mensagem do cliente seguida de resposta do Harvey. Primeiro, a da passagem e a última.
  const pontos = falas.map((f, i) => (f.papel === "cliente" && falas[i + 1]?.papel === "harvey" ? i : -1)).filter((i) => i >= 0);
  if (pontos.length < 1) continue;
  const iPassou = pontos.find((i) => /grab someone|someone from the team|give me a minute/i.test(falas[i + 1]!.texto));
  const escolhidos = [...new Set([pontos[0]!, ...(iPassou !== undefined ? [iPassou] : []), pontos[pontos.length - 1]!])].slice(0, 3);
  feitas++;
  linhas.push(`## ${feitas}. ${c.name ?? "?"} (${c.criado_em.slice(0, 10)})${c.motivo_passagem ? ` · passou: ${c.motivo_passagem.slice(0, 120)}` : ""}`, "");
  for (const i of escolhidos) {
    const historico = falas.slice(0, i + 1);
    const ctx = () => ({ telefone: "+447700900123", nomeNoWhatsApp: c.name ?? "Customer", campanha: "replay", contas: CONTAS });
    const rodar = async (semEdicoes: boolean) => {
      process.env.HARVEY_SEM_EDICOES = semEdicoes ? "1" : "0";
      try {
        const r = await pensar(historico.map((f) => ({ ...f })), ctx(), site, cat);
        return `${r.resposta ?? "(sem resposta)"}${r.passarParaEquipe ? `  ⟶ PASSOU (${r.passarParaEquipe.slice(0, 80)})` : ""}${r.ferramentas.length ? `  [${r.ferramentas.join(",")}]` : ""}`;
      } catch (e) {
        return `(erro: ${e instanceof Error ? e.message : e})`;
      }
    };
    const [hoje, novo] = [await rodar(false), await rodar(true)];
    const antes = historico.slice(-4, -1).map((f) => `> ${f.papel}: ${f.texto.replace(/\s+/g, " ").slice(0, 200)}`);
    linhas.push(...antes, `> **cliente: ${falas[i]!.texto.replace(/\s+/g, " ").slice(0, 300)}**`, "", `- **real:** ${falas[i + 1]!.texto.replace(/\s+/g, " ").slice(0, 400)}`, `- **hoje:** ${hoje.replace(/\s+/g, " ")}`, `- **novo:** ${novo.replace(/\s+/g, " ")}`, "");
    console.log(`${feitas}.${i} ok`);
  }
}
writeFileSync(process.env.SAIDA ?? new URL("./ultimo-replay.md", import.meta.url), linhas.join("\n"));
console.log(`fim: ${feitas} conversas`);
