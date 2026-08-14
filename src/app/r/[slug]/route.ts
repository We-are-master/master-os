import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createPartnerJobAcceptToken,
  createPartnerOnHoldToken,
  createPartnerReportToken,
} from "@/lib/quote-response-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reassina o token do alvo com o segredo de QUEM ESTÁ SERVINDO esta requisição.
 *
 * Sem isto, um link só funciona no ambiente que o gerou. O token é um HMAC de
 * `QUOTE_RESPONSE_SECRET`, e a operação inteira roda no servidor local, que não
 * tem a variável e por isso assina com o placeholder de desenvolvimento. O link
 * no email, porém, aponta para `app.getfixfy.com`, que confere com o segredo de
 * verdade. Resultado: todo link tokenizado que saiu por email chegou ao parceiro
 * como "Link inválido ou expirado", e do ponto de vista de produção ele era
 * mesmo indistinguível de um token forjado.
 *
 * A saída não é sincronizar segredo entre ambientes, é parar de depender disso:
 * os dois compartilham o BANCO, e o `entity_ref` da linha já diz exatamente quem
 * é o job e quem é o parceiro. Então o slug passa a ser a credencial (ele já era
 * aleatório e guardado), e o token é emitido na hora do clique, por quem atende.
 * Isso conserta os links já enviados, porque a linha no banco não muda, e
 * sobrevive a uma rotação de segredo sem quebrar nada.
 *
 * Devolve null quando o `entity_ref` não é de parceiro: aí o alvo segue intacto.
 */
function tokenFresco(entityRef: string | null | undefined): string | null {
  const m = /^job:([0-9a-f-]{36}):partner:([0-9a-f-]{36}):(accept|report|on_hold)$/i.exec(
    (entityRef ?? "").trim(),
  );
  if (!m) return null;
  const [, jobId, partnerId, proposito] = m;
  try {
    if (proposito === "report") return createPartnerReportToken(jobId, partnerId);
    if (proposito === "accept") return createPartnerJobAcceptToken(jobId, partnerId);
    return createPartnerOnHoldToken(jobId, partnerId);
  } catch (err) {
    // Segredo ausente em produção faz getSecret() estourar. Melhor cair para o
    // alvo gravado, que pelo menos leva a pessoa à tela certa, do que devolver
    // 500 numa rota pública que o parceiro abre do celular.
    console.error("[short-link] não consegui reassinar o token:", err);
    return null;
  }
}

/** Troca só o `token` da query, preservando rota e demais parâmetros. */
function comTokenNovo(targetPath: string, token: string, base: string): string {
  try {
    const u = new URL(targetPath, base);
    if (!u.searchParams.has("token")) return targetPath;
    u.searchParams.set("token", token);
    return /^https?:\/\//i.test(targetPath) ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return targetPath;
  }
}

/**
 * GET /r/[slug]
 *
 * Public shortener — looks up the slug in `short_links` and redirects (302)
 * to the stored `target_path`. Partner links get their token re-signed here
 * (see `tokenFresco`); everything else redirects to the stored target as-is.
 *
 * If the slug is unknown or expired, redirects to `/quote/respond?token=invalid`
 * so the visitor sees a friendly invalid-link message (not the quote reject form).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const slugTrimmed = slug?.trim();
  if (!slugTrimmed) {
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[short-link] service client unavailable:", err);
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const { data, error } = await supabase
    .from("short_links")
    .select("target_path, expires_at, entity_ref")
    .eq("slug", slugTrimmed)
    .maybeSingle();

  if (error || !data) {
    console.warn("[short-link] slug not found:", slugTrimmed, error?.message);
    return NextResponse.redirect(new URL("/quote/respond?token=invalid", req.url), 302);
  }

  const expiresAt = (data as { expires_at?: string | null }).expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/quote/respond?token=expired", req.url), 302);
  }

  // Best-effort last-hit timestamp (don't gate the redirect on this).
  void supabase
    .from("short_links")
    .update({ last_hit_at: new Date().toISOString() })
    .eq("slug", slugTrimmed)
    .then(({ error: e }) => {
      if (e) console.error("[short-link] last_hit_at bump failed:", e.message);
    });

  const row = data as { target_path: string; entity_ref?: string | null };
  let target = String(row.target_path);

  const fresco = tokenFresco(row.entity_ref);
  if (fresco) target = comTokenNovo(target, fresco, req.url);

  const absolute = /^https?:\/\//i.test(target)
    ? target
    : new URL(target, req.url).toString();
  return NextResponse.redirect(absolute, 302);
}
