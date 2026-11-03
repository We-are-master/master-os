/** O 7983 está conectado? A lateral da /inbox pergunta a cada minuto. */

import { NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { provedorDaOperacao, statusDaInstancia } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  if (provedorDaOperacao() !== "uazapi") return NextResponse.json({ conectado: true, estado: "meta" });
  return NextResponse.json(await statusDaInstancia());
}
