/**
 * STEFANE — prova que a foto SOBE de verdade, sem entregar relatório nenhum.
 *
 * A pergunta do dono em 20/08 foi direta: "só pra ver se grava realmente as
 * fotos". Ela é legítima e até aqui não tinha resposta — a única forma de saber
 * era submeter e olhar do outro lado, e submeter é irreversível.
 *
 * Este script responde sem submeter. Ele preenche o formulário real, anexa as
 * fotos nos treze campos, e então LÊ DE VOLTA quantos arquivos cada campo
 * está segurando (`input.files.length` no navegador). Se o campo diz 5, cinco
 * arquivos entraram: é o mesmo estado que o Submit enviaria.
 *
 * O que ele NÃO faz, de propósito:
 *   - não clica em Save (Save grava rascunho do lado deles)
 *   - não clica em Submit
 *   - não escreve nada no nosso banco
 *
 * Por isso o preenchimento de campo vazio usa as fotos REAIS do próprio job,
 * repetidas para completar o mínimo. Foto inventada num relatório de cliente
 * seria prova falsa de serviço, e a Housekeep paga contra esse relatório; aqui
 * ela nunca sai da memória deste processo, mas o hábito de gerar prova falsa é
 * que não deve existir.
 *
 *   npx tsx scripts/stefane-testar-upload.mts JOB-9450
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { buscarFormulario, slotsDeFoto, type SlotDeFoto } from "../src/lib/stefane/housekeep-api";
import { submeterRelatorioHousekeep } from "../src/lib/stefane/submit-housekeep-report";
import { payloadDoReport, payloadLimpeza } from "../src/lib/stefane/housekeep-report-form";
import { fotosPorComodo, urlsDeFoto } from "../src/lib/stefane/run-external-report";

loadEnvLocal();
const ref = process.argv[2];
if (!ref) {
  console.error("uso: npx tsx scripts/stefane-testar-upload.mts JOB-9450");
  process.exit(1);
}

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

const BUCKET = "job-reports";

/** As URLs do bucket privado viram URLs assinadas, que o Playwright consegue baixar. */
async function assinar(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const marcador = `/${BUCKET}/`;
  const caminhos = urls
    .map((u) => {
      const i = u.indexOf(marcador);
      return i === -1 ? null : decodeURIComponent(u.slice(i + marcador.length).split("?")[0]);
    })
    .filter((p): p is string => !!p);
  if (caminhos.length === 0) return urls;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, 600);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}

const { data: job } = await supabase.from("jobs").select("*").eq("reference", ref).maybeSingle();
if (!job) {
  console.error(`${ref} não existe`);
  process.exit(1);
}

const busca = await buscarFormulario(String(job.report_link));
if (!busca.ok) {
  console.error(`não consegui ler o formulário: ${busca.motivo}`);
  process.exit(1);
}
if (busca.form.submetidoEm) {
  console.error(`${ref} JÁ FOI ENTREGUE em ${busca.form.submetidoEm}. Não mexo em relatório entregue.`);
  process.exit(1);
}

const slots = slotsDeFoto(busca.form);
const ehLimpeza = slots.some((s) => s.chave !== "all");

console.log(`\n${ref} · ${job.title} · ${job.client_name}`);
console.log(`formulário: ${ehLimpeza ? "limpeza" : "trade"} · ${slots.length} campo(s) de foto\n`);

// As fotos reais do job, por cômodo quando houver.
const mapaAntes = fotosPorComodo(job.start_report) ?? {};
const mapaDepois = fotosPorComodo(job.final_report) ?? {};
const planasAntes = urlsDeFoto(job.start_report);
const planasDepois = urlsDeFoto(job.final_report);
const todas = [...planasAntes, ...planasDepois];
if (todas.length === 0) {
  console.error("este job não tem foto nenhuma: não há o que testar.");
  process.exit(1);
}

/**
 * Completa cada campo até o mínimo, repetindo foto real do próprio job.
 *
 * O repetido é PREENCHIMENTO DE TESTE e está marcado como tal na saída. Ele
 * existe só para o campo receber a quantidade que a validação deles exige, e
 * morre quando este processo termina.
 */
const preenchidos: Array<{ slot: SlotDeFoto; reais: number; teste: number }> = [];
const porMetade: { antes: Record<string, string[]>; depois: Record<string, string[]> } = { antes: {}, depois: {} };

for (const slot of slots) {
  const mapa = slot.metade === "antes" ? mapaAntes : mapaDepois;
  const planas = slot.metade === "antes" ? planasAntes : planasDepois;
  const reais = slot.chave === "all" ? planas : (mapa[slot.chave] ?? []);
  const alvo = Math.max(slot.min, reais.length > 0 ? Math.min(reais.length, slot.max) : slot.min);
  const lista = [...reais];
  let i = 0;
  while (lista.length < alvo) lista.push(todas[i++ % todas.length]);
  if (lista.length === 0) continue;
  porMetade[slot.metade][slot.chave] = lista.slice(0, slot.max);
  preenchidos.push({ slot, reais: reais.length, teste: Math.max(0, lista.length - reais.length) });
}

console.log("o que vai ser anexado em cada campo:");
for (const { slot, reais, teste } of preenchidos) {
  const marca = teste > 0 ? `  (+${teste} de teste)` : "";
  console.log(
    `  ${slot.metade === "antes" ? "antes " : "depois"} · ${slot.rotulo.padEnd(20).slice(0, 20)} ` +
      `min ${slot.min} · ${reais} real(is)${marca}`,
  );
}

// Assina tudo. Cada lista é assinada inteira porque a URL assinada é por arquivo.
const assinarMapa = async (m: Record<string, string[]>) => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(m)) out[k] = await assinar(v);
  return out;
};
const [antesPorComodo, depoisPorComodo] = await Promise.all([
  assinarMapa(porMetade.antes),
  assinarMapa(porMetade.depois),
]);

const base = {
  inicio: (job.partner_timer_started_at as string | null) ?? null,
  fim: (job.partner_timer_ended_at as string | null) ?? null,
};
const montado = ehLimpeza
  ? payloadLimpeza({ start: job.start_report, final: job.final_report, ...base })
  : payloadDoReport({ final: job.final_report, ...base });
if (!montado.ok) {
  console.error(`payload não fecha: ${montado.motivo}`);
  process.exit(1);
}

console.log("\nabrindo o formulário e anexando (nada será salvo nem submetido)...\n");
const r = await submeterRelatorioHousekeep({
  // A URL RESOLVIDA, não `report_link` cortado no "?": quando o link é o de
  // rastreio do email (`links.housekeep.com/ls/click?upn=...`), cortar a query
  // string apaga o token e a página responde 400 sem renderizar nada. Foi o
  // que fez este teste dizer "o formulário nunca renderizou" no JOB-9454.
  url: busca.form.url,
  payload: montado.payload,
  fotos: {
    antes: antesPorComodo.all ?? [],
    depois: depoisPorComodo.all ?? [],
    antesPorComodo: ehLimpeza ? antesPorComodo : undefined,
    depoisPorComodo: ehLimpeza ? depoisPorComodo : undefined,
  },
  simular: true,
});

console.log("VEREDITO");
console.log(`  ${r.ok ? "?" : r.motivo}`);
console.log(`  ${"segundos" in r ? r.segundos : "?"}s`);

// A prova: o dry run devolve `photos [n, n, n...]` lido de input.files.length.
const nums = /photos \[([^\]]*)\]/.exec("motivo" in r ? r.motivo : "")?.[1];
if (nums) {
  const contagem = nums.split(",").map((n) => Number(n.trim()));
  const total = contagem.reduce((a, b) => a + b, 0);
  const vazios = contagem.filter((n) => n === 0).length;
  console.log(`\n  ${total} arquivo(s) entraram em ${contagem.length - vazios} de ${contagem.length} campos`);
  console.log(`  ${total > 0 ? "A FOTO SOBE: os campos estão segurando os arquivos." : "NENHUM arquivo entrou."}`);
}
console.log("\nnada foi salvo e nada foi submetido. O relatório na Housekeep continua como estava.");

// Confere na fonte que continua não entregue, para não restar dúvida.
const depois = await buscarFormulario(String(job.report_link));
console.log(
  depois.ok
    ? `confirmado na API deles: submitted_at = ${depois.form.submetidoEm ?? "null (segue não entregue)"}`
    : "não consegui reconferir na API deles",
);
