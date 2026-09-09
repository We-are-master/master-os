/**
 * O e-mail de preço que vai ao cliente, sempre no mesmo formato.
 *
 * O formato é do dono (09/09/2026) e não muda por quote: Scope, Materials,
 * Labour, Total inc VAT. Um cliente que recebe dois e-mails nossos recebe a
 * mesma folha duas vezes, e quem confere fatura procura sempre no mesmo lugar.
 *
 * Os números saem do LANCE do parceiro, não de um preço que a gente inventou:
 * ele diz labour e materials separados, e a soma tem que bater com o lance.
 * Cada metade sobe pela margem, e as duas somadas dão o total. Somar depois de
 * arredondar cada linha é de propósito: é o total que o cliente confere na
 * calculadora, e ele soma o que está escrito.
 *
 * O que este arquivo NÃO faz: traduzir. Texto de parceiro chega em qualquer
 * língua e a tradução precisa de modelo, que é assíncrono e pode falhar. Quem
 * chama traduz antes e passa o texto já pronto, e se a tradução falhar o texto
 * cru entra com aviso na nota interna. Português nunca vai calado a um cliente
 * do Reino Unido.
 */
import { sellFromMargin } from "@/lib/catalog-pricing-floor-ceiling";

export type EntradaDoEmail = {
  /** Como o trabalho vai ser executado, já em inglês do Reino Unido. */
  scope: string;
  /** Custo de mão de obra do parceiro, em libras. */
  labourCost: number;
  /** Custo de material do parceiro, em libras. */
  materialsCost: number;
  margem: number;
};

export type EmailDaQuote = {
  corpo: string;
  labour: number;
  materials: number;
  total: number;
};

function libras(v: number): string {
  return `£${v.toFixed(2)}`;
}

/**
 * Quando o parceiro não separou material de mão de obra.
 *
 * Alguns mandam só um número. Aí a linha de material sai zerada em vez de a
 * gente rachar o valor por conta própria: inventar a divisão é dizer ao cliente
 * um número que ninguém calculou.
 */
export function montarEmailDaQuote(e: EntradaDoEmail): EmailDaQuote | null {
  const labour = sellFromMargin(e.labourCost, e.margem) ?? 0;
  const materials = e.materialsCost > 0 ? (sellFromMargin(e.materialsCost, e.margem) ?? 0) : 0;
  const total = Math.round((labour + materials) * 100) / 100;
  if (!(total > 0)) return null;

  const corpo = [
    "Hi Team,",
    "",
    "Please see the quote below:",
    "",
    `Scope: ${e.scope.trim()}`,
    "",
    `Materials: ${libras(materials)}`,
    `Labour: ${libras(labour)}`,
    `Total Price inc VAT: ${libras(total)}`,
    "",
    "Thank you",
  ].join("\n");

  return { corpo, labour, materials, total };
}

/**
 * O Scope em inglês do Reino Unido, saído do que o parceiro escreveu.
 *
 * O parceiro escreve na língua dele. No lance de £380 da QT-2026-1139 o
 * material veio "Tampa manchas , tinta , massa corrida tinta normal , lixas",
 * e esse texto ia direto para um cliente em Richmond.
 *
 * Falhou a tradução, devolve `traduzido: false` com o texto cru. Quem chama
 * põe o aviso na nota interna e o humano decide. O que não pode acontecer é
 * português sair calado para o cliente, e por isso a falha é VISÍVEL em vez de
 * o texto ser descartado.
 */
export async function scopeEmInglesUk(
  partes: { escopoDaQuote?: string | null; labour?: string | null; materials?: string | null },
  apiKey: string | undefined,
): Promise<{ scope: string; traduzido: boolean; motivo?: string }> {
  const cru = [
    partes.escopoDaQuote?.trim(),
    partes.labour?.trim() ? `Work: ${partes.labour.trim()}` : null,
    partes.materials?.trim() ? `Materials: ${partes.materials.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (!cru) return { scope: "", traduzido: false, motivo: "sem texto" };
  if (!apiKey) return { scope: cru, traduzido: false, motivo: "sem OPENAI_API_KEY" };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You rewrite a tradesperson\'s own words into ONE short paragraph of UK English for the customer who is paying. Strict JSON: {"scope":str}.\n\nRules:\n- UK English spelling (colour, plasterboard, skirting, labour).\n- Describe WHAT WILL BE DONE and the materials used. Present or future tense.\n- Keep every material the tradesperson listed. Use the UK trade name: "tampa manchas" is stain block primer, "massa corrida" is filler, "lixas" is sandpaper.\n- Never invent work, measurements, guarantees or timings that are not in the text.\n- Never name the platform, the account, the tradesperson or their company.\n- No prices. No greeting. No sign-off. Two sentences at most.',
          },
          { role: "user", content: cru },
        ],
      }),
    });
    if (!res.ok) return { scope: cru, traduzido: false, motivo: `HTTP ${res.status}` };
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as { scope?: string };
    const limpo = (j.scope ?? "").trim();
    return limpo ? { scope: limpo, traduzido: true } : { scope: cru, traduzido: false, motivo: "resposta vazia" };
  } catch (err) {
    return { scope: cru, traduzido: false, motivo: String(err).slice(0, 60) };
  }
}

/** Lê o BID_JSON que o `submit-bid` grava no campo `notes` do lance. */
export function lerPayloadDoLance(notes: string | null | undefined): {
  labourCost: number; materialsCost: number; labourDescription: string | null; materialsDescription: string | null;
} {
  const vazio = { labourCost: 0, materialsCost: 0, labourDescription: null, materialsDescription: null };
  const m = String(notes ?? "").match(/BID_JSON:(\{[\s\S]*?\})\s*(?:\n|$)/);
  if (!m) return vazio;
  try {
    const j = JSON.parse(m[1]!) as Record<string, unknown>;
    const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      labourCost: n(j.labour_cost),
      materialsCost: n(j.materials_cost),
      labourDescription: s(j.labour_description),
      materialsDescription: s(j.materials_description),
    };
  } catch {
    return vazio;
  }
}
