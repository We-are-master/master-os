/** Catálogo de tags da /inbox. Cada tag vira uma view na lateral. */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";

export const dynamic = "force-dynamic";

const CORES = new Set(["slate", "blue", "green", "amber", "red", "violet", "teal", "pink"]);

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const corpo = (await req.json().catch(() => ({}))) as { nome?: string; cor?: string };
  const nome = String(corpo.nome ?? "").trim().slice(0, 40);
  if (!nome) return NextResponse.json({ error: "Name the tag" }, { status: 400 });
  const cor = CORES.has(String(corpo.cor)) ? String(corpo.cor) : "slate";
  const { data, error } = await s.sb.from("inbox_tags").upsert({ nome, cor }, { onConflict: "nome" }).select("id, nome, cor").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tag: data });
}

export async function DELETE(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const nome = req.nextUrl.searchParams.get("nome")?.trim();
  if (!nome) return NextResponse.json({ error: "nome is required" }, { status: 400 });
  const { error } = await s.sb.from("inbox_tags").delete().eq("nome", nome);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
