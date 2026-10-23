/**
 * Conta B2B pedindo trabalho por hora (dono, 19-20/10/2026): "quando é B2B só aceita e já
 * joga no OS se for por hora"; "hourly segue sempre um preço interno, cada B2B tem o seu
 * rate"; "sempre lê o corpo do e-mail e pega o valor lá, porque às vezes tem extra, no
 * caso Housekeep por exemplo"; "se for hourly deixa em unassigned for now".
 *
 * Ordem do preço:
 *   1. o total escrito no e-mail (já com extras) → job de preço fechado nesse total;
 *   2. extras com preço no e-mail → horas × taxa + extras, preço fechado;
 *   3. senão → job por hora, na taxa escrita no e-mail ou, sem ela, na da conta
 *      (o /api/jobs resolve: account_service_prices → catálogo).
 * Sem nome do cliente e endereço com postcode o job não nasce: pede à conta.
 * O job nasce sempre sem parceiro (auto_assign false) e com data a confirmar se o
 * e-mail não deu dia e hora.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { chamarOpenAI } from "@/lib/openai-com-retry";
import { resolveAccountSell, accountAllowsBelowStandard } from "@/lib/catalog-pricing-floor-ceiling";
import { updateTicket, addTicketTags } from "@/lib/zendesk";
import { ZD_STATUS_UNASSIGNED } from "@/lib/zendesk-statuses";
import { precisaDeAcao } from "@/lib/fila-de-acao";
import { autorDoAviso } from "./aviso-de-cotacao";
import { conferirMensagem } from "@/lib/harvey/conferente";
import type { Classificacao } from "@/lib/classificar-pedido";
import type { ModoDeAutonomia } from "@/lib/harvey/autonomia";

/** Já tratamos este ticket como B2B por hora (job criado ou pedido de dados feito). */
export const TAG_B2B_HORA = "harvey_b2b_hourly";
export const TAG_B2B_HORA_FALTA = "harvey_b2b_hourly_missing";

export type ValorDoEmail = {
  totalGbp: number | null;
  taxaHoraGbp: number | null;
  horas: number | null;
  extras: Array<{ item: string; gbp: number }>;
  nomeDoCliente: string | null;
  telefone: string | null;
  endereco: string | null;
  postcode: string | null;
  data: string | null;
  janela: string | null;
};

export type DecisaoDePreco =
  | { modo: "fixo"; total: number; linhas: string[] }
  | { modo: "hora"; taxa: number | null; horas: number | null; linhas: string[] }
  | { modo: "ajuda"; motivo: string };

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v.replace(/[£,\s]/g, "")) : Number(v);
  return v != null && v !== "" && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null;
};
const libras = (v: number) => `£${v % 1 === 0 ? v : v.toFixed(2)}`;

/** A decisão de preço, pura (testada): o que o e-mail escreveu vence a tabela. */
export function decidirPrecoHoraB2B(v: ValorDoEmail, taxaDaConta: number | null, horasDoPedido: number | null): DecisaoDePreco {
  const extras = v.extras.filter((e) => e.gbp > 0);
  const somaExtras = extras.reduce((s, e) => s + e.gbp, 0);
  const horas = v.horas ?? horasDoPedido;
  const taxa = v.taxaHoraGbp ?? taxaDaConta;
  const linhaExtras = extras.map((e) => `${e.item}: ${libras(e.gbp)}`);

  if (v.totalGbp) {
    return { modo: "fixo", total: v.totalGbp, linhas: [`Total stated in the email: ${libras(v.totalGbp)}`, ...linhaExtras] };
  }
  if (somaExtras > 0) {
    if (!horas || !taxa) return { modo: "ajuda", motivo: `the email lists priced extras (${linhaExtras.join(", ")}) but not the hours, so I can't build the total` };
    const total = Math.round((horas * taxa + somaExtras) * 100) / 100;
    return {
      modo: "fixo",
      total,
      linhas: [`${horas}h × ${libras(taxa)}/h${v.taxaHoraGbp ? " (rate in the email)" : " (account rate)"} = ${libras(horas * taxa)}`, ...linhaExtras, `Total: ${libras(total)}`],
    };
  }
  if (!taxa) return { modo: "ajuda", motivo: "this account has no hourly rate for this service and the email doesn't state one" };
  return {
    modo: "hora",
    taxa: v.taxaHoraGbp,
    horas,
    linhas: [`${libras(taxa)}/h${v.taxaHoraGbp ? " (rate in the email)" : " (account rate)"}${horas ? `, about ${horas}h` : ""}`],
  };
}

/** Lê do corpo do e-mail o que a conta escreveu: valor, extras, cliente, endereço, dia. */
export async function lerValorDoEmail(texto: string, apiKey: string): Promise<ValorDoEmail> {
  const r = await chamarOpenAI("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You read an email from a business client asking us to book work. Extract ONLY what is written; anything absent is null. Reply strict JSON:
{"total_gbp":num|null,"hourly_rate_gbp":num|null,"hours":num|null,"extras":[{"item":str,"gbp":num}],"customer_name":str|null,"customer_phone":str|null,"property_address":str|null,"postcode":str|null,"date":"YYYY-MM-DD"|null,"arrival_window":"HH:MM - HH:MM"|null}
- total_gbp: the total price the client states for this job (including extras), never a sum you compute.
- hourly_rate_gbp: a per-hour price written in the email.
- hours: booked length in hours ("half day" = 3.5, "full day" = 7).
- extras: add-ons with their own price (e.g. "oven clean £30", "parking £15"); no price, leave it out.
- customer_name: the tenant or resident the job is for (not the sender, not the company).
- date only when a specific day is written; arrival_window only when a time is written.`,
        },
        { role: "user", content: texto.slice(0, 12_000) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const j = JSON.parse(((await r.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return {
    totalGbp: n(j.total_gbp),
    taxaHoraGbp: n(j.hourly_rate_gbp),
    horas: n(j.hours),
    extras: (Array.isArray(j.extras) ? j.extras : [])
      .map((e) => ({ item: s((e as Record<string, unknown>)?.item) ?? "Extra", gbp: n((e as Record<string, unknown>)?.gbp) ?? 0 }))
      .filter((e) => e.gbp > 0),
    nomeDoCliente: s(j.customer_name),
    telefone: s(j.customer_phone),
    endereco: s(j.property_address),
    postcode: s(j.postcode),
    data: typeof j.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : null,
    janela: s(j.arrival_window),
  };
}

/** A taxa por hora da conta para o serviço, pela mesma regra do /api/jobs (piso do catálogo). */
export async function taxaPorHoraDaConta(accountId: string, catalogServiceId: string | null): Promise<number | null> {
  if (!catalogServiceId) return null;
  const sb = createServiceClient();
  const [{ data: cat }, { data: ov }] = await Promise.all([
    sb.from("service_catalog").select("hourly_rate").eq("id", catalogServiceId).maybeSingle(),
    sb
      .from("account_service_prices")
      .select("use_standard, hourly_rate, allow_below_standard")
      .eq("account_id", accountId)
      .eq("catalog_service_id", catalogServiceId)
      .maybeSingle(),
  ]);
  const piso = Number(cat?.hourly_rate) || 0;
  const conta = ov && !ov.use_standard && ov.hourly_rate != null ? Number(ov.hourly_rate) : null;
  const taxa = resolveAccountSell(piso, conta, accountAllowsBelowStandard(ov));
  return taxa > 0 ? taxa : null;
}

const primeiroNome = (nome: string | null) => (nome ?? "").trim().split(/\s+/)[0] || "there";
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = (t: string) => `<p>${esc(t).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
/** Conferente (B4) antes de toda resposta à conta: travessão vira vírgula; problema sério segura. */
function conferido(t: string): string {
  const c = conferirMensagem(t, { publico: "cliente" });
  if (!c.ok) throw new Error(`checker blocked the reply: ${c.problemas.join("; ")}`);
  return c.texto;
}

/**
 * O braço B2B por hora do quoter. Devolve a nota interna; age só com o modo "on".
 * Quem chama já decidiu: conta reconhecida, não é cliente direto, pedido "hora".
 */
export async function aceitarHoraB2B(args: {
  ticketId: number;
  tags: string[];
  texto: string;
  remetente: string | null;
  conta: { id: string; nome: string };
  classe: Classificacao;
  escopo: string;
  enderecoDoPedido: string | null;
  postcodeDoPedido: string | null;
  modo: ModoDeAutonomia;
  postar: boolean;
  apiKey: string;
}): Promise<string> {
  const titulo = "── B2B hourly ──";
  if (args.tags.includes(TAG_B2B_HORA)) return `${titulo}\nAlready handled on this ticket.`;
  if (args.tags.includes("harvey_off")) return `${titulo}\nharvey_off: the team handles this ticket.`;

  const v = await lerValorDoEmail(args.texto, args.apiKey);
  v.endereco ??= args.enderecoDoPedido;
  v.postcode ??= args.postcodeDoPedido;
  const taxaDaConta = await taxaPorHoraDaConta(args.conta.id, args.classe.catalogServiceId).catch(() => null);
  const preco = decidirPrecoHoraB2B(v, taxaDaConta, args.classe.horasEstimadas);
  const faltas = [!v.nomeDoCliente && "the resident's full name", !(v.endereco && v.postcode) && "the full address with postcode"].filter(Boolean) as string[];

  const resumo = [
    `${args.conta.nome} · ${args.classe.tipo} · ${args.classe.motivo}`,
    preco.modo === "ajuda" ? `Price: needs a person (${preco.motivo})` : `Price: ${preco.linhas.join(" · ")}`,
    `Client: ${v.nomeDoCliente ?? "?"} · ${v.endereco ?? "?"} ${v.postcode ?? ""}`.trim(),
    `Date: ${v.data ? `${v.data}${v.janela ? ` ${v.janela}` : ""}` : "to be confirmed"} · Partner: unassigned (team picks)`,
  ];

  if (args.modo !== "on" || !args.postar) {
    const faria =
      preco.modo === "ajuda" ? "pass to the team" : faltas.length ? `ask ${args.conta.nome} for ${faltas.join(" and ")}` : "create the job and confirm to the client";
    return `${titulo} (DRY RUN, nothing sent)\nI would ${faria}.\n${resumo.join("\n")}`;
  }

  if (preco.modo === "ajuda") {
    await precisaDeAcao(args.ticketId, `B2B hourly: ${preco.motivo}`).catch(() => null);
    return `${titulo}\nPassed to the team: ${preco.motivo}.\n${resumo.join("\n")}`;
  }

  if (faltas.length) {
    if (!args.tags.includes(TAG_B2B_HORA_FALTA)) {
      await updateTicket({
        ticketId: args.ticketId,
        htmlBody: html(conferido(
          `Hi ${primeiroNome(args.remetente)},\n\nThanks, we can book this in. To confirm it, could you send ${faltas.join(" and ")}, and a contact number for access?\n\nKind regards,\nFixfy Team`,
        )),
        publicComment: true,
        authorId: await autorDoAviso(),
        additionalTags: [TAG_B2B_HORA_FALTA],
      });
    }
    return `${titulo}\nAsked ${args.conta.nome} for ${faltas.join(" and ")}.\n${resumo.join("\n")}`;
  }

  const base = process.env.MASTER_OS_BASE_URL?.trim() || "http://localhost:3000";
  const comData = !!(v.data && v.janela);
  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.MASTER_OS_JOB_WEBHOOK_API_KEY ?? "" },
    body: JSON.stringify({
      account_id: args.conta.id,
      ticket_id: String(args.ticketId),
      client_name: v.nomeDoCliente,
      client_phone: v.telefone ?? undefined,
      property_address: v.endereco,
      postcode: v.postcode,
      title: args.classe.tipo,
      service_type: args.classe.tipo,
      catalog_service_id: args.classe.catalogServiceId ?? undefined,
      description: args.escopo,
      ...(comData ? { date: v.data, arrival_time: v.janela } : { date_tbc: true }),
      ...(preco.modo === "fixo"
        ? { rate_type: "fixed", client_price: preco.total }
        : { rate_type: "hourly", hourly_client_rate: preco.taxa ?? undefined, billed_hours: preco.horas ?? undefined }),
      auto_assign: false,
      internal_notes: `Booked by Harvey from the ${args.conta.nome} email. ${preco.linhas.join(" · ")}`,
    }),
  });
  const job = (await res.json().catch(() => ({}))) as { reference?: string; error?: string };
  if (!res.ok || !job.reference) {
    await precisaDeAcao(args.ticketId, `B2B hourly: job not created (${job.error ?? res.status})`).catch(() => null);
    return `${titulo}\nJob NOT created: ${job.error ?? res.status}. Passed to the team.\n${resumo.join("\n")}`;
  }

  const comoPreco =
    preco.modo === "fixo"
      ? `at ${libras(preco.total)} as per your email`
      : `at your agreed rate of ${libras(preco.taxa ?? taxaDaConta ?? 0)} per hour${preco.horas ? `, about ${preco.horas} hours` : ""}`;
  const quando = comData ? `for ${v.data} (${v.janela})` : "and we'll confirm the day and arrival time shortly";
  await updateTicket({
    ticketId: args.ticketId,
    customStatusId: ZD_STATUS_UNASSIGNED,
    htmlBody: html(conferido(
      `Hi ${primeiroNome(args.remetente)},\n\nThanks, this is booked in ${comoPreco}, ${quando}. We'll let you know who is attending.\n\nJob reference: ${job.reference}\n\nKind regards,\nFixfy Team`,
    )),
    publicComment: true,
    authorId: await autorDoAviso(),
    additionalTags: [TAG_B2B_HORA],
  });
  await addTicketTags(args.ticketId, [TAG_B2B_HORA]).catch(() => null);
  return `${titulo}\nCreated ${job.reference} (unassigned) and confirmed to ${args.conta.nome}.\n${resumo.join("\n")}`;
}

/** O e-mail pede cotação ("quote", "quotation", "estimate")? Aí é cotação, nunca por hora. */
export function pedeCotacao(texto: string | null | undefined): boolean {
  return /\b(quot(e|es|ation|ing)|estimates?)\b/i.test(String(texto ?? ""));
}
