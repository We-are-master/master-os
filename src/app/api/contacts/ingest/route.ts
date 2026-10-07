/**
 * Ingestão de contatos: find-or-create em `clients`.
 *
 *   POST /api/contacts/ingest
 *   X-API-Key: MASTER_OS_LEAD_WEBHOOK_API_KEY (ou MASTER_OS_JOB_WEBHOOK_API_KEY)
 *   { account_id, contacts: [{ name, email, phone, postcode, address, notes, marketing_opt_out }] }
 *   → { created, updated, skipped, results: [{ id, action }] }
 *
 * Quem chama é o RPA do Checkatrade, por dois caminhos: o lead (uma pessoa que
 * perguntou, não um job) e o Express job aceito, que enriquece a linha do
 * cliente com o postcode que `POST /api/jobs` não guarda.
 *
 * Desde 23/09/2026 também o site B2C: nome e e-mail de quem começou a reservar,
 * na conta Fixfy, com a chave de job que ele já usa. `marketing_opt_out` ("Don't
 * email me offers") vira a etiqueta `no-marketing`, que o pós-venda respeita.
 *
 * Reconstruída em 2026-08-11. A rota não estava no repositório, e nada no git
 * mostra que já esteve: era arquivo não rastreado e sumiu. O efeito passou
 * despercebido porque o RPA loga o erro do lote e segue, então o board dizia
 * "1 lead(s) this pass" a cada ciclo enquanto o POST devolvia o 404 do Next.
 * Oito dias de leads pagos evaporaram assim, e o sintoma visível foi só o
 * `clients` parar de crescer.
 *
 * Regra que governa o upsert: **enriquecer, nunca empobrecer.** Um lead do
 * Checkatrade chega só com postcode ("London, SE5 8HY"), sem rua. Se ele
 * sobrescrevesse o endereço completo de um cliente que já comprou, a próxima
 * visita de parceiro sairia com endereço pior do que já tínhamos. Por isso
 * cada campo só é preenchido quando está vazio no banco.
 */

import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { apiKeyAllowed, tagsAfterOptOut } from "@/lib/contacts-ingest";
import { ajustesDoHarvey, janelaAberta } from "@/lib/harvey-wa/ajustes";
import type { CatalogService } from "@/types/database";
import { decidirLead, mandarPrimeiroContato, registrarLeadNoOs, templateDoLeadConfigurado, type LinhaDeCliente } from "@/lib/harvey-wa/primeiro-contato";

type ContactPayload = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  postcode?: string | null;
  address?: string | null;
  notes?: string | null;
  /** Site B2C: "Don't email me offers" marcado. Vira a etiqueta `no-marketing`. */
  marketing_opt_out?: boolean | null;
};

/** "+44 7712 345678" e "07712345678" são a mesma pessoa. Compara só os dígitos. */
function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  // Último 9 dígitos: absorve 0 inicial, +44 e 0044 sem tratar cada caso.
  return d.slice(-9);
}

/** Marcador `checkatrade-lead:<id>`. É o que responde "já temos este lead?". */
function leadMarker(notes: string | null | undefined): string | null {
  const m = (notes ?? "").match(/checkatrade-lead:\s*(\S+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  // Chave de lead (RPA do Checkatrade) ou de job (site B2C, lead do primeiro passo da reserva).
  const keys = [process.env.MASTER_OS_LEAD_WEBHOOK_API_KEY, process.env.MASTER_OS_JOB_WEBHOOK_API_KEY];
  if (!keys.some((k) => k?.trim())) {
    return NextResponse.json({ error: "MASTER_OS_LEAD_WEBHOOK_API_KEY not configured." }, { status: 500 });
  }
  if (!apiKeyAllowed(req.headers.get("x-api-key"), keys)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { account_id?: string; contacts?: ContactPayload[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  if (!contacts.length) {
    return NextResponse.json({ error: "contacts must be a non-empty array." }, { status: 400 });
  }

  const sb = createServiceClient();
  const results: { id: string; action: "created" | "updated" | "skipped" }[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const erros: string[] = [];

  for (const c of contacts) {
    const marker = leadMarker(c.notes);
    const key = phoneKey(c.phone);
    const email = (c.email ?? "").trim().toLowerCase() || null;

    // Sem nenhuma âncora não dá para deduplicar, e um contato sem telefone nem
    // email também não dá para contatar. Conta como skipped em vez de virar
    // linha órfã que ninguém alcança.
    if (!marker && !key && !email) {
      skipped++;
      results.push({ id: "", action: "skipped" });
      continue;
    }

    // Ordem de busca do mais forte para o mais fraco: o marcador identifica o
    // lead exato, o telefone identifica a pessoa, o email identifica a caixa.
    let existing: Record<string, unknown> | null = null;

    if (marker) {
      const { data } = await sb
        .from("clients")
        .select("id,full_name,email,phone,address,postcode,notes,tags")
        .ilike("notes", `%checkatrade-lead:${marker}%`)
        .is("deleted_at", null)
        .limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing && key) {
      const { data } = await sb
        .from("clients")
        .select("id,full_name,email,phone,address,postcode,notes,tags")
        .ilike("phone", `%${key}`)
        .is("deleted_at", null)
        .limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing && email) {
      const { data } = await sb
        .from("clients")
        .select("id,full_name,email,phone,address,postcode,notes,tags")
        .ilike("email", email)
        .is("deleted_at", null)
        .limit(1);
      existing = data?.[0] ?? null;
    }

    if (!existing) {
      const { data, error } = await sb
        .from("clients")
        .insert({
          full_name: (c.name ?? "").trim() || "Checkatrade lead",
          email,
          phone: (c.phone ?? "").trim() || null,
          address: (c.address ?? "").trim() || null,
          postcode: (c.postcode ?? "").trim() || null,
          notes: c.notes ?? null,
          // Conferidos contra os check constraints em 2026-08-11: `individual`
          // e `checkatrade` são recusados. O domínio de client_type é
          // `residential`; o de source aceita `direct`, e a procedência real
          // fica no marcador `checkatrade-lead:` das notas, que é o que o
          // dispatcher e o poller já usam para identificar estes leads.
          client_type: "residential",
          source: "direct",
          status: "active",
          ...(body.account_id ? { source_account_id: body.account_id } : {}),
          ...(c.marketing_opt_out ? { tags: tagsAfterOptOut([], true) } : {}),
        })
        .select("id")
        .single();

      if (error) {
        // Uma linha ruim não pode derrubar o lote: o RPA reenfileira o lote
        // inteiro quando a resposta não é 2xx, e um contato malformado ficaria
        // reenviando para sempre, bloqueando os bons atrás dele. Mas o erro vai
        // para o log e para a resposta: engolir em silêncio é exatamente como
        // oito dias de leads pagos sumiram sem ninguém ver.
        console.error(`[contacts/ingest] insert falhou: ${error.message}`);
        erros.push(error.message);
        skipped++;
        results.push({ id: "", action: "skipped" });
        continue;
      }
      created++;
      results.push({ id: data.id as string, action: "created" });
      continue;
    }

    // Enriquecer, nunca empobrecer: só escreve onde está vazio.
    const patch: Record<string, unknown> = {};
    const fill = (col: string, valor: string | null | undefined) => {
      const v = (valor ?? "").trim();
      if (v && !String(existing![col] ?? "").trim()) patch[col] = v;
    };
    fill("full_name", c.name);
    fill("email", email);
    fill("phone", c.phone);
    fill("address", c.address);
    fill("postcode", c.postcode);
    const tags = tagsAfterOptOut(existing.tags, c.marketing_opt_out);
    if (tags) patch.tags = tags;

    // Notas são acumuladas, não substituídas: cada enquiry é um fato novo sobre
    // a mesma pessoa, e o marcador de um lead antigo tem que sobreviver para o
    // dedupe continuar funcionando.
    const notasNovas = (c.notes ?? "").trim();
    const notasAtuais = String(existing.notes ?? "");
    if (notasNovas && !notasAtuais.includes(notasNovas)) {
      patch.notes = notasAtuais ? `${notasAtuais}\n\n${notasNovas}` : notasNovas;
    }

    if (!Object.keys(patch).length) {
      skipped++;
      results.push({ id: existing.id as string, action: "skipped" });
      continue;
    }

    const { error } = await sb.from("clients").update(patch).eq("id", existing.id as string);
    if (error) {
      console.error(`[contacts/ingest] update falhou: ${error.message}`);
      erros.push(error.message);
      skipped++;
      results.push({ id: existing.id as string, action: "skipped" });
      continue;
    }
    updated++;
    results.push({ id: existing.id as string, action: "updated" });
  }

  // ── despacho imediato ─────────────────────────────────────────────────────
  // Só para os CRIADOS, e depois de a resposta estar montada. O RPA chama esta
  // rota no instante em que marca "I'm interested" no Checkatrade, e é o que
  // derruba o tempo até o primeiro contato de vinte minutos para segundos: um
  // lead abordado enquanto ainda está com o problema na cabeça responde muito
  // mais que o mesmo lead vinte minutos depois.
  //
  // Nada aqui pode alterar o status devolvido. Se o despacho falhar, o contato
  // continua gravado e o `scripts/harvey-wa/leads-checkatrade.mts` o pega na varredura seguinte, que
  // é justamente por que o lote continua existindo.
  const novos = results.filter((r) => r.action === "created").map((r) => r.id);
  // O primeiro contato sai pelo WhatsApp do Zendesk, como mensagem do Harvey
  // (o respond.io saiu do ar). Desligado até HARVEY_WA_LEADS_ON_INGEST=1.
  if (novos.length && process.env.HARVEY_WA_LEADS_ON_INGEST === "1" && templateDoLeadConfigurado()) {
    void contatarPeloHarvey(novos, body.account_id ?? null).catch((e) => console.error(`[contacts/ingest] harvey: ${String(e).slice(0, 160)}`));
  }

  return NextResponse.json(
    { created, updated, skipped, results, ...(erros.length ? { errors: erros.slice(0, 5) } : {}) },
    { status: 200 },
  );
}

/** Primeiro contato do Harvey para os leads recém-criados (template pelo Zendesk). */
async function contatarPeloHarvey(ids: string[], contaId: string | null) {
  const sb = createServiceClient();
  const { data: catRows } = await sb.from("service_catalog").select("*").is("deleted_at", null).eq("is_active", true);
  const catalogo = (catRows ?? []) as CatalogService[];
  const { data: rows } = await sb.from("clients").select("id,full_name,email,phone,postcode,address,notes").in("id", ids);
  // O lead entra na página Leads na hora, a qualquer hora (sem publicar aos parceiros).
  for (const r of (rows ?? []) as LinhaDeCliente[]) {
    await registrarLeadNoOs(sb, r, catalogo, contaId).catch((e) => console.error(`[contacts/ingest] lead ${r.id}: ${String(e).slice(0, 160)}`));
  }
  // Janela dos templates: ajuste na tela /agents/harvey (padrão 8h-20h). Fora dela o lote pega depois.
  if (!janelaAberta(await ajustesDoHarvey())) return;
  for (const r of (rows ?? []) as LinhaDeCliente[]) {
    const d = decidirLead(r, catalogo);
    if (d.kind === "pular") continue;
    const res = await mandarPrimeiroContato(sb, d.contato);
    console.log(`[contacts/ingest] harvey ${d.contato.nome}: ${res.kind}${res.kind === "falhou" ? ` (${res.motivo})` : ""}`);
  }
}
