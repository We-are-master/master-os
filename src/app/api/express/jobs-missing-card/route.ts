/**
 * Job que nasceu sem o card da plataforma, e o conserto dele.
 *
 * Job aceito na mão (dono no celular, madrugada de 18/08, com o RPA cego) entra
 * no OS pelo e-mail de confirmação — e o e-mail NÃO traz o link do card, só
 * redirects rastreados. Sem o id do job na plataforma não há `report_link` e o
 * scope vira o resumo do e-mail em vez do brief que o cliente escreveu. Foi
 * exatamente o que aconteceu no JOB-9462 e no JOB-9463.
 *
 * O dado que falta mora no board, e quem chega no board é o RPA: a sessão auth0
 * vive no Chromium dele e um segundo navegador na mesma sessão derruba os dois.
 * Então a rota é invertida de propósito — o RPA manda os cards que ENXERGA e o
 * OS responde quais jobs casam. Assim o OS não precisa saber navegar, e o RPA
 * não precisa de acesso ao banco.
 *
 * POST { acao: "casar", cards: [...] }      → quais jobs sem link casam com estes cards
 * POST { acao: "preencher", itens: [...] }  → grava link e scope nos que casaram
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Janela de busca: job velho sem link é história, não fila. */
const DIAS = 45;

type CardDoBoard = {
  externalId: string;
  postcode?: string | null;
  /** YYYY-MM-DD da visita, quando o card diz. */
  date?: string | null;
  /** "Your Earnings" — o que a plataforma paga, já sem a taxa. */
  price?: number | null;
  customerName?: string | null;
};

function autorizado(req: NextRequest): boolean {
  const key = req.headers.get("x-api-key")?.trim();
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  return !!esperada && key === esperada;
}

/** "EN3 6GN", "en36gn", " EN3  6GN " viram a mesma coisa. */
const normPostcode = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

/**
 * O postcode do job mora no fim do endereço ("31 Newman Road, London, E13 8QA").
 * Regex de postcode UK ancorada no FIM: "London" tem dígito nenhum, mas rua com
 * número no meio ("46-48 Gaisford Street") casaria num padrão frouxo.
 */
function postcodeDoEndereco(endereco: string | null | undefined): string | null {
  const m = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$/i.exec((endereco ?? "").trim());
  return m ? normPostcode(m[1] + m[2]) : null;
}

const primeiroNome = (s: string | null | undefined) =>
  (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const corpo = (await req.json().catch(() => ({}))) as {
    acao?: string;
    cards?: CardDoBoard[];
    itens?: { jobId: string; reportLink: string; scope?: string }[];
  };
  const supabase = createServiceClient();

  // ── preencher: o RPA já leu a página do card e traz o que faltava ────────
  if (corpo.acao === "preencher") {
    const itens = (corpo.itens ?? []).slice(0, 20);
    const feitos: { jobId: string; reference: string | null; scopeTrocado: boolean }[] = [];
    for (const item of itens) {
      if (!item?.jobId || !item?.reportLink) continue;
      const { data: job } = await supabase
        .from("jobs")
        .select("id, reference, scope, report_link, internal_notes")
        .eq("id", item.jobId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!job) continue;
      // Nunca sobrescreve link que já existe: se alguém preencheu no meio do
      // caminho, a mão de gente ganha da varredura.
      if (job.report_link) continue;

      // O scope só é TROCADO quando o que veio do card é mais rico. Um brief
      // escrito à mão pelo escritório pode valer mais que o texto padrão da
      // plataforma, e apagar isso seria perder trabalho de gente.
      const scopeAtual = (job.scope ?? "").trim();
      const scopeNovo = (item.scope ?? "").trim();
      const trocarScope = scopeNovo.length > scopeAtual.length + 40;

      const marca = `Report link and job details recovered from the board on ${new Date().toISOString().slice(0, 10)}.`;
      const { error } = await supabase
        .from("jobs")
        .update({
          report_link: item.reportLink,
          ...(trocarScope ? { scope: scopeNovo } : {}),
          internal_notes: [job.internal_notes, marca].filter(Boolean).join("\n"),
        })
        .eq("id", job.id);
      if (!error) feitos.push({ jobId: job.id, reference: job.reference, scopeTrocado: trocarScope });
    }
    return NextResponse.json({ preenchidos: feitos });
  }

  // ── casar: quais jobs sem link são estes cards ───────────────────────────
  const cards = (corpo.cards ?? []).filter((c) => c?.externalId).slice(0, 400);
  const desde = new Date(Date.now() - DIAS * 86400e3).toISOString();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, reference, client_name, property_address, scheduled_date, client_price, created_at")
    .is("report_link", null)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .gte("created_at", desde)
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const casados: {
    jobId: string;
    reference: string;
    externalId: string;
    por: string;
  }[] = [];
  const ambiguos: { reference: string; motivo: string }[] = [];

  for (const job of jobs ?? []) {
    const pc = postcodeDoEndereco(job.property_address);
    if (!pc) continue;
    /**
     * Postcode sozinho NÃO casa. Prédio grande repete postcode entre vizinhos,
     * e link errado num job manda a Stefane submeter relatório na página de
     * outro cliente. Exige postcode MAIS uma segunda prova: a data marcada ou o
     * valor exato. Empate continua empate: dois candidatos e ninguém é escolhido.
     */
    const candidatos = cards.filter((c) => {
      if (normPostcode(c.postcode) !== pc) return false;
      const mesmaData = !!c.date && !!job.scheduled_date && c.date === job.scheduled_date;
      const mesmoValor =
        c.price != null &&
        job.client_price != null &&
        Math.abs(Number(c.price) - Number(job.client_price)) < 0.01;
      const mesmoNome =
        !!c.customerName &&
        !!job.client_name &&
        primeiroNome(c.customerName) === primeiroNome(job.client_name);
      return mesmaData || mesmoValor || mesmoNome;
    });
    if (candidatos.length === 0) continue;
    if (candidatos.length > 1) {
      ambiguos.push({ reference: job.reference, motivo: `${candidatos.length} cards com o mesmo postcode e prova` });
      continue;
    }
    const c = candidatos[0]!;
    const por = [
      c.date && c.date === job.scheduled_date ? "data" : null,
      c.price != null && job.client_price != null && Math.abs(Number(c.price) - Number(job.client_price)) < 0.01 ? "valor" : null,
      c.customerName && job.client_name && primeiroNome(c.customerName) === primeiroNome(job.client_name) ? "nome" : null,
    ]
      .filter(Boolean)
      .join("+");
    casados.push({ jobId: job.id, reference: job.reference, externalId: c.externalId, por: `postcode+${por}` });
  }

  return NextResponse.json({
    semLink: (jobs ?? []).length,
    casados,
    ambiguos,
  });
}
