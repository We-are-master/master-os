/**
 * Envio de campanha de marketing para CLIENTES, por segmento.
 *
 * Irmã de `/api/admin/outreach/send`, que continua sendo a rota de parceiro.
 * São duas porque as regras são diferentes, e misturar as duas é como se
 * manda promoção para quem pediu para sair:
 *
 *   parceiro   é gente que trabalha conosco. Recebe aviso operacional.
 *   cliente    é destinatário de marketing. Exige saída fácil em toda
 *              mensagem, respeito à lista de bloqueio, e registro do toque.
 *
 * Toda mensagem daqui sai com link de unsubscribe assinado e cabeçalho
 * `List-Unsubscribe`, que é exigência legal no B2C britânico e o que faz o
 * provedor confiar no domínio.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth-api";
import { checkRateLimit } from "@/lib/rate-limit";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { resolverSegmento, type FiltroSegmento, type Destinatario } from "@/lib/marketing/segments";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Envios simultâneos. Doze mantém folga no limite do Resend e ainda é rápido. */
const LOTE = 12;

type CorpoDoPedido = {
  campanha?: string;
  assunto?: string;
  corpoTexto?: string;
  filtro?: FiltroSegmento;
  /** Sem isto a rota só calcula e devolve a prévia. O padrão é NÃO enviar. */
  enviar?: boolean;
  /** Manda uma cópia só para você, com o primeiro destinatário como exemplo. */
  teste?: boolean;
};

/**
 * O primeiro nome, para o "Hi {nome}".
 *
 * Nome vazio vira "there": "Hi ," é pior que não personalizar, e nome inteiro
 * com sobrenome em e-mail pessoal soa a mala direta.
 */
function primeiroNome(nome: string | null): string {
  const n = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return n.length >= 2 ? n : "there";
}

/**
 * Texto puro virando HTML mínimo.
 *
 * De propósito sem logo, sem banner e sem coluna: a campanha tem que parecer
 * e-mail escrito por uma pessoa. Assinatura pesada denuncia disparo e derruba
 * a resposta, que é a métrica que interessa aqui.
 */
function comoEmail(texto: string, linkSaida: string): string {
  const corpo = texto
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split("\n").join("<br>");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#16171A;max-width:560px">
${corpo}
<div style="margin-top:28px;padding-top:14px;border-top:1px solid #E3DFD8;font-size:12px;color:#88847D">
If you'd rather not hear from us, <a href="${linkSaida}" style="color:#88847D">unsubscribe here</a>.
</div>
</div>`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  const rl = checkRateLimit(`marketing:${auth.user.id}`, 5, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many campaigns. Wait a minute." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  let body: CorpoDoPedido;
  try { body = (await req.json()) as CorpoDoPedido; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const campanha = String(body.campanha ?? "").trim();
  const assunto = String(body.assunto ?? "").trim();
  const corpoTexto = String(body.corpoTexto ?? "").trim();
  const filtro = body.filtro;
  if (!campanha) return NextResponse.json({ error: "campanha é obrigatória (ex: b2c_setembro_01)" }, { status: 400 });
  if (!assunto) return NextResponse.json({ error: "assunto é obrigatório" }, { status: 400 });
  if (!corpoTexto) return NextResponse.json({ error: "corpoTexto é obrigatório" }, { status: 400 });
  if (!filtro?.segmento) return NextResponse.json({ error: "filtro.segmento é obrigatório" }, { status: 400 });

  let destinatarios: Destinatario[];
  try {
    destinatarios = (await resolverSegmento(filtro)).filter((d) => d.email);
  } catch (err) {
    console.error("[marketing/send] segmento falhou:", err);
    return NextResponse.json({ error: "Falhou resolver o segmento", detalhe: String(err) }, { status: 500 });
  }

  const previa = {
    campanha,
    assunto,
    segmento: filtro.segmento,
    destinatarios: destinatarios.length,
    compradores: destinatarios.filter((d) => d.jaComprou).length,
    porArea: destinatarios.reduce<Record<string, number>>((a, d) => { const k = d.area ?? "sem area"; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    exemplo: destinatarios[0] ? { nome: primeiroNome(destinatarios[0].nome), email: destinatarios[0].email } : null,
  };

  /**
   * O padrão é prévia, e isso não é excesso de zelo.
   *
   * Um disparo não tem desfazer. `enviar: true` obriga quem chama a olhar a
   * contagem antes, que é a única chance de perceber que o segmento veio com
   * 2.600 pessoas quando você queria 100.
   */
  if (!body.enviar && !body.teste) {
    return NextResponse.json({ previa, enviado: false, aviso: "Prévia. Nada foi enviado. Mande enviar:true para valer." });
  }

  const chave = process.env.RESEND_API_KEY?.trim();
  if (!chave) return NextResponse.json({ error: "RESEND_API_KEY não configurada" }, { status: 503 });
  const resend = new Resend(chave);

  /**
   * Marketing NUNCA sai do mesmo remetente do transacional.
   *
   * `getfixfy.com` manda confirmação de job, e-mail de parceiro e cobrança.
   * Se ele for marcado como spam, a operação para. Campanha sai de um
   * subdomínio próprio, cuja reputação pode queimar sem levar a empresa junto.
   */
  const remetente = process.env.RESEND_MARKETING_FROM?.trim();
  if (!remetente) {
    return NextResponse.json(
      { error: "RESEND_MARKETING_FROM não configurada", detalhe: "Use um subdomínio separado, ex: Victor <victor@mail.getfixfy.com>. Marketing não sai do domínio que manda job e cobrança." },
      { status: 503 },
    );
  }
  const responderPara = process.env.RESEND_MARKETING_REPLY_TO?.trim() || undefined;

  const admin = createServiceClient();

  // ─── Teste: um e-mail só, para você, com o primeiro destinatário de exemplo ──
  if (body.teste) {
    const meu = auth.user.email;
    if (!meu) return NextResponse.json({ error: "sua conta não tem e-mail" }, { status: 400 });
    const d = destinatarios[0];
    const texto = corpoTexto.replace(/\{\{\s*nome\s*\}\}/gi, primeiroNome(d?.nome ?? null));
    const { data, error } = await resend.emails.send({
      from: remetente,
      to: [meu],
      subject: `[TESTE] ${assunto}`,
      html: comoEmail(texto, unsubscribeUrl(meu)),
      ...(responderPara ? { replyTo: responderPara } : {}),
    });
    if (error) return NextResponse.json({ error: "teste falhou", detalhe: error.message }, { status: 502 });
    return NextResponse.json({ teste: true, enviadoPara: meu, messageId: data?.id, previa });
  }

  // ─── Envio de verdade ───────────────────────────────────────────────────────
  let enviados = 0;
  const falhas: Array<{ email: string; erro: string }> = [];
  const toques: Array<Record<string, unknown>> = [];

  for (let i = 0; i < destinatarios.length; i += LOTE) {
    const fatia = destinatarios.slice(i, i + LOTE);
    const resultados = await Promise.all(
      fatia.map(async (d) => {
        const saida = unsubscribeUrl(d.email!);
        const texto = corpoTexto
          .replace(/\{\{\s*nome\s*\}\}/gi, primeiroNome(d.nome))
          .replace(/\{\{\s*postcode\s*\}\}/gi, d.postcode ?? "your area");
        try {
          const { data, error } = await resend.emails.send({
            from: remetente,
            to: [d.email!],
            subject: assunto.replace(/\{\{\s*postcode\s*\}\}/gi, d.postcode ?? "your area"),
            html: comoEmail(texto, saida),
            ...(responderPara ? { replyTo: responderPara } : {}),
            // RFC 8058: o botão nativo de "cancelar inscrição" do Gmail e do
            // Outlook. Quem tem esse botão usa ele em vez de marcar spam.
            headers: { "List-Unsubscribe": `<${saida}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          });
          if (error) return { d, erro: error.message, id: null as string | null };
          return { d, erro: null as string | null, id: data?.id ?? null };
        } catch (err) {
          return { d, erro: String(err), id: null as string | null };
        }
      }),
    );
    for (const r of resultados) {
      if (r.erro) { falhas.push({ email: r.d.email!, erro: r.erro }); continue; }
      enviados++;
      toques.push({
        email: r.d.email, phone: r.d.telefone, client_id: r.d.clientId,
        campaign: campanha, channel: "email", segment: r.d.segmento,
        subject: assunto, provider_id: r.id,
      });
    }
  }

  /**
   * O registro do toque entra DEPOIS do envio, em lote.
   *
   * Se gravar antes e o envio falhar, o painel mostra mensagem que ninguém
   * recebeu. Se o registro falhar depois, o e-mail já saiu e o webhook ainda
   * chega, então perde-se histórico, não mensagem. O erro certo é o segundo.
   */
  for (let i = 0; i < toques.length; i += 500) {
    const { error } = await admin.from("marketing_touches").insert(toques.slice(i, i + 500));
    if (error) console.error("[marketing/send] falhou gravar toques:", error.message);
  }

  return NextResponse.json({ previa, enviado: true, enviados, falhas: falhas.length, primeirasFalhas: falhas.slice(0, 5) });
}
