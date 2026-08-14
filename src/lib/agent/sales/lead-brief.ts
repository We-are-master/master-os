/**
 * Lê um lead do Checkatrade de volta de `clients.notes`.
 *
 * O RPA escreve a nota em três blocos separados por linha em branco
 * (`scripts/checkatrade-rpa/src/harvestLeads.ts`):
 *
 *     checkatrade-lead:6f21b0c4-…
 *
 *     Checkatrade lead (New) — Handyman
 *
 *     Hi, I need someone to put up two shelves and fix a sticking door…
 *
 * Só o primeiro bloco é garantido. A categoria costuma vir vazia (o RPA só
 * reconhecia a string literal "Handyman") e a mensagem falta nos leads colhidos
 * antes de expressarmos interesse, quando o Checkatrade ainda a esconde.
 */

export type LeadBrief = {
  /** `checkatrade-lead:<uuid>`. Torna a cobertura provável e o despacho idempotente. */
  externalId: string | null;
  clientId: string;
  name: string;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  /** Linha de endereço como o Checkatrade deu ("London W3 6XR, UK"). */
  location: string | null;
  /** O que o cliente escreveu. É contra isto que se vende. */
  enquiry: string | null;
  /** Categoria como o RPA tagueou, antes de relermos a mensagem. */
  rawCategory: string | null;
};

export type ClientRowForBrief = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  postcode: string | null;
  address: string | null;
  notes: string | null;
};

const MARKER = /checkatrade-lead:([\w-]+)/;
const CATEGORY_LINE = /^Checkatrade lead \(([^)]*)\)\s*[—-]?\s*(.*)$/m;
/** Postcode UK, outward + inward. Tolera o espaço ausente que aparece na prática. */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function extractPostcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(POSTCODE);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

/**
 * Um cliente acumula várias notas do Checkatrade com o tempo. Tudo depois do
 * SEGUNDO marcador é de outro lead, então corta ali. Sem isso, um pedido posterior
 * vaza para dentro deste e o agente abre citando o job errado.
 */
function firstLeadBlock(notes: string): string {
  const all = [...notes.matchAll(new RegExp(MARKER.source, "g"))];
  return all.length > 1 ? notes.slice(0, all[1].index ?? notes.length) : notes;
}

/**
 * Devolve null em vez de string vazia quando não há mensagem: "sem pedido" e
 * "pedido vazio" levam a aberturas diferentes (perguntar o que precisa contra
 * citar o que ele escreveu).
 */
function extractEnquiry(notes: string): string | null {
  const cat = notes.match(CATEGORY_LINE);
  const after = cat ? notes.slice((cat.index ?? 0) + cat[0].length) : notes.replace(MARKER, "");
  const body = after
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && !MARKER.test(b))
    .join("\n\n")
    .trim();
  return body.length > 0 ? body : null;
}

export function parseLeadBrief(row: ClientRowForBrief): LeadBrief {
  const notes = firstLeadBlock(row.notes ?? "");
  const marker = notes.match(MARKER);
  const category = notes.match(CATEGORY_LINE);

  return {
    externalId: marker ? marker[1] : null,
    clientId: row.id,
    name: (row.name ?? "").trim(),
    phone: row.phone,
    email: row.email,
    // O Checkatrade costuma mandar "London W3 6XR, UK" com o postcode só no
    // endereço, então cai para extrair da linha de endereço.
    postcode: row.postcode ?? extractPostcode(row.address),
    location: row.address,
    enquiry: extractEnquiry(notes),
    rawCategory: category ? category[2].trim() || null : null,
  };
}

export function isCheckatradeLead(notes: string | null | undefined): boolean {
  return MARKER.test(notes ?? "");
}

/**
 * Primeiro nome para a abertura. Devolve null em nome que parece empresa, para a
 * mensagem cair no cumprimento sem nome em vez de dizer "Hi Aerofield".
 */
export function firstName(full: string | null | undefined): string | null {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (parts.length === 1 && (first.length > 14 || /ltd|limited|homes|group|services/i.test(first))) {
    return null;
  }
  return first;
}
