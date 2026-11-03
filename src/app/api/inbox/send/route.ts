/**
 * Envio pela tela /inbox: o 7983 manda ao contato e a mensagem já entra em
 * `wa_mensagens` como `origem: os`. A entrega e a leitura chegam depois pelo
 * webhook, pelo wamid. Texto livre só dentro das 24h desde a última mensagem
 * do contato; fora disso, um dos templates de parceiro. Pela uazapi
 * (provedorDaOperacao) não há janela nem template.
 *
 * Arquivo (foto, vídeo, documento, áudio gravado) vem em multipart: sobe para
 * o bucket privado `inbox-media`, a uazapi baixa por URL assinada e a linha
 * guarda `storage:<caminho>`, que a tela assina de novo para mostrar.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { ehGrupo } from "@/lib/inbox/grupo";
import { enviarPelaOperacao, EnvioOperacaoError, OPS_PHONE_NUMBER_ID, TEMPLATES_OPERACAO, type TemplateOperacao } from "@/lib/whatsapp/operacao";
import { enviarMidiaPelaUazapi, enviarPelaUazapi, provedorDaOperacao, type TipoDeMidia } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

const JANELA_MS = 24 * 60 * 60 * 1000;
const BUCKET = "inbox-media";
/** A Vercel corta o corpo em 4,5 MB; acima disso a tela avisa antes. */
const LIMITE_BYTES = 4 * 1024 * 1024;

const TIPO_DA_LINHA: Record<TipoDeMidia, string> = { image: "image", video: "video", document: "document", ptt: "audio", audio: "audio" };
const ROTULO: Record<TipoDeMidia, string> = { image: "Photo", video: "Video", document: "Document", ptt: "Voice note", audio: "Audio" };

function tipoDoArquivo(mime: string, pedido: string | null): TipoDeMidia {
  if (pedido === "ptt") return "ptt";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { sb } = s;
  const opsId = OPS_PHONE_NUMBER_ID();
  const pelaUazapi = provedorDaOperacao() === "uazapi";

  const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  let contato = "";
  let texto = "";
  let nomeTemplate: TemplateOperacao | undefined;
  let params: string[] = [];
  let arquivo: File | null = null;
  let tipoPedido: string | null = null;
  /** wamid da mensagem que esta responde (Reply). Só texto pela uazapi. */
  let respondendo: string | undefined;

  if (multipart) {
    const form = await req.formData();
    contato = String(form.get("contato") ?? "").replace(/\D/g, "");
    texto = String(form.get("texto") ?? "").trim();
    tipoPedido = (form.get("tipo") as string | null) ?? null;
    const f = form.get("arquivo");
    arquivo = f instanceof File ? f : null;
    if (!arquivo) return NextResponse.json({ error: "Attach a file" }, { status: 400 });
    if (!pelaUazapi) return NextResponse.json({ error: "Files go out only through the uazapi number" }, { status: 400 });
    if (arquivo.size > LIMITE_BYTES) return NextResponse.json({ error: "File is over 4 MB" }, { status: 413 });
  } else {
    const corpo = (await req.json().catch(() => ({}))) as { contato?: string; texto?: string; template?: string; params?: string[]; respondendo?: string };
    respondendo = typeof corpo.respondendo === "string" && corpo.respondendo.trim() ? corpo.respondendo.trim() : undefined;
    contato = String(corpo.contato ?? "").replace(/\D/g, "");
    texto = String(corpo.texto ?? "").trim();
    nomeTemplate = corpo.template as TemplateOperacao | undefined;
    params = (corpo.params ?? []).map((p) => String(p).trim());
  }
  if (!contato) return NextResponse.json({ error: "contato is required" }, { status: 400 });
  if (ehGrupo(contato) && !pelaUazapi) return NextResponse.json({ error: "Groups go out only through the uazapi number" }, { status: 400 });

  if (nomeTemplate && pelaUazapi) return NextResponse.json({ error: "Templates are not used on this number" }, { status: 400 });
  if (nomeTemplate && !(nomeTemplate in TEMPLATES_OPERACAO)) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
  if (nomeTemplate && (params.length !== TEMPLATES_OPERACAO[nomeTemplate].vars.length || params.some((p) => !p))) {
    return NextResponse.json({ error: "Fill in every field of the template" }, { status: 400 });
  }
  if (!nomeTemplate && !arquivo && !texto) return NextResponse.json({ error: "Write a message first" }, { status: 400 });

  if (!nomeTemplate && !pelaUazapi) {
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
    let wamid: string;
    let enviado: Record<string, unknown>;
    let tipoDaLinha = nomeTemplate ? "template" : "text";
    let midia: string | null = null;
    let textoDaLinha = nomeTemplate ? `Template: ${nomeTemplate} (${params.join(" · ")})` : texto;

    if (arquivo) {
      const tipo = tipoDoArquivo(arquivo.type || "", tipoPedido);
      const nome = (arquivo.name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
      const caminho = `${contato}/${Date.now()}-${nome}`;
      const { error: up } = await sb.storage
        .from(BUCKET)
        .upload(caminho, Buffer.from(await arquivo.arrayBuffer()), { contentType: arquivo.type || "application/octet-stream" });
      if (up) return NextResponse.json({ error: `Upload failed: ${up.message}` }, { status: 500 });
      const { data: assinada } = await sb.storage.from(BUCKET).createSignedUrl(caminho, 60 * 60);
      if (!assinada?.signedUrl) return NextResponse.json({ error: "Could not sign the file" }, { status: 500 });
      ({ wamid, corpo: enviado } = await enviarMidiaPelaUazapi(
        contato,
        tipo,
        assinada.signedUrl,
        texto || undefined,
        tipo === "document" ? arquivo.name || nome : undefined,
      ));
      tipoDaLinha = TIPO_DA_LINHA[tipo];
      midia = `storage:${caminho}`;
      textoDaLinha = texto || (tipo === "document" ? arquivo.name || ROTULO[tipo] : ROTULO[tipo]);
    } else if (pelaUazapi) {
      ({ wamid, corpo: enviado } = await enviarPelaUazapi(contato, texto, respondendo));
    } else {
      ({ wamid, corpo: enviado } = await enviarPelaOperacao({
        para: contato,
        texto,
        template: nomeTemplate ? { nome: nomeTemplate, params } : undefined,
      }));
    }

    const { data: anterior } = await sb.from("wa_mensagens").select("partner_id").eq("contato", contato).not("partner_id", "is", null).limit(1).maybeSingle();
    const { data: linha, error } = await sb
      .from("wa_mensagens")
      .insert({
        wamid,
        phone_number_id: opsId,
        contato,
        direcao: "saida",
        origem: "os",
        tipo: tipoDaLinha,
        texto: textoDaLinha,
        midia_id: midia,
        status: "sent",
        enviado_por: s.userId,
        enviado_por_nome: s.nome,
        partner_id: anterior?.partner_id ?? null,
        // `quoted` igual ao que o webhook grava quando o contato responde: a tela acha a citada pelo mesmo campo.
        bruto: respondendo && pelaUazapi && !arquivo ? { ...enviado, quoted: respondendo } : enviado,
      })
      .select("*")
      .single();
    if (error) console.error("[inbox-send] gravar", error.message);

    let midiaUrl: string | null = null;
    if (midia) {
      const { data: ver } = await sb.storage.from(BUCKET).createSignedUrl(midia.slice("storage:".length), 60 * 60 * 12);
      midiaUrl = ver?.signedUrl ?? null;
    }
    return NextResponse.json({ ok: true, mensagem: linha ? { ...linha, midiaUrl } : { wamid } });
  } catch (e) {
    const msg = e instanceof EnvioOperacaoError ? e.message : "Could not send";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
