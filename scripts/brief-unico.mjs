/**
 * O e-mail único do dia.
 *
 * Lê as seções que os agentes gravaram em `BRIEF_DIR` durante o turno e manda
 * UM e-mail com tudo. Roda por último na corrente do launchd.
 *
 *   BRIEF_DIR=/tmp/fixfy-brief node scripts/brief-unico.mjs
 *   BRIEF_DIR=/tmp/fixfy-brief node scripts/brief-unico.mjs --seco   # não envia
 *
 * Duas decisões que valem explicar:
 *
 * **Seção que faltou aparece.** O turno declara em `ESPERADAS` quem deveria ter
 * escrito. Quem não escreveu vira uma linha "não rodou" no fim do e-mail, em
 * vez de simplesmente não existir. Agente que morre calado é a falha que já
 * custou caro aqui: o ciclo fecha em zero e parece dia calmo.
 *
 * **O assunto carrega a decisão.** Faturamento, margem e quantas pendências
 * esperam alguém. A ideia é saber se precisa abrir antes de abrir.
 */
import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { destinatarios } from "./lib/brief.mjs";

const DIR = process.env.BRIEF_DIR?.trim();
const SECO = process.argv.includes("--seco");
if (!DIR) {
  console.error("BRIEF_DIR não definido. Nada a juntar.");
  process.exit(1);
}

/** Quem o turno espera. A ordem aqui é a ordem no e-mail. */
const ESPERADAS = [
  ["negocio", "Fixfy Daily Report"],
  ["zia", "Zia · dinheiro que entrou"],
  ["receber", "A receber · coerência"],
  ["housekeep", "Housekeep · baixas"],
  ["checkatrade", "Checkatrade · baixas"],
];

const secoes = [];
if (existsSync(DIR)) {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".json")).sort()) {
    try {
      secoes.push(JSON.parse(readFileSync(join(DIR, f), "utf8")));
    } catch (e) {
      console.error(`[brief] não li ${f}: ${e.message}`);
    }
  }
}
const porChave = new Map(secoes.map((s) => [s.secao, s]));
const faltando = ESPERADAS.filter(([k]) => !porChave.has(k));

// ── assunto: o que decide se precisa abrir ────────────────────────────────
const hoje = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
const negocio = porChave.get("negocio");
/**
 * O assunto do daily report vem como
 * `🔴 Fixfy · Mon, 14 Sept 2026 · 23% margin · £145 gross`.
 * O farol, a marca e a data já estão no nosso assunto, então ficam de fora:
 * sobra o que decide, que é margem e faturamento. Jogar fora por posição
 * ("tira o primeiro pedaço") engolia o dinheiro quando o formato mudava, então
 * o corte é por conteúdo.
 */
const resumoNegocio = String(negocio?.assunto ?? "")
  .split("·")
  .map((p) => p.trim())
  .filter((p) => p && !/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]*\s*Fixfy(\s+week)?$/u.test(p) && !/\d{4}$/.test(p))
  .join(" · ");
const comAcao = secoes.filter((s) => s.precisaAcao).length;
const assunto = [
  `Fixfy · ${hoje}`,
  resumoNegocio || null,
  comAcao ? `${comAcao} ${comAcao === 1 ? "frente pede ação" : "frentes pedem ação"}` : "nada pendente",
  faltando.length ? `${faltando.length} não rodou` : null,
].filter(Boolean).join(" · ");

// ── corpo ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** HTML de seção vem como documento inteiro; aqui fica só o miolo. */
const miolo = (h) => String(h).replace(/^[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");

const blocos = [];
for (const [chave, rotulo] of ESPERADAS) {
  const s = porChave.get(chave);
  if (!s) continue;
  const cabecalho = `
    <tr><td style="padding:26px 26px 8px">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8A8A8E">${esc(s.titulo ?? rotulo)}</div>
      <div style="font:600 15px/1.45 -apple-system,Segoe UI,Arial,sans-serif;color:#111;margin-top:4px">${esc(s.assunto ?? "")}${s.precisaAcao ? ' <span style="background:#FFF1E3;color:#C2530A;font-size:11px;padding:2px 7px;border-radius:3px;vertical-align:middle">pede ação</span>' : ""}</div>
    </td></tr>`;
  const corpo = s.html
    ? `<tr><td style="padding:0 10px 10px">${miolo(s.html)}</td></tr>`
    : `<tr><td style="padding:4px 26px 18px">
         <pre style="margin:0;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:#3A3A3C;white-space:pre-wrap">${esc(s.texto)}</pre>
         ${s.rodape ? `<div style="font:11px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#8A8A8E;margin-top:10px">${esc(s.rodape)}</div>` : ""}
       </td></tr>`;
  blocos.push(cabecalho + corpo + `<tr><td style="padding:0 26px"><div style="height:1px;background:#E8E8ED"></div></td></tr>`);
}

if (faltando.length) {
  blocos.push(`
    <tr><td style="padding:22px 26px">
      <div style="font:600 11px/1.4 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#A5251B">Não rodou hoje</div>
      <div style="font:13px/1.7 -apple-system,Segoe UI,Arial,sans-serif;color:#3A3A3C;margin-top:6px">${faltando.map(([, r]) => esc(r)).join("<br>")}</div>
      <div style="font:11px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#8A8A8E;margin-top:8px">Silêncio aqui não quer dizer que estava tudo certo. Quer dizer que ninguém olhou.</div>
    </td></tr>`);
}

const html = `<!doctype html><html><body style="margin:0;background:#F2F2F6;padding:26px 14px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
  <tr><td style="background:#020040;padding:20px 26px">
    <div style="font:700 17px/1.2 -apple-system,Segoe UI,Arial,sans-serif;color:#fff">Fixfy</div>
    <div style="font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#9E9EC8;margin-top:3px">${esc(hoje)} · ${secoes.length} de ${ESPERADAS.length} frentes reportaram</div>
  </td></tr>
  ${blocos.join("\n")}
  <tr><td style="padding:18px 26px 24px">
    <div style="font:11px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#A0A0A6">Um e-mail por dia, com tudo. Cada frente continua rodando sozinha, só o envio é que ficou junto.</div>
  </td></tr>
</table></body></html>`;

console.log(`[brief] ${secoes.length} seção(ões), ${faltando.length} faltando`);
console.log(`[brief] assunto: ${assunto}`);

if (SECO) {
  console.log("(modo seco: nada enviado, arquivos preservados)");
  process.exit(0);
}

const para = await destinatarios();
if (!para.length || !process.env.RESEND_API_KEY) {
  console.error("[brief] sem destinatário ou sem RESEND_API_KEY: NADA enviado, arquivos preservados");
  process.exit(1);
}
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>", to: para, subject: assunto, html }),
});
if (!r.ok) {
  console.error(`[brief] falhou: ${(await r.text()).slice(0, 200)} — arquivos preservados para a próxima tentativa`);
  process.exit(1);
}
console.log(`[brief] enviado para ${para.join(", ")}`);
// Só limpa depois de o e-mail sair. Falhou, os arquivos ficam.
rmSync(DIR, { recursive: true, force: true });
