/**
 * Job aceito na Fantastic → job no OS, em `unassigned`.
 *
 * As três regras do dono para esta conta, e nenhuma é opcional:
 *
 *   1. nosso valor = 65% do preço do app (eles ficam com 35% de comissão);
 *   2. hora real = hora do app + 4h (o app pinta no fuso do APARELHO);
 *   3. sem a rua não se importa nada: "Confirm to see full address" antes.
 *
 * O total deles e a conta do horário vão para `internal_notes`, porque é o que
 * permite auditar a margem depois sem abrir o app.
 *
 * O custo do parceiro fica em branco de propósito. A tabela por quarto cobre a
 * limpeza padrão; carpete, tapete e sofá ficam fora dela e precisam de preço à
 * mão antes do self-bill.
 */
import { readFileSync } from "node:fs";

export const CONTA_FANTASTIC = "3da39c93-4456-4ab1-9bcc-4e87d9564dbd";
export const NOSSA_FATIA = 0.65;

function ambiente() {
  const p = new URL("../../.env.local", import.meta.url).pathname;
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const sb = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  chave: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY,
});

/**
 * Este job já está no OS?
 *
 * A prova é postcode + data, que é a regra da casa para casar job: o nome do
 * cliente é o último degrau e sozinho não decide. Sem esta checagem a Nina
 * duplicaria job a cada passada, porque o app não expõe id na tela.
 */
export async function jaImportado({ postcode, data }) {
  const { url, chave } = sb();
  const H = { apikey: chave, authorization: `Bearer ${chave}` };
  const sem = String(postcode ?? "").replace(/\s+/g, "").toUpperCase();
  if (!sem || !data) return null;
  const r = await fetch(
    `${url}/rest/v1/jobs?select=reference,postcode,property_address&scheduled_date=eq.${data}&deleted_at=is.null`,
    { headers: H },
  );
  const js = await r.json();
  if (!Array.isArray(js)) return null;
  const achado = js.find((j) =>
    String(j.postcode ?? "").replace(/\s+/g, "").toUpperCase() === sem ||
    String(j.property_address ?? "").replace(/\s+/g, "").toUpperCase().includes(sem));
  return achado?.reference ?? null;
}

/** Monta o corpo que o `/api/jobs` espera, com scope em inglês. */
export function montarCorpo(d) {
  const nosso = d.precoApp != null ? Number((d.precoApp * NOSSA_FATIA).toFixed(2)) : undefined;
  const scope = [
    d.titulo ? `${d.titulo}.` : null,
    "",
    d.condicoes,
    "",
    d.comentario,
  ].filter((x) => x !== null && x !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    account_id: CONTA_FANTASTIC,
    date: d.data,
    arrival_time: d.horaReal ?? undefined,
    client_name: d.cliente ?? undefined,
    property_address: d.endereco ?? d.postcode ?? undefined,
    postcode: d.postcode ?? undefined,
    title: "Cleaning",
    service_type: "Cleaning",
    client_price: nosso,
    description: scope || undefined,
    internal_notes: [
      `Imported by Nina from the partner app on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
      "",
      d.precoApp != null ? `Money: app total £${d.precoApp}. Our share at 65% = £${nosso}.` : "Money: the app did not show a price.",
      d.horaApp ? `Time: app showed ${d.horaApp} on the device clock (Sao Paulo); real arrival ${d.horaReal}.` : null,
      "Partner cost still to price by hand: the per-room table covers the standard clean only.",
    ].filter(Boolean).join("\n"),
    create_zendesk_ticket: true,
  };
}

/** Cria de verdade. `postar=false` só mostra o que faria. */
export async function importar(d, { postar = false } = {}) {
  ambiente();

  const faltando = ["cliente", "endereco", "data"].filter((k) => !d[k]);
  if (faltando.length) {
    return { status: "faltando", faltando, nota: `não importei: falta ${faltando.join(", ")}` };
  }
  const existente = await jaImportado(d);
  if (existente) return { status: "ja_existe", reference: existente };

  const corpo = montarCorpo(d);
  if (!postar) return { status: "ensaio", corpo };

  const base = process.env.MASTER_OS_BASE_URL?.trim() || "http://localhost:3000";
  const r = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.MASTER_OS_JOB_WEBHOOK_API_KEY ?? "" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: "erro", http: r.status, erro: j.error ?? "?" };
  return { status: "criado", reference: j.reference, ticket: j.zendesk_ticket_id };
}
