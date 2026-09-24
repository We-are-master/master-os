import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { stopAllSequences } from "@/lib/email-sequences/enroll";
import { bloquear } from "@/lib/marketing/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(message: string): NextResponse {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F7F7FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:64px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(2,0,64,.08);">
<tr><td style="padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#020040;">Fixfy</p>
<p style="margin:0;font-size:15px;line-height:24px;color:#57534E;">${message}</p>
</td></tr></table></td></tr></table></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function unsubscribe(token: string): Promise<NextResponse> {
  const email = verifyUnsubscribeToken(token);
  if (!email) return page("This unsubscribe link is invalid or has expired.");

  const admin = createServiceClient();
  await stopAllSequences(email);
  await admin
    .from("leads")
    .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
    .eq("status", "enrolled") // don't resurrect converted/invalid rows
    .ilike("email", email);

  /**
   * A lista de bloqueio, que é o que faz o pedido valer em TODAS as camadas.
   *
   * Sem esta linha a pessoa saía das sequências e continuava na `clients`,
   * então recebia a próxima campanha pela outra porta. Sair de uma lista e
   * receber de outra é exatamente como se ganha marcação de spam, e a
   * marcação cai sobre o domínio que também manda confirmação de job.
   *
   * Não deixa a página quebrar: se o bloqueio falhar, quem clicou ainda vê
   * a confirmação, e o erro fica no log para alguém consertar.
   */
  try {
    await bloquear(email, "unsubscribed", "email_footer");
  } catch (err) {
    console.error(`[unsubscribe] falhou gravar o bloqueio de ${email}:`, err);
  }

  return page("You've been unsubscribed. You won't receive any more emails from us.");
}

/** Click from the email footer. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("e");
  if (!token) return page("Missing unsubscribe token.");
  return unsubscribe(token);
}

/** One-click unsubscribe (RFC 8058 List-Unsubscribe-Post). */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("e");
  if (!token) return page("Missing unsubscribe token.");
  return unsubscribe(token);
}
