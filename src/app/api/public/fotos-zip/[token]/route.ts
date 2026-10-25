/**
 * "Save all photos" dos e-mails (`lib/fotos-zip.ts`): baixa as fotos do token,
 * monta um .zip, guarda no storage e redireciona para ele. O mesmo token cai no
 * mesmo arquivo, então o segundo clique não baixa as fotos de novo.
 */

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { nomeDaFoto, nomeDoZip, pedidoDoToken, zipSemCompressao } from "@/lib/fotos-zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "job-reports";
const VALIDADE_SEG = 60 * 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pedido = pedidoDoToken(decodeURIComponent(token));
  if (!pedido) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const admin = createServiceClient();
  const nome = nomeDoZip(pedido.nome);
  const caminho = `fotos-zip/${createHash("sha256").update(token).digest("hex").slice(0, 32)}/${nome}`;
  const assinar = () => admin.storage.from(BUCKET).createSignedUrl(caminho, VALIDADE_SEG, { download: nome });

  const pronto = await assinar();
  if (pronto.data?.signedUrl) return NextResponse.redirect(pronto.data.signedUrl, 302);

  const arquivos: Array<{ nome: string; dados: Buffer }> = [];
  await Promise.all(
    pedido.urls.map(async (url, i) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return;
        arquivos[i] = { nome: nomeDaFoto(i, url, r.headers.get("content-type")), dados: Buffer.from(await r.arrayBuffer()) };
      } catch {
        // Foto que não baixou fica de fora; as outras seguem.
      }
    }),
  );
  const baixadas = arquivos.filter(Boolean);
  if (!baixadas.length) return NextResponse.json({ error: "These photos are no longer available" }, { status: 404 });

  const zip = zipSemCompressao(baixadas);
  const { error } = await admin.storage.from(BUCKET).upload(caminho, zip, { contentType: "application/zip", upsert: true });
  if (error) {
    // Sem storage: entrega direto, se couber na resposta.
    if (zip.length < 4_000_000) {
      return new NextResponse(new Uint8Array(zip), {
        headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${nome}"` },
      });
    }
    return NextResponse.json({ error: "Could not prepare the download" }, { status: 500 });
  }
  const depois = await assinar();
  if (!depois.data?.signedUrl) return NextResponse.json({ error: "Could not prepare the download" }, { status: 500 });
  return NextResponse.redirect(depois.data.signedUrl, 302);
}
