/**
 * Porta do site para os leads de reserva.
 *
 *   POST { event: "step", email, name, phone, postcode, step, selection,
 *          serviceLabel, price, resumeUrl, source, marketingOptOut }
 *   POST { event: "paid", email, jobId, bookingRef, total, promoCode }
 *   POST { event: "funnel", visitId, step, services, utm, landing }  (anônimo, 301)
 *
 * Mesma chave do /api/contacts/ingest (X-API-Key com a chave de lead ou de
 * job), porque quem chama é o mesmo servidor do site.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiKeyAllowed } from "@/lib/contacts-ingest";
import { registrarPagamento, registrarPasso } from "@/lib/site-leads/core";
import { registrarFunil } from "@/lib/site-leads/funil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const keys = [process.env.MASTER_OS_LEAD_WEBHOOK_API_KEY, process.env.MASTER_OS_JOB_WEBHOOK_API_KEY];
  if (!keys.some((k) => k?.trim())) {
    return NextResponse.json({ error: "MASTER_OS_LEAD_WEBHOOK_API_KEY not configured." }, { status: 500 });
  }
  if (!apiKeyAllowed(req.headers.get("x-api-key"), keys)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.event === "funnel") {
    const r = await registrarFunil(body);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.event === "paid") {
    const r = await registrarPagamento({
      email: String(body.email ?? ""),
      jobId: typeof body.jobId === "string" ? body.jobId : null,
      bookingRef: typeof body.bookingRef === "string" ? body.bookingRef : null,
      total: typeof body.total === "number" ? body.total : null,
      promoCode: typeof body.promoCode === "string" ? body.promoCode : null,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (body.event === "step") {
    const r = await registrarPasso({
      email: String(body.email ?? ""),
      name: typeof body.name === "string" ? body.name : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      postcode: typeof body.postcode === "string" ? body.postcode : null,
      step: Number(body.step ?? 1),
      selection: body.selection && typeof body.selection === "object" ? (body.selection as Record<string, unknown>) : undefined,
      serviceLabel: typeof body.serviceLabel === "string" ? body.serviceLabel : null,
      price: typeof body.price === "number" ? body.price : null,
      resumeUrl: typeof body.resumeUrl === "string" ? body.resumeUrl : null,
      source: body.source && typeof body.source === "object" ? (body.source as Record<string, unknown>) : undefined,
      marketingOptOut: Boolean(body.marketingOptOut),
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "event must be step or paid" }, { status: 400 });
}
