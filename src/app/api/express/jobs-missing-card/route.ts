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
    itens?: {
      jobId: string;
      reportLink?: string;
      scope?: string;
      propertyAddress?: string;
      clientEmail?: string;
      clientPhone?: string;
    }[];
  };
  const supabase = createServiceClient();

  // ── preencher: o RPA já leu a página do card e traz o que faltava ────────
  if (corpo.acao === "preencher") {
    const itens = (corpo.itens ?? []).slice(0, 20);
    const feitos: { jobId: string; reference: string | null; scopeTrocado: boolean }[] = [];
    for (const item of itens) {
      if (!item?.jobId) continue;
      const { data: job } = await supabase
        .from("jobs")
        .select("id, reference, scope, report_link, internal_notes, property_address, client_id")
        .eq("id", item.jobId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!job) continue;
      // Nunca sobrescreve link que já existe: se alguém preencheu no meio do
      // caminho, a mão de gente ganha da varredura.
      const querLink = !!item.reportLink && !job.report_link;

      /**
       * Endereço e contato do cliente entram pelo mesmo caminho, porque o
       * buraco é o mesmo: job importado do e-mail nasce com o POSTCODE e nada
       * mais, e sem rua ninguém despacha parceiro. Só preenche o que está
       * vazio — endereço com vírgula já é endereço de verdade, e mão de gente
       * ganha da varredura aqui também.
       */
      const enderecoPobre = !/,/.test(String(job.property_address ?? ""));
      const querEndereco = !!item.propertyAddress && /,/.test(item.propertyAddress) && enderecoPobre;

      if (job.client_id && (item.clientEmail || item.clientPhone)) {
        const { data: cliente } = await supabase
          .from("clients")
          .select("id, email, phone")
          .eq("id", job.client_id)
          .maybeSingle();
        if (cliente) {
          const patch: Record<string, string> = {};
          if (item.clientEmail && !cliente.email) patch.email = item.clientEmail;
          if (item.clientPhone && !cliente.phone) patch.phone = item.clientPhone;
          if (Object.keys(patch).length > 0) await supabase.from("clients").update(patch).eq("id", cliente.id);
        }
      }

      // O scope só é TROCADO quando o que veio do card é mais rico. Um brief
      // escrito à mão pelo escritório pode valer mais que o texto padrão da
      // plataforma, e apagar isso seria perder trabalho de gente.
      const scopeAtual = (job.scope ?? "").trim();
      const scopeNovo = (item.scope ?? "").trim();
      const trocarScope = scopeNovo.length > scopeAtual.length + 40;

      const mudou = [
        querLink ? "report link" : null,
        trocarScope ? "job details" : null,
        querEndereco ? "full address" : null,
      ].filter(Boolean);
      if (mudou.length === 0) continue;

      const marca = `Recovered from the board on ${new Date().toISOString().slice(0, 10)}: ${mudou.join(", ")}.`;
      const { error } = await supabase
        .from("jobs")
        .update({
          ...(querLink ? { report_link: item.reportLink } : {}),
          ...(trocarScope ? { scope: scopeNovo } : {}),
          ...(querEndereco ? { property_address: item.propertyAddress } : {}),
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

  /**
   * Job que TEM link mas nasceu com cliente pela metade.
   *
   * O dono viu no JOB-9474 (19/08): importado do e-mail de confirmação, ele
   * entrou com o postcode como endereço e sem e-mail nenhum. A rua completa só
   * existe na página `/information` do card e o e-mail só na barra lateral do
   * job aceito — os dois atrás do mesmo link que o job já carrega, então aqui
   * não há o que casar: basta dizer ao RPA quais abrir.
   */
  const { data: comLink } = await supabase
    .from("jobs")
    .select("id, reference, property_address, report_link, client_id")
    .not("report_link", "is", null)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .gte("created_at", desde)
    .limit(200);

  const semRua = (comLink ?? []).filter(
    (j) => /membersapp\.checkatrade\.com/.test(String(j.report_link)) && !/,/.test(String(j.property_address ?? "")),
  );
  const idsClientes = [...new Set(semRua.map((j) => j.client_id).filter(Boolean))] as string[];
  const semEmail = new Set<string>();
  if (idsClientes.length > 0) {
    const { data: clientes } = await supabase.from("clients").select("id, email").in("id", idsClientes);
    for (const c of clientes ?? []) if (!c.email) semEmail.add(c.id);
  }

  const incompletos = semRua
    .map((j) => {
      const externalId = /business-jobs\/([A-Za-z0-9]+)/.exec(String(j.report_link))?.[1];
      if (!externalId) return null;
      return {
        jobId: j.id,
        reference: j.reference,
        externalId,
        falta: ["street", j.client_id && semEmail.has(j.client_id) ? "email" : null].filter(Boolean),
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    semLink: (jobs ?? []).length,
    casados,
    ambiguos,
    incompletos,
  });
}
