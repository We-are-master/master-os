/**
 * Simulação ponta a ponta de uma quote, com o código de verdade.
 *
 * Cada etapa chama a função que roda em produção. Nada é inventado e nada é
 * enviado: as etapas que escrevem estão desligadas, e as que só leem leem o
 * banco e o Zendesk reais. Onde o Harvey não pode agir hoje, a etapa diz por
 * quê em vez de fingir que agiu.
 *
 *   npx tsx scripts/harvey/run-simulacao-quote.ts 50156
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const arquivo of [".env.local", ".env"]) {
  try {
    for (const linha of readFileSync(join(process.cwd(), arquivo), "utf8").split("\n")) {
      const m = linha.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
    }
  } catch { /* pode não existir */ }
}

const TICKET = Number(process.argv[2] ?? 50156);
/** Só com --postar a nota sai de verdade. Sem a flag, nada é escrito. */
const POSTAR = process.argv.includes("--postar");
const L = (s = "") => console.log(s);
const etapa = (n: number, t: string) => L(`\n${"─".repeat(72)}\n${n}. ${t}\n${"─".repeat(72)}`);
const ok = (s: string) => L(`  ✔ ${s}`);
const nao = (s: string) => L(`  ✖ ${s}`);
const mao = (s: string) => L(`  ✋ ${s}`);
const libras = (v: number) => `£${v.toFixed(2)}`;

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/service");
  const sb = createServiceClient();
  L(`\nSIMULAÇÃO · ticket #${TICKET} · ${new Date().toISOString()}`);

  // 1 ── CHEGADA
  etapa(1, "CHEGADA — o Harvey lê o ticket inteiro");
  const { lerTicketCompleto } = await import("../../src/lib/zendesk-quoter/quoter");
  const t = await lerTicketCompleto(TICKET);
  ok(`assunto: "${t.subject}"`);
  ok(`remetente: ${t.requesterEmail ?? "?"}`);
  ok(`${t.imagens.length} imagem(ns) baixadas de ${t.totalAnexos} anexo(s) + links do corpo`);
  ok(`thread ${t.thread.length} chars · só o novo: ${t.threadNova.length} chars`);

  // 2 ── TRIAGEM
  etapa(2, "TRIAGEM — que espécie de ticket é este (pura, sem modelo)");
  const { triarTicket, ACAO_POR_CLASSE, ROTULO_DA_CLASSE } = await import("../../src/lib/zendesk-triage");
  const tri = triarTicket({ subject: t.subject, description: t.threadNova || t.thread, tags: [] });
  ok(`classe: ${tri.classe} (${ROTULO_DA_CLASSE[tri.classe]}) → ação "${ACAO_POR_CLASSE[tri.classe]}"`);

  // 3 ── ORGANIZAÇÃO
  etapa(3, "ORGANIZAÇÃO — de quem é este trabalho, provado pelo domínio");
  const { organizacaoDoTicket } = await import("../../src/lib/organizacoes/do-ticket");
  const org = await organizacaoDoTicket(t, sb);
  if (org.ok) ok(`reconhecida: ${org.nome} (${org.dominio})`);
  else nao(`NÃO reconhecida. Sem isto ele cria a quote mas NÃO convida ninguém.`);

  // 4 ── COTAÇÃO
  etapa(4, "COTAÇÃO — preço a partir do pricebook, com visão nas fotos");
  const chave = process.env.OPENAI_API_KEY?.trim();
  let creditoOk = false;
  if (chave) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "1" }], max_tokens: 1 }),
    });
    creditoOk = res.ok;
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      nao(`BLOQUEADO: ${j.error?.code ?? res.status} — ${j.error?.message?.slice(0, 80) ?? ""}`);
    }
  }
  if (creditoOk) ok("crédito ok: o Harvey cotaria agora e criaria a quote no OS");
  else L(`  → uso o resultado REAL desta etapa, já gravado no banco:`);

  const { data: q } = await sb
    .from("quotes")
    .select("id, reference, title, service_type, scope, property_address, postcode, total_value, partner_cost, status, created_at, catalog_service_id")
    .eq("external_ref", String(TICKET))
    .maybeSingle();
  if (!q) { nao("nenhuma quote deste ticket no banco. Fim da simulação."); return; }
  const quote = q as Record<string, unknown> as {
    id: string; reference: string; title: string | null; service_type: string | null;
    scope: string | null; property_address: string | null; postcode: string | null;
    total_value: number | null; partner_cost: number | null; status: string; catalog_service_id: string | null;
  };
  ok(`quote ${quote.reference} · ${quote.service_type ?? quote.title} · ${quote.property_address}`);

  // 5 ── CONVITE
  etapa(5, "CONVITE — quem cobre este trabalho neste postcode");
  const { matchPartnerIdsForWork } = await import("../../src/lib/partner-work-matching");
  const { extractUkPostcode } = await import("../../src/lib/uk-postcode");
  const pc = extractUkPostcode(quote.property_address ?? "") ?? quote.postcode ?? "";
  const ids = await matchPartnerIdsForWork(sb, {
    serviceType: quote.service_type ?? quote.title ?? "",
    catalogServiceId: quote.catalog_service_id, postcode: pc, kind: "lead",
  });
  const { data: ps } = await sb.from("partners").select("company_name, contact_name").in("id", ids.length ? ids : ["-"]);
  ok(`${ids.length} parceiro(s) casam "${quote.service_type ?? quote.title}" em ${pc}:`);
  for (const p of (ps ?? []) as Array<{ company_name?: string; contact_name?: string }>)
    L(`      · ${p.company_name?.trim() || p.contact_name?.trim()}`);
  L(`  ${process.env.HARVEY_QUOTE_INVITES === "1" ? "✔ portão ABERTO: o e-mail sai sozinho" : "✋ portão fechado: só listaria"}`);

  // 6 ── O QUE O PARCEIRO VÊ
  etapa(6, "O QUE O PARCEIRO VÊ — depois do filtro da conta");
  const { quoteParaParceiro, nomesDeContas } = await import("../../src/lib/quote-para-parceiro");
  const seguro = quoteParaParceiro(quote, { scope: quote.scope, nomesProibidos: await nomesDeContas(sb) });
  L(`      Client       : "${seguro.clientName}"`);
  L(`      Type of Work : "${seguro.typeOfWork}"`);
  L(`      Address      : "${quote.property_address}"`);
  L(`      Scope        : "${(seguro.scope || "").split("\n")[0]?.slice(0, 60) ?? ""}..."`);

  // 7 ── LEILÃO
  etapa(7, "LEILÃO — 2h do primeiro convite, depois o melhor lance");
  const { data: convites } = await sb.from("quote_partner_invitations").select("invited_at").eq("quote_id", quote.id).order("invited_at").limit(1);
  const primeiro = (convites ?? [])[0] as { invited_at?: string } | undefined;
  const { data: lances } = await sb.from("quote_bids").select("id, partner_id, partner_name, bid_amount, status, created_at, notes").eq("quote_id", quote.id);
  if (primeiro?.invited_at) {
    const h = (Date.now() - new Date(primeiro.invited_at).getTime()) / 36e5;
    ok(`primeiro convite ${h.toFixed(1)}h atrás → janela ${h >= 2 ? "FECHADA" : "ABERTA, ele espera"}`);
  } else nao("nenhum convite registrado");
  const { escolherMelhorLance } = await import("../../src/lib/quote-melhor-lance");
  const e = escolherMelhorLance((lances ?? []) as never);
  if (!e) { nao(`${(lances ?? []).length} lance(s), nenhum válido — sem rascunho`); }
  else {
    ok(`${e.ordenados.length} lance(s) válido(s). Menor: ${libras(e.melhor.valor)} de ${e.melhor.partner_name}`);
    ok(`margem ${e.margem}% → cliente ${libras(e.precoAoCliente)}`);
    if (quote.total_value) L(`      (o OS já gravou ${libras(Number(quote.total_value))} — ${Number(quote.total_value) === e.precoAoCliente ? "MESMO número" : "DIVERGE"})`);
  }

  // 8 ── O RASCUNHO
  etapa(8, "O RASCUNHO — a nota interna no ticket que recebeu o pedido");
  if (!e) nao("sem lance válido, não há rascunho");
  else {
    const { rascunhoDaQuote } = await import("../../src/lib/quote-lances-sweep");
    const nota = await rascunhoDaQuote(quote, e);
    L(nota.split("\n").map((l) => `  │ ${l}`).join("\n"));
    if (POSTAR) {
      const { postarNotaInterna } = await import("../../src/lib/zendesk-quoter/quoter");
      await postarNotaInterna(TICKET, nota);
      ok(`POSTADO como comentário INTERNO no #${TICKET}`);
    } else {
      mao(`nada postado. Use --postar para escrever no #${TICKET}`);
    }
  }

  // 9 ── O QUE FALTA
  etapa(9, "O QUE AINDA É MÃO HUMANA");
  mao("clicar enviar no rascunho (por desenho seu, até validar)");
  mao("aplicar o lance na quote no OS (Harvey não escreve na quote)");
  if (!creditoOk) mao("recarregar o crédito da OpenAI: sem ele a etapa 4 não roda");
  if (process.env.HARVEY_RASCUNHO_LANCE !== "1") mao("HARVEY_RASCUNHO_LANCE=1 para o rascunho sair de verdade");
  L();
}

main().catch((err) => { console.error("simulação morreu:", err); process.exit(1); });
