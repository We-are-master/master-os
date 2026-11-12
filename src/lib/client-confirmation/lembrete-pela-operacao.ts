/**
 * Lembrete de véspera pelo número da operação, o 07 (…7983), e não mais pelo
 * WhatsApp do Zendesk (dono, 09/11/2026): "24 horas antes somente do outro
 * WhatsApp; aquele número 07 para operação, e o Zendesk venda e cobrança".
 *
 * O 7983 está na uazapi: sem janela de 24h e sem template, então vai texto
 * livre. A mensagem entra em `wa_mensagens` como as do /inbox, e a resposta do
 * cliente cai na mesma conversa da tela, onde a operação já fala com parceiro.
 *
 * Uazapi é ponte não oficial: o risco é ban por disparo. Lembrete é 1 a 1, um
 * por job por dia e só no horário comercial, que é o uso que ela aguenta.
 *
 *   LEMBRETE_24H_CANAL = operacao (padrão) | zendesk (o caminho de antes, por template)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPS_PHONE_NUMBER_ID } from "@/lib/whatsapp/operacao";
import { enviarPelaUazapi, provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";

export type CanalDoLembrete24h = "operacao" | "zendesk";

export function canalDoLembrete24h(): CanalDoLembrete24h {
  return process.env.LEMBRETE_24H_CANAL?.trim().toLowerCase() === "zendesk" ? "zendesk" : "operacao";
}

/** O 7983 só manda texto livre pela uazapi; pela Meta precisaria de template aprovado. */
export function operacaoProntaParaLembrete(): string | null {
  if (provedorDaOperacao() !== "uazapi") return "ops number (07) is not on uazapi: set WHATSAPP_OPS_PROVIDER=uazapi and UAZAPI_OPS_TOKEN";
  if (!process.env.UAZAPI_OPS_TOKEN?.trim()) return "UAZAPI_OPS_TOKEN is not set";
  return null;
}

/** O texto do lembrete. Curto, humano, sem travessão (regra do dono). */
export function textoDoLembrete(a: { nome: string; data: string; janela: string; endereco: string | null }): string {
  const linhas = [
    `Hi ${a.nome}, just a reminder that your Fixfy visit is tomorrow, ${a.data}.`,
    `Arrival between ${a.janela}${a.endereco ? ` at ${a.endereco}` : ""}.`,
    "If anything has changed, just reply here.",
    "Fixfy Team",
  ];
  return linhas.join("\n");
}

/** Manda pelo 7983 e grava na conversa do /inbox. Lança se a uazapi recusar. */
export async function enviarLembretePelaOperacao(sb: SupabaseClient, telefone: string, texto: string, quem = "Fixfy (24h reminder)"): Promise<{ wamid: string }> {
  const contato = telefone.replace(/\D/g, "");
  const { wamid, corpo } = await enviarPelaUazapi(contato, texto);
  const { error } = await sb.from("wa_mensagens").insert({
    wamid,
    phone_number_id: OPS_PHONE_NUMBER_ID(),
    contato,
    direcao: "saida",
    origem: "os",
    tipo: "text",
    texto,
    status: "sent",
    enviado_por: null,
    enviado_por_nome: quem,
    bruto: corpo,
  });
  // Já entregou: falha de gravação não pode virar reenvio.
  if (error) console.error("[lembrete-24h] gravar no inbox:", error.message);
  return { wamid };
}
