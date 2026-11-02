/**
 * Envio pela tela /inbox: o 7983 manda ao contato e a mensagem já entra em
 * `wa_mensagens` como `origem: os`. A entrega e a leitura chegam depois pelo
 * webhook, pelo wamid. Texto livre só dentro das 24h desde a última mensagem
 * do contato; fora disso, um dos templates de parceiro.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarPelaOperacao, EnvioOperacaoError, OPS_PHONE_NUMBER_ID, TEMPLATES_OPERACAO, type TemplateOperacao } from "@/lib/whatsapp/operacao";

export const dynamic = "force-dynamic";

const STAFF = new Set(["admin", "manager", "operator"]);
const JANELA_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: perfil } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!STAFF.has(String(perfil?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const corpo = (await req.json().catch(() => ({}))) as { contato?: string; texto?: string; template?: string; params?: string[] };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  if (!contato) return NextResponse.json({ error: "contato is required" }, { status: 400 });
  const opsId = OPS_PHONE_NUMBER_ID();

  const nomeTemplate = corpo.template as TemplateOperacao | undefined;
  if (nomeTemplate && !(nomeTemplate in TEMPLATES_OPERACAO)) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
  const params = (corpo.params ?? []).map((p) => String(p).trim());
  if (nomeTemplate && (params.length !== TEMPLATES_OPERACAO[nomeTemplate].vars.length || params.some((p) => !p))) {
    return NextResponse.json({ error: "Fill in every field of the template" }, { status: 400 });
  }
  const texto = String(corpo.texto ?? "").trim();
  if (!nomeTemplate && !texto) return NextResponse.json({ error: "Write a message first" }, { status: 400 });

  if (!nomeTemplate) {
    const { data: ultima } = await sb
      .from("wa_mensagens")
      .select("criado_em")
      .eq("phone_number_id", opsId)
      .eq("contato", contato)
      .eq("direcao", "entrada")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ultima || Date.now() - new Date(ultima.criado_em as string).getTime() > JANELA_MS) {
      return NextResponse.json({ error: "The 24h window is closed: send a template" }, { status: 409 });
    }
  }

  try {
    const { wamid, corpo: enviado } = await enviarPelaOperacao({
      para: contato,
      texto,
      template: nomeTemplate ? { nome: nomeTemplate, params } : undefined,
    });
    const { data: anterior } = await sb.from("wa_mensagens").select("partner_id").eq("contato", contato).not("partner_id", "is", null).limit(1).maybeSingle();
    const { data: linha, error } = await sb
      .from("wa_mensagens")
      .insert({
        wamid,
        phone_number_id: opsId,
        contato,
        direcao: "saida",
        origem: "os",
        tipo: nomeTemplate ? "template" : "text",
        texto: nomeTemplate ? `Template: ${nomeTemplate} (${params.join(" · ")})` : texto,
        status: "sent",
        enviado_por: auth.user.id,
        enviado_por_nome: String(perfil?.full_name || perfil?.email || "Team"),
        partner_id: anterior?.partner_id ?? null,
        bruto: enviado,
      })
      .select("*")
      .single();
    if (error) console.error("[inbox-send] gravar", error.message);
    return NextResponse.json({ ok: true, mensagem: linha ?? { wamid } });
  } catch (e) {
    const msg = e instanceof EnvioOperacaoError ? e.message : "Could not send";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
