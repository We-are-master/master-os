import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";
import { montarZip, type ArquivoDoZip } from "@/lib/zip-simples";
import { fotosPorComodo, urlsDeFoto } from "@/lib/stefane/run-external-report";

/**
 * GET /api/jobs/[id]/report-photos → um .zip com as fotos do relatório.
 *
 * Quem revisa um job quer as fotos numa pasta, não trinta abas do navegador, e
 * quem responde a uma reclamação do cliente semanas depois quer o lote inteiro
 * de uma vez. Até aqui a única saída era abrir uma por uma.
 *
 * Os nomes saem organizados por metade e cômodo — `before-kitchen-01.jpg` —
 * porque é assim que a conversa acontece: "manda as fotos do banheiro depois
 * da limpeza". Uma pasta de `IMG_4471.jpg` não responde isso.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "job-reports";
/** O bucket é privado: o que está gravado no relatório não abre sozinho. */
const VALIDADE_ASSINATURA = 600;

function caminhoNoBucket(url: string): string | null {
  const marcador = `/${BUCKET}/`;
  const i = url.indexOf(marcador);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marcador.length).split("?")[0]);
}

function extensao(url: string): string {
  const limpa = url.split("?")[0].toLowerCase();
  if (limpa.endsWith(".png")) return "png";
  if (limpa.endsWith(".pdf")) return "pdf";
  if (limpa.endsWith(".webp")) return "webp";
  return "jpg";
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("reference, start_report, final_report")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  /**
   * A ordem do nome é metade, cômodo, número. Assim a pasta ordena sozinha na
   * sequência em que a visita aconteceu, e não na ordem em que o parceiro
   * apertou o botão.
   */
  const alvos: Array<{ url: string; nome: string }> = [];
  for (const [metade, envelope] of [
    ["before", job.start_report],
    ["after", job.final_report],
  ] as const) {
    const mapa = fotosPorComodo(envelope);
    if (mapa) {
      for (const [comodo, urls] of Object.entries(mapa)) {
        urls.forEach((u, i) =>
          alvos.push({ url: u, nome: `${metade}-${comodo}-${String(i + 1).padStart(2, "0")}.${extensao(u)}` }),
        );
      }
    } else {
      urlsDeFoto(envelope).forEach((u, i) =>
        alvos.push({ url: u, nome: `${metade}-${String(i + 1).padStart(2, "0")}.${extensao(u)}` }),
      );
    }
  }

  if (alvos.length === 0) {
    return NextResponse.json({ error: "This report has no photos." }, { status: 404 });
  }

  const caminhos = alvos.map((a) => caminhoNoBucket(a.url)).filter((c): c is string => !!c);
  const { data: assinadas } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_ASSINATURA);
  const porCaminho = new Map((assinadas ?? []).map((a) => [a.path, a.signedUrl]));

  /**
   * Foto que não baixa não derruba o zip.
   *
   * Um arquivo a menos ainda é um lote útil; um erro 500 no meio não é. O que
   * ficou de fora vira uma linha no `_missing.txt` dentro do próprio zip, para
   * quem abrir saber que faltou algo sem ter que conferir contagem.
   */
  const arquivos: ArquivoDoZip[] = [];
  const faltaram: string[] = [];

  /**
   * De seis em seis, não todas de uma vez.
   *
   * Um `Promise.all` sobre as 60 fotos de um relatório de limpeza abre 60
   * conexões simultâneas no storage, e ele responde com timeout de conexão —
   * medido em 20/08/2026, e não foi o servidor que caiu, foi o cliente que
   * pediu demais. Seis mantém o download rápido e dentro do que a outra ponta
   * aguenta.
   */
  const EM_PARALELO = 6;
  const baixar = async (alvo: { url: string; nome: string }) => {
    const caminho = caminhoNoBucket(alvo.url);
    const assinada = caminho ? porCaminho.get(caminho) : null;
    if (!assinada) {
      faltaram.push(alvo.nome);
      return;
    }
    // Uma segunda chance: timeout de conexão costuma ser momentâneo, e perder
    // a foto por causa disso é pior que gastar mais um segundo.
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const r = await fetch(assinada, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) {
          if (tentativa === 1) faltaram.push(`${alvo.nome} (HTTP ${r.status})`);
          continue;
        }
        arquivos.push({ nome: alvo.nome, dados: new Uint8Array(await r.arrayBuffer()) });
        return;
      } catch {
        if (tentativa === 1) faltaram.push(`${alvo.nome} (download failed)`);
      }
    }
  };

  for (let i = 0; i < alvos.length; i += EM_PARALELO) {
    await Promise.all(alvos.slice(i, i + EM_PARALELO).map(baixar));
  }

  arquivos.sort((a, b) => a.nome.localeCompare(b.nome));
  if (faltaram.length > 0) {
    arquivos.push({
      nome: "_missing.txt",
      dados: new TextEncoder().encode(
        `These photos are in the report but could not be downloaded:\n${faltaram.sort().join("\n")}\n`,
      ),
    });
  }

  const zip = montarZip(arquivos);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${job.reference}-report-photos.zip"`,
      "content-length": String(zip.length),
      "cache-control": "no-store",
    },
  });
}
