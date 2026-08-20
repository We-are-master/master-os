/**
 * Sobe um lote de fotos que chegou por fora (WhatsApp, AirDrop) e o classifica
 * por cômodo, montando o envelope de relatório que a plataforma exige.
 *
 * Nasceu do JOB-9449 (Deep Cleaning de 19/08/2026): a RJ Cleaner fez o
 * trabalho, mandou 135 fotos pelo WhatsApp e nunca fechou o relatório final no
 * app. As fotos existiam, o serviço existia, e a Housekeep não ia receber nada
 * porque o envelope estava vazio do nosso lado.
 *
 * A classificação é local antes de subir: o modelo lê uma cópia reduzida a
 * 512px em base64, e só o que for aplicado sobe em tamanho original para o
 * bucket. Isso evita encher o bucket de foto em ensaio, que é o que aconteceria
 * se fosse preciso subir antes para poder assinar e classificar.
 *
 * Sem `--aplicar` nada sobe e nada é gravado.
 *
 *   npx tsx scripts/stefane-subir-fotos.mts JOB-9449 --depois "~/Desktop/E16 DEPOIS"
 *   npx tsx scripts/stefane-subir-fotos.mts JOB-9449 --depois "..." --aplicar
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { classificarFotos, mapaPorComodo } from "../src/lib/stefane/classificar-fotos";
import { buscarFormulario, faltasDeFoto, slotsDeFoto } from "../src/lib/stefane/housekeep-api";
import { HOUSEKEEP_COMODOS } from "../src/lib/stefane/housekeep-report-form";
import { urlsDeFoto } from "../src/lib/stefane/run-external-report";

loadEnvLocal();

const argv = process.argv.slice(2);
const referencia = argv[0];
const aplicar = argv.includes("--aplicar");
const opcao = (nome: string): string | null => {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const pastaAntes = opcao("--antes");
const pastaDepois = opcao("--depois");
/**
 * As duas respostas do formulário de limpeza que não saem de foto nenhuma.
 *
 * `--completo` é o padrão porque um lote de fotos de conclusão é a prova de
 * que o serviço terminou. `--inspecionado` NÃO é padrão: dizer que o cliente
 * conferiu o trabalho sem saber se conferiu é afirmar à Housekeep uma coisa
 * que ninguém verificou.
 */
const jobCompleto = !argv.includes("--incompleto");
const clienteInspecionou = argv.includes("--inspecionado");
/** Fecha o mínimo por cômodo com as fotos que sobraram sem classificação. */
const completarFaltantes = argv.includes("--completar-faltantes");

if (!referencia || (!pastaAntes && !pastaDepois)) {
  console.error(`uso: npx tsx scripts/stefane-subir-fotos.mts JOB-9449 --depois "<pasta>" [--antes "<pasta>"] [--aplicar]
       [--incompleto]     marca "Is the job complete?" como No
       [--inspecionado]   marca que o cliente conferiu o trabalho
       [--completar-faltantes]  fecha o mínimo por cômodo com as fotos indecisas`);
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);
const BUCKET = "job-reports";
const LOTE = 15;

const { data: job } = await supabase
  .from("jobs")
  .select("id, reference, title, client_name, partner_name, report_link, start_report, final_report")
  .eq("reference", referencia)
  .maybeSingle();
if (!job) {
  console.error(`job ${referencia} não existe`);
  process.exit(1);
}
console.log(`${job.reference} · ${job.title} · ${job.client_name} · parceiro ${job.partner_name}\n`);

const ehImagem = (n: string) => /\.(jpe?g|png|heic)$/i.test(n) && !n.startsWith(".");

/** Cópia reduzida para o modelo ver. `sips` é nativo do mac e não pede dependência. */
function miniaturaBase64(caminho: string, destino: string): string | null {
  const saida = join(destino, `m-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    execFileSync("sips", ["-Z", "512", "-s", "format", "jpeg", caminho, "--out", saida], { stdio: "ignore" });
    return `data:image/jpeg;base64,${readFileSync(saida).toString("base64")}`;
  } catch {
    return null;
  }
}

// Os campos que a plataforma tem AGORA, para o terceiro passe saber o que pedir.
const formInicial = await buscarFormulario(String(job.report_link));
const slotsDoForm = formInicial.ok ? slotsDeFoto(formInicial.form) : [];

const temp = mkdtempSync(join(tmpdir(), "stefane-fotos-"));
const carimbo = new Date().toISOString().replace(/[.:]/g, "-");
const envelopes: Record<"start_report" | "final_report", Record<string, string[]> | null> = {
  start_report: null,
  final_report: null,
};

for (const [metade, pasta] of [
  ["start_report", pastaAntes],
  ["final_report", pastaDepois],
] as const) {
  if (!pasta) continue;
  const raiz = pasta.replace(/^~/, process.env.HOME ?? "~");
  const metadeDoLote = metade;
  const rotulo = metade === "start_report" ? "ANTES" : "DEPOIS";
  const arquivos = readdirSync(raiz).filter(ehImagem).sort().map((n) => join(raiz, n));
  if (arquivos.length === 0) {
    console.log(`${rotulo}: nenhuma imagem em ${raiz}\n`);
    continue;
  }

  console.log(`${rotulo}: ${arquivos.length} foto(s) em ${raiz}`);
  console.log(`  reduzindo e classificando em lotes de ${LOTE}...`);

  const rotulos: string[] = [];
  for (let i = 0; i < arquivos.length; i += LOTE) {
    const fatia = arquivos.slice(i, i + LOTE);
    const minis = fatia.map((f) => miniaturaBase64(f, temp)).filter((m): m is string => !!m);
    if (minis.length !== fatia.length) {
      console.log(`  aviso: ${fatia.length - minis.length} foto(s) não reduziram e viram "unknown"`);
    }
    const r = await classificarFotos(minis);
    if (!r.ok) {
      console.error(`  classificação falhou: ${r.motivo}`);
      process.exit(1);
    }
    // `mapaPorComodo` casa por índice, então aqui só se colhe o rótulo na ordem.
    const { mapa } = mapaPorComodo(r.fotos, fatia.slice(0, minis.length));
    const porArquivo = new Map<string, string>();
    for (const [comodo, lista] of Object.entries(mapa)) for (const f of lista) porArquivo.set(f, comodo);
    for (const f of fatia) rotulos.push(porArquivo.get(f) ?? "unknown");
    process.stdout.write(`  ${Math.min(i + LOTE, arquivos.length)}/${arquivos.length}\r`);
  }
  console.log();

  /**
   * Segundo passe nas indecisas, com a imagem inteira.
   *
   * No JOB-9449 a primeira rodada deixou 24 de 72 como "unknown" e faltavam
   * SEIS fotos para o relatório passar: quase toda a diferença estava dentro
   * do balde de indecisas. Em `low` o modelo vê uma miniatura de 512px, e um
   * close-up de torneira ou de rodapé perde ali exatamente a pista que diz
   * qual cômodo é.
   *
   * Só roda no que sobrou, então custa pouco: é um punhado de fotos, não o
   * lote inteiro.
   */
  const indecisas = arquivos.map((f, i) => [f, i] as const).filter(([, i]) => rotulos[i] === "unknown");
  if (indecisas.length > 0) {
    console.log(`  ${indecisas.length} indecisa(s): segundo passe com a imagem inteira...`);
    for (let i = 0; i < indecisas.length; i += LOTE) {
      const fatia = indecisas.slice(i, i + LOTE);
      const minis = fatia.map(([f]) => miniaturaBase64(f, temp)).filter((m): m is string => !!m);
      const r = await classificarFotos(minis, {
        detalhe: "high",
        nota:
          "A first pass could not place these. Look closely at fixtures, tiles, flooring and " +
          "furniture edges before answering. Still answer \"unknown\" if the photo genuinely has no room cue.",
      });
      if (!r.ok) {
        console.log(`  segundo passe falhou (${r.motivo}); as indecisas ficam de fora`);
        break;
      }
      const { mapa } = mapaPorComodo(r.fotos, fatia.slice(0, minis.length).map(([f]) => f));
      const porArquivo = new Map<string, string>();
      for (const [comodo, lista] of Object.entries(mapa)) for (const f of lista) porArquivo.set(f, comodo);
      let recuperadas = 0;
      for (const [f, idx] of fatia) {
        const c = porArquivo.get(f);
        if (c && c !== "unknown") { rotulos[idx] = c; recuperadas++; }
      }
      process.stdout.write(`  recuperadas ${recuperadas} de ${fatia.length}\r`);
    }
    console.log();
  }

  /**
   * TERCEIRO passe, perguntando só pelo cômodo que está faltando.
   *
   * Os dois primeiros perguntam "que cômodo é este?", uma pergunta de sete
   * saídas em que o modelo prefere "unknown" — e prefere com razão, porque
   * errar o cômodo é pior que não responder.
   *
   * Mas depois de contar quantas fotos cada campo tem, a pergunta que resta é
   * outra e muito mais fácil: "faltam 3 de SALA e 2 de CORREDOR; alguma destas
   * é sala ou corredor?". Duas saídas em vez de sete, e só sobre as que já
   * ninguém colocou. No JOB-9449 sobravam 19 indecisas e faltavam 5 fotos.
   *
   * Não é forçar a barra: continua podendo responder "nenhuma das duas", e o
   * pedido diz isso em letras maiúsculas.
   */
  const comodosFaltando = (): string[] => {
    const porChave: Record<string, number> = {};
    arquivos.forEach((_, i) => {
      const c = rotulos[i];
      if (c && c !== "unknown") porChave[c] = (porChave[c] ?? 0) + 1;
    });
    const metade = metadeDoLote === "start_report" ? "antes" : "depois";
    return slotsDoForm
      .filter((sl) => sl.metade === metade && sl.min > 0 && (porChave[sl.chave] ?? 0) < sl.min)
      .map((sl) => sl.chave);
  };

  const faltantes = comodosFaltando();
  const aindaIndecisas = arquivos.map((f, i) => [f, i] as const).filter(([, i]) => rotulos[i] === "unknown");
  if (faltantes.length > 0 && aindaIndecisas.length > 0) {
    const nomes = faltantes.map((c) => HOUSEKEEP_COMODOS[c] ?? c).join(" or ");
    console.log(`  falta ${nomes}: terceiro passe perguntando só por ${faltantes.join("/")}...`);
    for (let i = 0; i < aindaIndecisas.length; i += LOTE) {
      const fatia = aindaIndecisas.slice(i, i + LOTE);
      const minis = fatia.map(([f]) => miniaturaBase64(f, temp)).filter((m): m is string => !!m);
      const r = await classificarFotos(minis, {
        detalhe: "high",
        nota:
          `This report is short of ${nomes} photos. Two earlier passes could not place these. ` +
          `Look again and answer ONLY ${faltantes.join(" or ")} when the photo really shows that room. ` +
          `If it does not, answer "unknown" — a photo filed in the wrong room is worse than one the office files by hand.`,
      });
      if (!r.ok) { console.log(`  terceiro passe falhou (${r.motivo})`); break; }
      const { mapa } = mapaPorComodo(r.fotos, fatia.slice(0, minis.length).map(([f]) => f));
      const porArquivo = new Map<string, string>();
      for (const [comodo, lista] of Object.entries(mapa)) for (const f of lista) porArquivo.set(f, comodo);
      let achadas = 0;
      for (const [f, idx] of fatia) {
        const c = porArquivo.get(f);
        // Só aceita o que foi PEDIDO: um "kitchen" vindo daqui seria o modelo
        // respondendo outra pergunta, e já houve dois passes para isso.
        if (c && faltantes.includes(c)) { rotulos[idx] = c; achadas++; }
      }
      if (achadas) console.log(`  +${achadas} recuperada(s) para ${faltantes.join("/")}`);
    }
  }

  /**
   * `--completar-faltantes`: fecha o mínimo com as fotos que sobraram sem cômodo.
   *
   * Decisão do dono em 20/08/2026, com o cliente avisado. Serve para o caso em
   * que o parceiro simplesmente não fotografou o corredor: o serviço foi feito,
   * as fotos são do imóvel certo e do dia certo, mas o formulário deles exige
   * um mínimo POR CÔMODO e sem ele o relatório inteiro não entra.
   *
   * Usa a pilha de INDECISAS, nunca uma foto já colocada noutro cômodo. A
   * diferença importa: uma indecisa é uma foto que a IA não soube nomear e que
   * pode perfeitamente ser o corredor; mover uma cozinha reconhecida para
   * "Hallways" seria afirmar o que se sabe ser falso.
   *
   * Nunca é padrão, e o que foi usado aparece nomeado na saída — se alguém
   * perguntar depois, a resposta existe.
   */
  const porComodo: Record<string, string[]> = {};
  arquivos.forEach((f, i) => {
    const c = rotulos[i] ?? "unknown";
    (porComodo[c] ??= []).push(f);
  });

  if (completarFaltantes) {
    const metadeAlvo = metadeDoLote === "start_report" ? "antes" : "depois";
    const sobra = [...(porComodo.unknown ?? [])];
    const usadas: string[] = [];
    for (const sl of slotsDoForm.filter((x) => x.metade === metadeAlvo && x.min > 0)) {
      const tem = porComodo[sl.chave]?.length ?? 0;
      for (let n = tem; n < sl.min && sobra.length > 0; n++) {
        const f = sobra.shift()!;
        (porComodo[sl.chave] ??= []).push(f);
        usadas.push(`${sl.rotulo} <- ${f.split("/").pop()}`);
      }
    }
    porComodo.unknown = sobra;
    if (usadas.length) {
      console.log(`  completando o mínimo com ${usadas.length} indecisa(s):`);
      for (const u of usadas) console.log(`      ${u}`);
    }
  }
  for (const [comodo, lista] of Object.entries(porComodo).sort()) {
    const nota = comodo === "unknown" ? "   (fica de fora: não sobe para a plataforma)" : "";
    console.log(`  ${comodo.padEnd(15)} ${lista.length}${nota}`);
  }
  // Nomeadas para quem for olhar: a foto que a IA não soube colocar ainda é
  // foto tirada, e alguém em dois minutos resolve o que o modelo não resolveu.
  for (const f of porComodo.unknown ?? []) console.log(`      sem cômodo: ${f.split("/").pop()}`);

  if (!aplicar) {
    envelopes[metade] = Object.fromEntries(
      Object.entries(porComodo).map(([k, v]) => [k, v.map((_, i) => `local://${k}-${i}`)]),
    );
    console.log();
    continue;
  }

  // Só agora sobe: em ensaio o bucket não é tocado.
  console.log(`  subindo para o bucket...`);
  const prefixo = metade === "start_report" ? "before" : "after";
  const urls: Record<string, string[]> = {};
  for (const [comodo, lista] of Object.entries(porComodo)) {
    if (comodo === "unknown") continue;
    for (const [i, caminho] of lista.entries()) {
      const nome = `${job.id}/${prefixo}-${comodo}-${i}-${carimbo}${extname(caminho).toLowerCase() === ".png" ? ".png" : ".jpg"}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(nome, readFileSync(caminho), { contentType: "image/jpeg", upsert: true });
      if (error) {
        console.error(`  falhou ao subir ${caminho}: ${error.message}`);
        process.exit(1);
      }
      (urls[comodo] ??= []).push(supabase.storage.from(BUCKET).getPublicUrl(nome).data.publicUrl);
    }
  }
  envelopes[metade] = urls;
  console.log(`  ${Object.values(urls).flat().length} foto(s) no bucket\n`);
}

/** A pergunta que importa: com isto o relatório passa na validação DELES? */
const busca = await buscarFormulario(String(job.report_link));
if (busca.ok) {
  const contar = (novo: Record<string, string[]> | null, atual: unknown) => {
    if (novo) return Object.fromEntries(Object.entries(novo).map(([k, v]) => [k, v.length]));
    const p = (atual as { photos?: unknown } | null)?.photos;
    if (p && !Array.isArray(p) && typeof p === "object") {
      return Object.fromEntries(
        Object.entries(p as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
      );
    }
    return { all: urlsDeFoto(atual).length };
  };
  const faltas = faltasDeFoto(busca.form, {
    antes: contar(envelopes.start_report, job.start_report),
    depois: contar(envelopes.final_report, job.final_report),
  });
  console.log(
    faltas.length === 0
      ? "Com estas fotos o relatório PASSA na validação da Housekeep."
      : `Ainda falta para a Housekeep aceitar:\n${faltas.map((f) => `  ${f}`).join("\n")}`,
  );
} else {
  console.log(`não deu para conferir contra a Housekeep: ${busca.motivo}`);
}

if (!aplicar) {
  console.log("\n(ensaio: nada subiu e nada foi gravado. rode com --aplicar)");
  process.exit(0);
}

// Prova de serviço não se sobrescreve sem cópia.
mkdirSync(".logs", { recursive: true });
const backup = `.logs/fotos-antes-${job.reference}-${carimbo.slice(0, 15)}.json`;
writeFileSync(backup, JSON.stringify({ start_report: job.start_report, final_report: job.final_report }, null, 2));
console.log(`\nenvelope anterior salvo em ${backup}`);

const patch: Record<string, unknown> = {};
for (const metade of ["start_report", "final_report"] as const) {
  const novo = envelopes[metade];
  if (!novo) continue;
  const antigo = (job[metade] ?? {}) as Record<string, unknown>;
  patch[metade] = {
    ...antigo,
    template: "cleaner",
    photos: novo,
    submitted_at: antigo.submitted_at ?? new Date().toISOString(),
    ...(metade === "final_report"
      ? { job_complete: jobCompleto, customer_inspected: clienteInspecionou }
      : {}),
  };
}
if (patch.final_report) patch.final_report_submitted = true;

const { error } = await supabase.from("jobs").update(patch).eq("id", job.id);
if (error) {
  console.error(`não gravou: ${error.message}`);
  process.exit(1);
}
console.log(`${job.reference} atualizado: ${Object.keys(patch).join(", ")}`);
console.log(`  Is the job complete? = ${jobCompleto ? "Yes" : "No"}`);
console.log(`  Customer inspected?  = ${clienteInspecionou ? "Yes" : "No"}`);
