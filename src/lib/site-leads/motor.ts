/**
 * O motor da reserva abandonada: manda o e-mail que venceu para cada lead.
 *
 * Roda a cada 10 minutos pelo n8n (a Vercel do OS é Hobby e não aguenta cron
 * frequente). Antes de CADA envio confere de novo, porque o horário foi
 * calculado horas antes e muita coisa pode ter mudado:
 *   - o lead ainda está aberto e com a sequência agendada (pagou, perdeu,
 *     "em contato" ou descadastrou para tudo);
 *   - não marcou "Don't email me offers", não está na lista de bloqueio, e o
 *     cliente não tem a etiqueta no-marketing;
 *   - não existe job novo para esse cliente desde que o lead nasceu (rede de
 *     segurança se o aviso de pagamento do site se perder).
 *
 * Um e-mail por lead por volta, na ordem 1 → 2 → 3. O envio é "reservado"
 * gravando o horário antes de mandar; se o Resend falhar, a reserva é desfeita
 * e a próxima volta tenta de novo. Assim duas voltas nunca mandam o mesmo.
 *
 * Desligado por padrão: só manda com RESERVA_ABANDONADA=on. `dryRun` calcula
 * tudo e não manda nem grava nada.
 */

import { Resend } from "resend";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { estaBloqueado } from "@/lib/marketing/suppressions";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { NO_MARKETING_TAG } from "@/lib/contacts-ingest";
import { email1, email2, email3, type ReservaAbandonada, type EmailPronto } from "@/lib/emails/reserva-abandonada";
import { registrarAtividade } from "@/lib/site-leads/core";

const WHATSAPP_NUMERO = "442045384668";
const DESCONTO = 10;
const VALIDADE_HORAS = 48;
const CAMPANHA = "reserva-abandonada";

export function motorLigado(): boolean {
  return process.env.RESERVA_ABANDONADA?.trim().toLowerCase() === "on";
}

// A linha de site_leads como vem do PostgREST (294). Tipos soltos de propósito:
// o motor só lê e confere, e cada campo é validado antes de usar.
type Lead = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Passo = 1 | 2 | 3;

export type ResultadoDoMotor = {
  ensaio: boolean;
  vistos: number;
  enviados: Array<{ lead: string; email: Passo }>;
  pulados: Array<{ lead: string; email: Passo; motivo: string }>;
  erros: string[];
};

function proximoPasso(l: Lead, agora: Date): Passo | null {
  const venceu = (v: unknown) => typeof v === "string" && new Date(v).getTime() <= agora.getTime();
  if (!l.email1_sent_at) return venceu(l.email1_due_at) ? 1 : null;
  if (!l.email2_sent_at) return venceu(l.email2_due_at) ? 2 : null;
  if (!l.email3_sent_at) return venceu(l.email3_due_at) ? 3 : null;
  return null;
}

/** "a 2 bed deep clean", "an end of tenancy clean". */
function comArtigo(nome: string): string {
  return `${/^[aeiou]/i.test(nome.trim()) ? "an" : "a"} ${nome.trim()}`;
}

/** Botão de continuar: o link do site, com a origem do e-mail e (no 3) o código. */
function linkDeRetomada(l: Lead, passo: Passo, promo?: string): string {
  const base = l.resume_url || "https://www.getfixfy.com/";
  const u = new URL(base);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", "lifecycle");
  u.searchParams.set("utm_campaign", CAMPANHA);
  u.searchParams.set("utm_content", `email${passo}`);
  if (promo) u.searchParams.set("promo", promo);
  return u.toString();
}

function dadosDoEmail(l: Lead, passo: Passo, promo?: ReservaAbandonada["promo"]): ReservaAbandonada {
  const nome = String(l.service_label || "booking").trim();
  const detalhes = Array.isArray(l.selection?.details) ? (l.selection.details as unknown[]).map(String).slice(0, 3) : [];
  const texto = encodeURIComponent(`Hi, I have a question about my ${nome} booking`);
  return {
    firstName: l.full_name,
    service: { name: nome, withArticle: comArtigo(nome) },
    details: detalhes,
    postcode: l.postcode,
    price: Number(l.price ?? 0),
    resumeUrl: linkDeRetomada(l, passo, promo?.code),
    whatsappUrl: `https://wa.me/${WHATSAPP_NUMERO}?text=${texto}`,
    unsubscribeUrl: unsubscribeUrl(l.email),
    promo,
  };
}

/**
 * O código de 10% do e-mail 3, um por pessoa, na Stripe do SITE (live).
 *
 * A chave do OS na Vercel é de teste, e código criado em teste não funciona no
 * checkout do site. Por isso a chave aqui é outra: STRIPE_PROMO_SECRET_KEY,
 * uma restrita live com escrita só em Coupons e Promotion codes.
 */
async function criarCodigo(l: Lead, agora: Date): Promise<{ code: string; id: string; expiresAt: Date }> {
  const chave = process.env.STRIPE_PROMO_SECRET_KEY?.trim();
  if (!chave) throw new Error("STRIPE_PROMO_SECRET_KEY ausente");
  const stripe = new Stripe(chave, { typescript: true });
  const expiresAt = new Date(agora.getTime() + VALIDADE_HORAS * 3_600_000);
  const expiraEm = Math.floor(expiresAt.getTime() / 1000);
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const sufixo = Array.from({ length: 5 }, () => letras[Math.floor(Math.random() * letras.length)]).join("");
  const code = `BACK-${sufixo}`;
  const coupon = await stripe.coupons.create({
    percent_off: DESCONTO,
    duration: "once",
    max_redemptions: 1,
    redeem_by: expiraEm,
    name: `Welcome back ${DESCONTO}%`,
    metadata: { site_lead_id: String(l.id), origem: CAMPANHA },
  });
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    expires_at: expiraEm,
    metadata: { site_lead_id: String(l.id), origem: CAMPANHA },
  });
  return { code, id: promo.id, expiresAt };
}

async function motivoParaNaoMandar(sb: ReturnType<typeof createServiceClient>, l: Lead): Promise<string | null> {
  if (!["new", "hot"].includes(l.status)) return `estado ${l.status}`;
  if (l.sequence_state !== "scheduled") return `sequência ${l.sequence_state}`;
  if (l.marketing_opt_out) return "pediu para não receber ofertas";
  if (!(Number(l.price) > 0)) return "sem preço";
  if (await estaBloqueado(l.email)) return "lista de bloqueio";
  if (l.client_id) {
    const { data: c } = await sb.from("clients").select("tags").eq("id", l.client_id).maybeSingle();
    if (Array.isArray(c?.tags) && c.tags.includes(NO_MARKETING_TAG)) return "etiqueta no-marketing";
    const { data: job } = await sb
      .from("jobs")
      .select("id, reference")
      .eq("client_id", l.client_id)
      .gte("created_at", l.created_at)
      .is("deleted_at", null)
      .neq("status", "deleted")
      .limit(1)
      .maybeSingle();
    if (job) return `job ${job.reference ?? job.id} criado depois do lead`;
  }
  return null;
}

export async function rodarMotor({ dryRun = true, agora = new Date(), limite = 50 } = {}): Promise<ResultadoDoMotor> {
  const ensaio = dryRun || !motorLigado();
  const res: ResultadoDoMotor = { ensaio, vistos: 0, enviados: [], pulados: [], erros: [] };
  const sb = createServiceClient();
  const agoraIso = agora.toISOString();

  const { data: leads, error } = await sb
    .from("site_leads")
    .select("*")
    .eq("sequence_state", "scheduled")
    .in("status", ["new", "hot"])
    .or(
      `and(email1_sent_at.is.null,email1_due_at.lte.${agoraIso}),` +
      `and(email2_sent_at.is.null,email2_due_at.lte.${agoraIso}),` +
      `and(email3_sent_at.is.null,email3_due_at.lte.${agoraIso})`,
    )
    .order("last_activity_at", { ascending: true })
    .limit(limite);
  if (error) { res.erros.push(error.message); return res; }

  const remetente = process.env.RESEND_MARKETING_FROM?.trim();
  if (!ensaio && !remetente) { res.erros.push("RESEND_MARKETING_FROM ausente"); return res; }
  const resend = ensaio ? null : new Resend(process.env.RESEND_API_KEY);
  const replyTo = process.env.RESEND_MARKETING_REPLY_TO?.trim();

  for (const l of (leads ?? []) as Lead[]) {
    res.vistos++;
    const passo = proximoPasso(l, agora);
    if (!passo) continue;

    const motivo = await motivoParaNaoMandar(sb, l);
    if (motivo) {
      res.pulados.push({ lead: l.id, email: passo, motivo });
      if (!ensaio) {
        // Job novo ou pedido de não receber: a sequência acaba aqui.
        await sb.from("site_leads").update({ sequence_state: "stopped", updated_at: agoraIso }).eq("id", l.id);
        await registrarAtividade(sb, l.id, "email_skipped", `E-mail ${passo} não saiu: ${motivo}. Sequência encerrada.`);
      }
      continue;
    }

    if (ensaio) { res.enviados.push({ lead: l.id, email: passo }); continue; }

    // Reserva o envio: só uma volta ganha.
    const coluna = `email${passo}_sent_at`;
    const { data: reservado } = await sb
      .from("site_leads")
      .update({ [coluna]: agoraIso, updated_at: agoraIso })
      .eq("id", l.id)
      .is(coluna, null)
      .select("id")
      .maybeSingle();
    if (!reservado) continue;

    try {
      let promo: ReservaAbandonada["promo"];
      if (passo === 3) {
        const c = await criarCodigo(l, agora);
        const preco = Number(l.price);
        promo = { code: c.code, percentOff: DESCONTO, discountedPrice: Math.round(preco * (100 - DESCONTO)) / 100, expiresAt: c.expiresAt };
        await sb.from("site_leads").update({ promo_code: c.code, promo_id: c.id, promo_expires_at: c.expiresAt.toISOString() }).eq("id", l.id);
      }
      const dados = dadosDoEmail(l, passo, promo);
      const e: EmailPronto = passo === 1 ? email1(dados) : passo === 2 ? email2(dados) : email3(dados);
      const unsub = dados.unsubscribeUrl;
      const { data: enviado, error: erroEnvio } = await resend!.emails.send({
        from: remetente!,
        to: [l.email],
        subject: e.subject,
        html: e.html,
        text: e.text,
        ...(replyTo ? { replyTo } : {}),
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "campaign", value: CAMPANHA }, { name: "step", value: `email${passo}` }],
      });
      if (erroEnvio) throw new Error(erroEnvio.message);

      await sb.from("marketing_touches").insert({
        email: l.email,
        client_id: l.client_id ?? null,
        campaign: `${CAMPANHA}:email${passo}`,
        channel: "email",
        segment: "b2c",
        subject: e.subject,
        provider_id: enviado?.id ?? null,
        sent_at: agoraIso,
      });
      await registrarAtividade(sb, l.id, "email_sent", `E-mail ${passo} enviado: "${e.subject}"`, {
        providerId: enviado?.id ?? null,
        meta: { step: passo, promo: promo?.code ?? null },
      });
      if (passo === 3) await sb.from("site_leads").update({ sequence_state: "done" }).eq("id", l.id);
      res.enviados.push({ lead: l.id, email: passo });
    } catch (err) {
      await sb.from("site_leads").update({ [coluna]: null }).eq("id", l.id);
      res.erros.push(`${l.id} e-mail ${passo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}
