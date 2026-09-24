/** O n8n devolve o que a Meta respondeu para cada item da leva. */
import { NextRequest, NextResponse } from "next/server";
import { chaveDoN8nOk } from "@/lib/marketing/chave-do-n8n";
import { registrarResultadoWhatsApp } from "@/lib/marketing/campanha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!chaveDoN8nOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { itens?: unknown } | null;
  const itens = Array.isArray(corpo?.itens) ? corpo.itens : Array.isArray(corpo) ? corpo : corpo ? [corpo] : [];
  const r = await registrarResultadoWhatsApp(
    itens.map((i) => {
      const x = i as Record<string, unknown>;
      return { id: String(x.id ?? ""), wamid: (x.wamid as string) ?? null, erro: (x.erro as string) ?? null, codigo: x.codigo != null ? Number(x.codigo) : null };
    }).filter((x) => x.id),
  );
  return NextResponse.json({ ok: true, ...r });
}
