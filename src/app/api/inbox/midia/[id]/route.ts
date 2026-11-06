/**
 * Mídia de uma mensagem do 7983 que ainda está só no link da uazapi. O link não
 * abre em toda rede (a EE bloqueia o domínio da uazapi) e expira, então o
 * servidor copia o arquivo para o bucket `inbox-media`, grava `storage:` na
 * linha e redireciona para a URL assinada. Da segunda vez já sai do bucket.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { OPS_PHONE_NUMBER_ID } from "@/lib/whatsapp/operacao";
import { BUCKET_DA_MIDIA, guardarMidiaRecebida } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALIDADE = 60 * 60 * 12;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { sb } = s;
  const { id } = await params;

  const { data: linha } = await sb
    .from("wa_mensagens")
    .select("id, wamid, contato, midia_id")
    .eq("phone_number_id", OPS_PHONE_NUMBER_ID())
    .eq("id", id)
    .maybeSingle();
  const midia = (linha?.midia_id as string | null) ?? null;
  if (!linha || !midia) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  let caminho = midia.startsWith("storage:") ? midia : null;
  if (!caminho && /^https?:\/\//.test(midia)) {
    caminho = await guardarMidiaRecebida(sb, midia, linha.contato as string, linha.wamid as string);
    if (caminho) {
      const { error } = await sb.from("wa_mensagens").update({ midia_id: caminho }).eq("id", linha.id);
      if (error) console.error("[inbox/midia] gravar caminho", error.message);
    }
  }
  if (!caminho) return NextResponse.redirect(midia, 302);

  const { data: assinada } = await sb.storage.from(BUCKET_DA_MIDIA).createSignedUrl(caminho.slice("storage:".length), VALIDADE);
  if (!assinada?.signedUrl) return NextResponse.json({ error: "Could not sign the file" }, { status: 500 });
  return NextResponse.redirect(assinada.signedUrl, 302);
}
