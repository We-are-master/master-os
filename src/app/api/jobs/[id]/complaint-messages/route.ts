import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Fotos da reclamação ficam no bucket privado de fotos do job, servidas por URL assinada. */
const BUCKET = "job-photos";
const MAX_FOTOS = 10;

type Linha = {
  id: string;
  author: "partner" | "office";
  author_name: string | null;
  body: string | null;
  photos: string[] | null;
  visible_to_partner: boolean;
  created_at: string;
};

/**
 * Journal da reclamação (mig 333, 15/10/2026).
 *   GET  → mensagens do escritório e do parceiro, com as fotos assinadas
 *   POST (multipart: body, visible "1"/"0", photos[]) → mensagem do escritório
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("job_complaint_messages")
    .select("id, author, author_name, body, photos, visible_to_partner, created_at")
    .eq("job_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ messages: [], error: error.message });
  const linhas = (data ?? []) as Linha[];
  const caminhos = linhas.flatMap((l) => l.photos ?? []);
  const assinadas = new Map<string, string>();
  if (caminhos.length) {
    const { data: urls } = await sb.storage.from(BUCKET).createSignedUrls(caminhos, 60 * 60);
    for (const u of urls ?? []) if (u.path && u.signedUrl) assinadas.set(u.path, u.signedUrl);
  }
  return NextResponse.json({
    messages: linhas.map((l) => ({ ...l, photos: (l.photos ?? []).map((p) => assinadas.get(p)).filter(Boolean) })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const body = String(form.get("body") ?? "").trim().slice(0, 4000);
  const visivel = String(form.get("visible") ?? "1") !== "0";
  const arquivos = form.getAll("photos[]").filter((v): v is File => v instanceof File && v.size > 0).slice(0, MAX_FOTOS);
  if (!body && arquivos.length === 0) return NextResponse.json({ error: "Write a message or add a photo." }, { status: 400 });

  const sb = createServiceClient();
  const { data: job } = await sb.from("jobs").select("id").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const { data: perfil } = await sb.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();

  const caminhos: string[] = [];
  for (const [i, f] of arquivos.entries()) {
    const ext = f.type === "application/pdf" ? "pdf" : f.type.includes("png") ? "png" : "jpg";
    const caminho = `complaints/${id}/office-${Date.now()}-${i}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(caminho, new Uint8Array(await f.arrayBuffer()), { contentType: f.type || "image/jpeg" });
    if (!error) caminhos.push(caminho);
    else console.error("[complaint-messages] upload", error.message);
  }

  const { error } = await sb.from("job_complaint_messages").insert({
    job_id: id,
    author: "office",
    author_name: (perfil as { full_name?: string | null } | null)?.full_name ?? "Fixfy",
    body: body || null,
    photos: caminhos,
    visible_to_partner: visivel,
    created_by: auth.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, photos: caminhos.length });
}
