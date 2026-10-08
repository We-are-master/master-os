/**
 * Chase: quem parou de responder recebe até 3 lembretes no dia, escritos pelo
 * Harvey com o contexto da conversa (a pergunta que ficou, o dia que está
 * segurando, o link que expirou). Nada pendente, nada sai (NO_CHASE).
 *
 *   1º: 1h depois da última mensagem da pessoa
 *   2º: 4h depois
 *   3º: 20h depois (o último: "fica com você, é só mandar mensagem")
 *
 * Nunca entre 21h e 8h de Londres, e nunca depois de 23h da última mensagem
 * dela (o WhatsApp só deixa mandar texto livre por 24h). Transferência
 * aguardando depósito tem os lembretes dela (transferencia.ts) e fica fora.
 *
 * Roda pela rota /api/cron/harvey-wa (n8n a cada 10 min), só com HARVEY_WA_LIGADO=1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pensar, type Fala } from "./cerebro";
import { contextoDaPessoa, catalogo, paraFalas, sessaoAtual } from "./motor";
import { chamarSite } from "./site";
import { enviarTexto, historico, vozDaConversa } from "./sunshine";

const DEGRAUS_H = [1, 4, 20];
/** Teste: HARVEY_WA_CHASE_ESCALA=0.05 vira 3 min, 12 min e 1h. */
const escala = () => Number(process.env.HARVEY_WA_CHASE_ESCALA) || 1;
const JANELA_H = 23;

function horaEmLondres(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(d));
}

export type ResultadoChase = { ensaio: boolean; olhados: number; enviados: number; semNada: number; detalhes: string[] };

export async function varrerChases(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoChase> {
  const out: ResultadoChase = { ensaio: !aplicar, olhados: 0, enviados: 0, semNada: 0, detalhes: [] };
  const hora = horaEmLondres(agora);
  if (escala() === 1 && (hora < 8 || hora >= 21)) return out; // no teste acelerado vale a qualquer hora

  const desde = new Date(agora.getTime() - JANELA_H * 3_600_000).toISOString();
  const { data } = await sb
    .from("harvey_wa_conversas")
    .select("conversation_id, phone, cliente_em, harvey_em, chases, checkout_method, sinal_recebido_em, liberado_em")
    .eq("estado", "harvey")
    .lt("chases", 3)
    .gte("cliente_em", desde)
    .not("harvey_em", "is", null)
    .limit(40);

  for (const c of data ?? []) {
    // A última palavra tem que ser do Harvey, e o degrau da vez tem que ter chegado.
    if (new Date(c.harvey_em as string) < new Date(c.cliente_em as string)) continue;
    if (c.checkout_method === "bank" && !c.sinal_recebido_em && !c.liberado_em) continue;
    const horas = (agora.getTime() - new Date(c.cliente_em as string).getTime()) / 3_600_000;
    const n = (c.chases as number) + 1;
    if (horas < DEGRAUS_H[n - 1] * escala()) continue;
    // Com a lista de teste ligada, só quem está nela recebe chase (igual à resposta).
    const lista = (process.env.HARVEY_WA_SO_ESTES ?? "").split(",").map((t) => t.replace(/\D/g, "")).filter(Boolean);
    if (lista.length && !lista.includes(String(c.phone ?? "").replace(/\D/g, ""))) continue;
    out.olhados++;

    const todas = await historico(c.conversation_id as string);
    const voz = vozDaConversa(todas);
    const msgs = voz ? todas : sessaoAtual(todas);
    const ultima = msgs[msgs.length - 1];
    if (!ultima || ultima.author.type === "user") continue; // chegou mensagem e o motor ainda não viu
    const conversa: Fala[] = paraFalas(msgs);
    const { quem, contas, sobreQuem } = await contextoDaPessoa(sb as never, c.phone as string | null);
    const r = await pensar(conversa, { telefone: c.phone as string | null, nomeNoWhatsApp: null, campanha: "wa_v1", quem: quem.tipo, sobreQuem, contas, chase: n, horasSemResposta: horas, falaComo: voz }, chamarSite, await catalogo());

    if (!r.resposta) {
      out.semNada++;
      out.detalhes.push(`${c.conversation_id}: nada pendente, para de cobrar`);
      if (aplicar) await sb.from("harvey_wa_conversas").update({ chases: 3 }).eq("conversation_id", c.conversation_id);
      continue;
    }
    out.enviados++;
    out.detalhes.push(`${c.conversation_id}: chase ${n} (${horas.toFixed(1)}h): ${r.resposta.slice(0, 120)}`);
    if (!aplicar) continue;
    await enviarTexto(c.conversation_id as string, r.resposta, voz);
    const agoraIso = new Date().toISOString();
    await sb.from("harvey_wa_conversas").update({ chases: n, chase_em: agoraIso, harvey_em: agoraIso, atualizado_em: agoraIso }).eq("conversation_id", c.conversation_id);
  }
  return out;
}
