/**
 * Botão Call da /inbox. O Zendesk Talk não tem API para discar, então a
 * ligação sai do próprio Talk: achamos a pessoa no Zendesk pelo telefone e
 * devolvemos o perfil dela (o número ali é clicável e disca pelo Talk). Sem
 * cadastro no Zendesk, devolve o painel do agente e a tela copia o número.
 * POST com o número no corpo para não deixar telefone em URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

export const dynamic = "force-dynamic";

type UsuarioZd = { id: number; name: string; phone: string | null; role: string };

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { numero } = (await req.json().catch(() => ({}))) as { numero?: unknown };
  const dig = String(numero ?? "").replace(/\D/g, "");
  if (dig.length < 10) return NextResponse.json({ error: "Invalid number" }, { status: 400 });

  const sub = process.env.ZENDESK_SUBDOMAIN?.trim();
  if (!sub || !isZendeskConfigured()) return NextResponse.json({ error: "Zendesk not configured" }, { status: 503 });
  const painel = `https://${sub}.zendesk.com/agent/dashboard`;

  // O Zendesk guarda o telefone como veio: +44..., 44... ou 07... no UK.
  const formas = [`+${dig}`, dig, ...(dig.startsWith("44") ? [`0${dig.slice(2)}`] : [])];
  for (const f of formas) {
    try {
      const r = await zendeskApi<{ users?: UsuarioZd[] }>(`users/search.json?query=${encodeURIComponent(f)}`);
      const u = (r.users ?? []).find((x) => String(x.phone ?? "").replace(/\D/g, "").endsWith(dig.slice(-9)));
      if (u) return NextResponse.json({ url: `https://${sub}.zendesk.com/agent/users/${u.id}/requested_tickets`, nome: u.name, achado: true });
    } catch (e) {
      console.error("[inbox/ligar]", e instanceof Error ? e.message : e);
      break;
    }
  }
  return NextResponse.json({ url: painel, achado: false });
}
