/** Leitura do documento por um modelo de visão (sem banco: dá para testar solto). */

export const TIPOS_DE_DOC = ["id_proof", "right_to_work", "insurance", "proof_of_address", "dbs", "certification"] as const;
export type TipoDeDoc = (typeof TIPOS_DE_DOC)[number];

const O_QUE_E: Record<TipoDeDoc, string> = {
  id_proof: "a photo ID: passport, UK driving licence or national ID card",
  right_to_work: "proof of right to work in the UK: a British or Irish passport, or the Home Office right to work check result (share code page) showing the person can work",
  insurance: "a public liability insurance certificate or schedule",
  proof_of_address: "a utility bill, council tax bill or bank statement from the last 3 months",
  dbs: "a DBS certificate",
  certification: "a trade qualification or certificate (Gas Safe, NICEIC, 18th Edition, etc.)",
};

export type Leitura = {
  readable: boolean;
  is_expected_document: boolean;
  what_it_is: string;
  holder_name: string | null;
  expiry_date: string | null;
  issue_date: string | null;
  british_or_irish_passport: boolean;
  looks_edited_or_fake: boolean;
  certificate_title: string | null;
  problem: string | null;
};

export async function lerDocumento(arquivo: { dados: Buffer; tipo: string }, esperado: TipoDeDoc): Promise<Leitura> {
  const dataUrl = `data:${arquivo.tipo};base64,${arquivo.dados.toString("base64")}`;
  const parte =
    arquivo.tipo === "application/pdf"
      ? { type: "file", file: { filename: "document.pdf", file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };
  const pedido = `You check documents for a UK home services company. The partner says this is ${O_QUE_E[esperado]}.
Return JSON only with: readable (bool), is_expected_document (bool), what_it_is (short), holder_name (as printed, or the insured business/person for insurance), expiry_date (YYYY-MM-DD or null; for insurance the policy end date), issue_date (YYYY-MM-DD or null), british_or_irish_passport (bool), looks_edited_or_fake (bool), certificate_title (for certificates, else null), problem (one short line if anything is wrong, else null). Today is ${new Date().toISOString().slice(0, 10)}.`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.HARVEY_WA_DOC_MODEL?.trim() || process.env.HARVEY_WA_MODEL?.trim() || "gpt-5.4",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: pedido }, parte] }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`leitura do documento ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return JSON.parse(j.choices[0].message.content) as Leitura;
}

