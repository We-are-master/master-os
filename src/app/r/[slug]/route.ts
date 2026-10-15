import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createTradePortalAutoLoginUrl } from "@/lib/partner-portal-link";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";
import {
  createPartnerBidToken,
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
  const ref = (entityRef ?? "").trim();

  /**
   * O convite de ORÇAMENTO também precisa ser reassinado.
   *
   * Ele grava `quote:<id>:partner:<id>`, sem o sufixo de propósito que os
   * links de job usam, e a regex antiga só reconhecia `job:…`. Resultado: o
   * link caía no alvo gravado, com o token assinado pelo Mac, e o parceiro
   * abria "Invalid or expired link" no app.getfixfy.com — que é exatamente o
   * defeito que esta função existe para consertar, num caso que ela não
   * cobria. Visto ao vivo no QT-2026-1140 em 07/09/2026.
   */
  const bid = /^quote:([0-9a-f-]{36}):partner:([0-9a-f-]{36})$/i.exec(ref);
  if (bid) {
    try {
      return createPartnerBidToken(bid[1]!, bid[2]!);
    } catch (err) {
      console.error("[short-link] não consegui reassinar o token de bid:", err);
      return null;
    }
  }

  const m = /^job:([0-9a-f-]{36}):partner:([0-9a-f-]{36}):(accept|report|on_hold)$/i.exec(ref);
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
    .select("target_path, expires_at, entity_ref, hit_count")
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

  /**
   * Conta o clique (15/10/2026). Antes só gravava `last_hit_at`, e num `void`
   * depois da resposta, que a Vercel pode cortar: o `hit_count` ficava em 0
   * para sempre e não dava para saber quantas agências abriram os PDFs.
   * `after()` roda depois do redirect sem atrasar quem clicou. Dois cliques no
   * mesmo instante podem contar como um; para medir abertura de PDF basta.
   */
  const cliques = Number((data as { hit_count?: number | null }).hit_count ?? 0);
  after(async () => {
    const { error: e } = await supabase
      .from("short_links")
      .update({ hit_count: cliques + 1, last_hit_at: new Date().toISOString() })
      .eq("slug", slugTrimmed);
    if (e) console.error("[short-link] hit bump failed:", e.message);
  });

  const row = data as { target_path: string; entity_ref?: string | null };
  let target = String(row.target_path);

  /**
   * Link do report por job (`job:<id>:report`, 15/10/2026): o token sai para o parceiro
   * que está no job AGORA. Sem parceiro, a tela diz isso em vez de "link inválido".
   */
  const porJob = /^job:([0-9a-f-]{36}):report$/i.exec(String(row.entity_ref ?? ""));
  if (porJob) {
    const { data: j } = await supabase.from("jobs").select("partner_id").eq("id", porJob[1]!).is("deleted_at", null).maybeSingle();
    const parceiro = (j as { partner_id?: string | null } | null)?.partner_id;
    if (!j) return NextResponse.redirect(new URL("/quote/respond?token=invalid&motivo=job_removido", req.url), 302);
    if (!parceiro) return NextResponse.redirect(new URL("/quote/respond?token=invalid&motivo=sem_parceiro", req.url), 302);
    try {
      target = `/job/report?token=${encodeURIComponent(createPartnerReportToken(porJob[1]!, parceiro))}`;
    } catch (err) {
      console.error("[short-link] não consegui assinar o link do job:", err);
    }
    /**
     * Uma porta só (15/10/2026): o clique no e-mail entra no PORTAL já logado, direto na
     * aba Report do job. O portal pede o formulário com `?embed=1` para mostrar dentro
     * da gaveta. Se o login automático falhar, segue para o formulário, que funciona sozinho.
     */
    if (req.nextUrl.searchParams.get("embed") !== "1") {
      try {
        const portal = resolvePartnerTradePortalBaseUrl();
        const entrar = await createTradePortalAutoLoginUrl(supabase, parceiro, portal, 1);
        const destino = `/?job=${encodeURIComponent(porJob[1]!)}&tab=report`;
        return NextResponse.redirect(`${entrar}&next=${encodeURIComponent(destino)}`, 302);
      } catch (err) {
        console.error("[short-link] login automático do portal falhou, segue para o formulário:", err);
      }
    }
  } else {
    const fresco = tokenFresco(row.entity_ref);
    if (fresco) target = comTokenNovo(target, fresco, req.url);
  }

  const absolute = /^https?:\/\//i.test(target)
    ? target
    : new URL(target, req.url).toString();
  return NextResponse.redirect(absolute, 302);
}
