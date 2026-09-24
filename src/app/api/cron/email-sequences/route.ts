/**
 * O motor do funil: pega o que venceu, manda, e anda o passo.
 *
 * Roda a cada quinze minutos (Vercel Cron, `Authorization: Bearer CRON_SECRET`).
 * Cada volta envia todo passo vencido e avança a inscrição; sequência que gira
 * volta ao passo zero e soma um no ciclo, que é o que faz o clube do cliente
 * nunca acabar.
 *
 * As quatro travas que existem aqui, e por que cada uma:
 *
 *   1. lista de bloqueio   quem pediu para sair não recebe, e as inscrições
 *                          dele morrem na hora. Sair de uma camada é sair de
 *                          todas.
 *   2. janela do dia       nada sai antes das 8h nem depois das 20h de Londres.
 *                          E-mail de marketing às 3 da manhã é a definição de
 *                          disparo, e o provedor lê isso.
 *   3. um por dia          o mesmo endereço não recebe dois e-mails de
 *                          marketing em 20 horas, venha de qual sequência vier.
 *   4. interruptor         `MARKETING_LIFECYCLE=on` é o que liga o envio. Sem
 *                          ele a rota responde e não manda nada, então subir o
 *                          código nunca é o mesmo que começar a campanha.
 *
 * Tudo que sai daqui vira linha em `marketing_touches`: é assim que o painel e
 * o webhook do Resend enxergam o funil junto com as campanhas de mão.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { getSequence } from "@/lib/email-sequences/definitions";
import type { SequenceContext } from "@/lib/email-sequences/types";
import { bloqueados } from "@/lib/marketing/suppressions";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { funilLigado } from "@/lib/marketing/lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HOUR_MS = 60 * 60 * 1000;
const BATCH = 100; // inscrições processadas por volta

/** Janela de envio, em hora de Londres. Fora dela o passo espera. */
const ABRE = 8;
const FECHA = 20;

/** Intervalo mínimo entre dois e-mails de marketing para a mesma pessoa. */
const DESCANSO_HORAS = 20;

/** Comparação de segredo em tempo constante (igual à do daily-brief). */
function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A hora de Londres agora, que não é a do servidor (Vercel roda em UTC). */
function horaEmLondres(d = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(d),
  );
}

/** A próxima abertura da janela, para adiar em vez de mandar de madrugada. */
function proximaAbertura(d = new Date()): Date {
  const proximo = new Date(d.getTime());
  for (let i = 0; i < 48; i++) {
    proximo.setTime(proximo.getTime() + HOUR_MS);
    const h = horaEmLondres(proximo);
    if (h >= ABRE && h < FECHA) return proximo;
  }
  return new Date(d.getTime() + 12 * HOUR_MS);
}

type EnrollmentRow = {
  id: string;
  sequence_key: string;
  contact_email: string;
  contact_name: string | null;
  client_id: string | null;
  current_step: number;
  cycle: number;
  context: SequenceContext;
  enrolled_at: string;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /** `?dry-run=1` calcula tudo e não manda nada. É como se testa esta rota. */
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";

  // Trava 4: o interruptor. Desligado, só o ensaio passa.
  if (!funilLigado() && !ensaio) {
    return NextResponse.json({ ok: true, desligado: "MARKETING_LIFECYCLE != on" });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ ok: false, reason: "resend_not_configured" }, { status: 500 });
  }

  const admin = createServiceClient();
  const agora = new Date();
  const nowIso = agora.toISOString();

  const { data: due, error } = await admin
    .from("email_sequence_enrollments")
    .select("id, sequence_key, contact_email, contact_name, client_id, current_step, cycle, context, enrolled_at")
    .eq("status", "active")
    .lte("next_send_at", nowIso)
    .order("next_send_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const linhas = due as EnrollmentRow[];

  // Trava 2: fora da janela nada sai. Adia todo mundo e volta na próxima.
  const hora = horaEmLondres(agora);
  if (hora < ABRE || hora >= FECHA) {
    const quando = proximaAbertura(agora).toISOString();
    if (!ensaio) {
      await admin
        .from("email_sequence_enrollments")
        .update({ next_send_at: quando, updated_at: nowIso })
        .in("id", linhas.map((r) => r.id));
    }
    return NextResponse.json({ ok: true, processed: linhas.length, sent: 0, adiados: linhas.length, janela: `${ABRE}h-${FECHA}h Londres`, proximo: quando });
  }

  // Trava 1: a lista de bloqueio, numa consulta só para o lote inteiro.
  const barrados = await bloqueados(linhas.map((r) => r.contact_email));

  /**
   * Trava 3: quem já recebeu nas últimas 20 horas.
   *
   * Lê `marketing_touches`, que é onde TODO envio de marketing cai, o do funil
   * e o da campanha de mão. Se lesse só o log da sequência, uma campanha
   * manual no mesmo dia passaria por cima e a pessoa receberia dois.
   */
  const desde = new Date(agora.getTime() - DESCANSO_HORAS * HOUR_MS).toISOString();
  const { data: recentes } = await admin
    .from("marketing_touches")
    .select("email")
    .eq("channel", "email")
    .gte("sent_at", desde)
    .limit(5000);
  const descansando = new Set((recentes ?? []).map((r) => String(r.email ?? "").toLowerCase()).filter(Boolean));

  const resend = new Resend(resendKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <hello@getfixfy.com>";

  let sent = 0;
  let completed = 0;
  let skipped = 0;
  let bloqueadosAgora = 0;
  let adiadosPorDescanso = 0;
  const errors: string[] = [];

  for (const row of linhas) {
    const email = row.contact_email.trim().toLowerCase();

    if (barrados.has(email)) {
      // Não é "pular": é encerrar. Quem saiu não volta na próxima volta.
      if (!ensaio) {
        await admin
          .from("email_sequence_enrollments")
          .update({ status: "stopped", updated_at: new Date().toISOString() })
          .eq("contact_email", email)
          .eq("status", "active");
      }
      bloqueadosAgora++;
      continue;
    }

    if (descansando.has(email)) {
      if (!ensaio) {
        await admin
          .from("email_sequence_enrollments")
          .update({ next_send_at: new Date(agora.getTime() + DESCANSO_HORAS * HOUR_MS).toISOString(), updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      adiadosPorDescanso++;
      continue;
    }

    const seq = getSequence(row.sequence_key);
    if (!seq) {
      // Sequência que saiu do código: encosta a inscrição em vez de girar à toa.
      if (!ensaio) {
        await admin.from("email_sequence_enrollments")
          .update({ status: "stopped", updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      skipped++;
      continue;
    }

    const step = seq.steps[row.current_step];
    if (!step) {
      if (!ensaio) {
        await admin.from("email_sequence_enrollments")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      completed++;
      continue;
    }

    /**
     * O contexto que o template enxerga.
     *
     * `cycle` entra aqui de propósito: é ele que faz a peça mudar a cada volta
     * nas sequências que giram. Sem isso o clube mandaria o mesmo e-mail duas
     * vezes por semana para sempre.
     */
    const ctx: SequenceContext = {
      ...row.context,
      name: row.context?.name ?? row.contact_name ?? undefined,
      cycle: row.cycle,
      unsubscribeUrl: (row.context?.unsubscribeUrl as string) || unsubscribeUrl(email),
    };

    const assunto = step.subject(ctx);

    if (ensaio) {
      sent++;
      continue;
    }

    // Idempotência: reserva o par (inscrição, passo, ciclo) ANTES de mandar.
    const { error: claimErr } = await admin.from("email_sequence_sends").insert({
      enrollment_id: row.id,
      sequence_key: seq.key,
      step_key: step.key,
      step_index: row.current_step,
      cycle: row.cycle,
      contact_email: email,
      subject: assunto,
    });

    if (claimErr) {
      if (claimErr.code === "23505") {
        skipped++;
      } else {
        errors.push(`${row.id}: claim ${claimErr.message}`);
        continue;
      }
    } else {
      const unsubUrl = String(ctx.unsubscribeUrl);
      try {
        const { data: sendData, error: sendErr } = await resend.emails.send({
          from: fromEmail,
          to: [email],
          subject: assunto,
          html: step.html(ctx),
          // Saída em um clique (RFC 8058). É exigência para marketing no Reino
          // Unido e é o que faz o Gmail confiar no domínio.
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        if (sendErr) {
          // Solta a reserva para uma volta futura tentar de novo.
          await admin.from("email_sequence_sends")
            .delete()
            .eq("enrollment_id", row.id)
            .eq("step_index", row.current_step)
            .eq("cycle", row.cycle);
          errors.push(`${row.id}: resend ${sendErr.message}`);
          continue;
        }
        if (sendData?.id) {
          await admin.from("email_sequence_sends")
            .update({ resend_id: sendData.id })
            .eq("enrollment_id", row.id)
            .eq("step_index", row.current_step)
            .eq("cycle", row.cycle);
        }

        /**
         * O toque, na mesma tabela das campanhas de mão.
         *
         * Falhar aqui não desfaz o envio: o e-mail já saiu. Mas sem esta linha
         * o painel não vê o funil e a trava do descanso fica cega, então vale
         * gritar no log.
         */
        try {
          await admin.from("marketing_touches").insert({
            email,
            client_id: row.client_id,
            campaign: step.campanha ? step.campanha(ctx) : `${seq.key}:${step.key}`,
            channel: "email",
            subject: assunto,
            provider_id: sendData?.id ?? null,
          });
        } catch (err) {
          console.error(`[email-sequences] toque não registrado (${email}):`, err);
        }

        descansando.add(email); // o próximo da mesma pessoa, nesta volta, espera
        sent++;
      } catch (e) {
        await admin.from("email_sequence_sends")
          .delete()
          .eq("enrollment_id", row.id)
          .eq("step_index", row.current_step)
          .eq("cycle", row.cycle);
        errors.push(`${row.id}: ${e instanceof Error ? e.message : "send_failed"}`);
        continue;
      }
    }

    // Anda o passo.
    const nextStep = seq.steps[row.current_step + 1];
    const enrolledMs = new Date(row.enrolled_at).getTime();
    const patch: Record<string, unknown> = { last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    if (nextStep) {
      patch.current_step = row.current_step + 1;
      patch.next_send_at = new Date(enrolledMs + nextStep.offsetHours * HOUR_MS).toISOString();
    } else if (seq.recurring) {
      // Gira: volta ao passo zero, soma um ciclo, marca a próxima rodada.
      patch.current_step = 0;
      patch.cycle = row.cycle + 1;
      patch.next_send_at = new Date(Date.now() + (seq.recurEveryHours ?? 365 * 24) * HOUR_MS).toISOString();
    } else {
      patch.status = "completed";
      completed++;
    }

    await admin.from("email_sequence_enrollments").update(patch).eq("id", row.id);
  }

  return NextResponse.json({
    ok: true,
    ensaio: ensaio || undefined,
    processed: linhas.length,
    sent,
    completed,
    skipped,
    bloqueados: bloqueadosAgora,
    adiadosPorDescanso,
    errors: errors.length ? errors : undefined,
  });
}
