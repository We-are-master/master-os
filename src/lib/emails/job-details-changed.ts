/**
 * Aviso de dados do job alterados (endereço, cliente): mesmo molde do aviso de
 * preço (dono, 10/11/2026: "e-mails de update pra tudo, riscando o antigo e
 * colocando o novo"). Faixa de aviso no topo, a régua do job, o valor novo à
 * esquerda e o antigo riscado à direita, Previously / Now na tabela.
 */
import { emailFixfy, saudacao, type Estado, type Metrica, type Publico } from "./fixfy-shell";
import { passosDoJob, PASSO_ACEITO, saudacaoDoParceiro, semTravessao } from "./partner-shell";
import { passosAte, PASSOS_VISITA } from "./faixas-do-email";

export type CampoDoJob = "address" | "client";

export type MudancaDeCampo = { campo: CampoDoJob; antes: string | null; depois: string | null };

type Email = { subject: string; html: string; text: string };

const ROTULO: Record<CampoDoJob, { novo: string; linha: string }> = {
  address: { novo: "New address", linha: "Address" },
  client: { novo: "Customer", linha: "Customer" },
};

const ESTADO: Estado = { texto: "Booking updated", cor: "orange", chip: true };

const limpo = (v: string | null | undefined) => String(v ?? "").trim();

/** Só o que mudou de verdade (ignora caixa e espaços). */
export function mudancasReais(lista: MudancaDeCampo[]): MudancaDeCampo[] {
  const norm = (v: string | null) => limpo(v).replace(/\s+/g, " ").toLowerCase();
  return lista.filter((m) => limpo(m.depois) && norm(m.antes) !== norm(m.depois));
}

function metricas(m: MudancaDeCampo): Metrica[] {
  const antes = limpo(m.antes);
  return [
    { rotulo: ROTULO[m.campo].novo, valor: limpo(m.depois) },
    ...(antes ? [{ rotulo: "Previously", valor: antes, riscado: true }] : []),
  ];
}

function linhasDasMudancas(lista: MudancaDeCampo[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of lista) {
    const rot = ROTULO[m.campo].linha;
    if (limpo(m.antes)) out.push([`${rot}, previously`, limpo(m.antes)]);
    out.push([`${rot}, now`, limpo(m.depois)]);
  }
  return out;
}

function resumoDoQueMudou(lista: MudancaDeCampo[]): string {
  const nomes = lista.map((m) => (m.campo === "address" ? "the property address" : "the customer"));
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} and ${nomes[nomes.length - 1]}` : nomes[0] ?? "the booking";
}

// ─── Cliente ─────────────────────────────────────────────────────────────

export function buildClientJobDetailsChangedEmail(data: {
  publico: Publico;
  jobReference: string;
  jobTitle: string;
  mudancas: MudancaDeCampo[];
  /** Linha da agenda ("Tue 11 Nov · 9am to 12pm"), quando tem. */
  agenda?: string | null;
}): Email {
  // O cliente não precisa saber de troca de cliente: só o endereço vai para ele.
  const lista = mudancasReais(data.mudancas).filter((m) => m.campo === "address");
  const ref = data.jobReference.trim();
  const subject = ref ? `Your booking has been updated · ${ref}` : "Your booking has been updated";
  const principal = lista[0];
  const { html, text } = emailFixfy({
    preheader: principal ? `New address: ${limpo(principal.depois)}.` : "Your booking has been updated.",
    estado: ESTADO,
    faixa: { tipo: "acao", texto: "Booking updated", nota: ref || null },
    passos: passosAte(PASSOS_VISITA, 1),
    titulo: "Your booking has been updated",
    metricas: principal ? metricas(principal) : [],
    saudacao: saudacao(data.publico),
    paragrafos: [
      `We’ve updated ${resumoDoQueMudou(lista)} on your booking.`,
      "If anything here isn’t right, just reply to this email.",
    ],
    linhas: [
      ...linhasDasMudancas(lista),
      ["Service", data.jobTitle],
      ["When", data.agenda ?? null],
      ["Booking", ref],
    ],
  });
  return { subject, html, text };
}

// ─── Parceiro ────────────────────────────────────────────────────────────

export function buildPartnerJobDetailsChangedEmail(data: {
  partnerFirstName?: string | null;
  jobReference: string;
  jobTitle: string;
  mudancas: MudancaDeCampo[];
  agenda?: string | null;
  jobUrl?: string | null;
}): Email {
  const lista = mudancasReais(data.mudancas);
  const ref = data.jobReference.trim();
  const subject = semTravessao(ref ? `Job details updated · ${ref}` : "Job details updated");
  // Endereço na frente: é o que muda o dia do parceiro.
  const principal = lista.find((m) => m.campo === "address") ?? lista[0];
  const url = data.jobUrl?.trim() || null;
  const { html, text } = emailFixfy({
    preheader: semTravessao(
      principal?.campo === "address" ? `New address: ${limpo(principal.depois)}.` : "The job details have changed.",
    ),
    estado: ESTADO,
    faixa: { tipo: "acao", texto: "Job updated", nota: ref || null },
    passos: passosDoJob(PASSO_ACEITO),
    titulo: "Job details updated",
    metricas: principal ? metricas(principal) : [],
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      `We’ve updated ${resumoDoQueMudou(lista)} on this job. Please check before you head out.`,
      "Something doesn’t look right? Just reply to this email and we’ll sort it.",
    ].map(semTravessao),
    linhas: [
      ...linhasDasMudancas(lista),
      ["Service", data.jobTitle?.trim() || ""],
      ["When", data.agenda ?? null],
      ["Booking", ref],
    ],
    cta: url ? { label: "Open job in app", url } : null,
  });
  return { subject, html, text };
}
