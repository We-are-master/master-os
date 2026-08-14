import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { autoAssignExpiresAtIso } from "@/lib/auto-assign-offer";
import { dispatchAutoAssignJobInvites } from "@/lib/auto-assign-job-invites";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { resolvePropertyPostcode } from "@/lib/uk-postcode";

/**
 * Job atribuído pela rota fixa e não confirmado vira leilão.
 *
 * A rota manda o job para o parceiro nomeado do serviço e pede confirmação. Ele
 * quase sempre aceita, porque há acordo de volume. Quando não aceita, o job
 * ficaria parado até alguém reparar, e "alguém reparar" é o custo que esta
 * automação existe para eliminar.
 *
 * Passado o prazo, o parceiro é solto e o job vai a leilão para todos os que
 * casam com o trade. Quem chegar primeiro leva. O que ninguém pegar continua
 * aparecendo como pendência, que é onde o dono entra: ele fala com o parceiro e
 * aloca à mão.
 *
 * O prazo é curto de propósito. Um job para depois de amanhã que espera
 * confirmação por meio dia perde o dia útil em que dava para remarcar.
 *
 *   GET /api/cron/escalate-unconfirmed-jobs[?dry-run=1]
 *   Authorization: Bearer $CRON_SECRET        (Vercel Cron)
 *   ou  X-API-Key: $MASTER_OS_JOB_WEBHOOK_API_KEY   (launchd, enquanto local)
 *
 * Aceita as duas porque o OS roda local hoje e vai para a nuvem depois:
 * `CRON_SECRET` só existe na Vercel, e a chave de webhook é a que o RPA e o
 * Alex já carregam. Sem uma das duas, 401.
 */

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const DEFAULT_HOURS = 4;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const apiKey = req.headers.get("x-api-key");
  const autorizado =
    secretsMatch(bearer, process.env.CRON_SECRET?.trim()) ||
    secretsMatch(apiKey, process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim());
  if (!autorizado) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const horas = Number(process.env.PARTNER_CONFIRM_TIMEOUT_HOURS) || DEFAULT_HOURS;
  const corte = new Date(Date.now() - horas * 3600_000).toISOString();
  const supabase = createServiceClient();

  // `?dry-run=1` lista quem seria escalado e para quem iria o convite, sem
  // escrever nem mandar email. Depois do JOB-9415 nenhuma rodada vai ao vivo
  // sem alguém ter olhado a lista antes.
  const dryRun = new URL(req.url).searchParams.get("dry-run") === "1";

  // Só job que a rota atribuiu e o parceiro não confirmou. `partner_id` cheio
  // com `partner_confirmed_at` vazio é exatamente essa situação: nós demos, ele
  // não pegou.
  const { data: parados, error } = await supabase
    .from("jobs")
    .select("id, reference, title, scope, client_name, property_address, scheduled_date, catalog_service_id, partner_id, external_ref, external_source, created_at")
    .not("partner_id", "is", null)
    .is("partner_confirmed_at", null)
    .eq("status", "scheduled")
    .lt("created_at", corte)
    .limit(50);

  if (error) {
    console.error("[escalate] leitura falhou:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resultados: Array<Record<string, unknown>> = [];

  for (const job of parados ?? []) {
    const anterior = job.partner_id as string;
    const convidados = await matchPartnerIdsForWork(supabase, {
      serviceType: String(job.title ?? ""),
      catalogServiceId: job.catalog_service_id as string | null,
      // jobs não tem coluna de postcode: ele vive dentro de property_address.
      postcode: resolvePropertyPostcode(null, String(job.property_address ?? "")),
      kind: "job",
      availabilitySlot: { scheduledDate: job.scheduled_date as string, startAt: null, endAt: null },
    });

    // Quem já teve a chance não entra no leilão de novo.
    const lista = convidados.filter((id) => id !== anterior);
    if (lista.length === 0) {
      resultados.push({ reference: job.reference, escalado: false, motivo: "sem_outro_parceiro" });
      continue;
    }

    if (dryRun) {
      resultados.push({
        reference: job.reference,
        escalado: false,
        motivo: "dry_run",
        soltaria: anterior,
        convidaria: lista.length,
      });
      continue;
    }

    // Solta o parceiro e abre o leilão. `partner_booked_email_sent_at` volta a
    // nulo para o vencedor poder receber o email de booking, que é enviado uma
    // vez por job.
    //
    // `partner_ids` tem que cair junto com `partner_id`. Foi o que quebrou o
    // JOB-9415: a escalada limpou só o singular, o gatilho da migração 166
    // disparou no status e chamou o sync do Zendesk, que roda
    // `stalePartnerBookedJobPatch`. Esse reparo vê parceiro no plural, conclui
    // que o job está agendado com parceiro e devolve `scheduled` limpando a
    // lista de convidados. O job voltava órfão: sem parceiro e sem leilão.
    const { error: upErr } = await supabase
      .from("jobs")
      .update({
        partner_id: null,
        partner_name: null,
        // Array vazio, não null: a coluna é `uuid[] NOT NULL DEFAULT '{}'`
        // (migração 050) e o resto do app escreve `[]`.
        partner_ids: [],
        status: "auto_assigning",
        auto_assign_invited_partner_ids: lista,
        auto_assign_expires_at: autoAssignExpiresAtIso(),
        partner_booked_email_sent_at: null,
      })
      .eq("id", job.id)
      .eq("partner_id", anterior)
      .is("partner_confirmed_at", null);

    if (upErr) {
      console.error("[escalate] update falhou:", job.reference, upErr.message);
      resultados.push({ reference: job.reference, escalado: false, motivo: upErr.message });
      continue;
    }

    try {
      await dispatchAutoAssignJobInvites({
        supabase,
        jobId: String(job.id),
        jobReference: String(job.reference),
        jobTitle: String(job.title ?? "Maintenance job"),
        clientName: String(job.client_name ?? "—"),
        propertyAddress: String(job.property_address ?? "—"),
        scope: String(job.scope ?? "(no scope provided)"),
        scheduledDate: String(job.scheduled_date ?? ""),
        partnerIds: lista,
        zendeskTicketId: job.external_source === "zendesk" ? (job.external_ref as string | null) : null,
      });
    } catch (err) {
      console.error("[escalate] convites falharam:", job.reference, err);
    }

    resultados.push({
      reference: job.reference,
      escalado: true,
      soltou: anterior,
      convidados: lista.length,
    });
  }

  const escalados = resultados.filter((r) => r.escalado).length;
  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    timeout_horas: horas,
    encontrados: parados?.length ?? 0,
    escalados,
    jobs: resultados,
  });
}
