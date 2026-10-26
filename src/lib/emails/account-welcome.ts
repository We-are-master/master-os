/**
 * Boas-vindas de conta nova (dono, 26/10/2026, Crestview Pinnacle): o mesmo e-mail para
 * toda conta, montado com o que está na conta. Nome, contato, o preço combinado
 * (account_service_prices) e onde mandar os jobs. Inglês britânico, sem travessão.
 *
 * Puro (sem banco, sem envio): a rota `/api/accounts/[id]/welcome-email` lê a conta e manda.
 */
import { emailFixfy, gbp, primeiroNome } from "./fixfy-shell";

export type PrecoCombinado = {
  servico: string;
  /** Por hora: taxa e o mínimo de horas. Fechado: o valor. */
  modo: "hourly" | "fixed";
  valor: number;
  horasMinimas?: number | null;
};

export type BoasVindasDaConta = {
  empresa: string;
  contato?: string | null;
  precos: PrecoCombinado[];
  /** "Net 7", "Due on Receipt"... */
  prazo?: string | null;
  emailDosJobs?: string;
};

/** "£45 per hour, minimum 2 hours (£90)" ou "£180 fixed". */
export function linhaDoPreco(p: PrecoCombinado): string {
  if (p.modo === "fixed") return `${gbp(p.valor)} fixed`;
  const h = Number(p.horasMinimas) || 0;
  return h > 1 ? `${gbp(p.valor)} per hour, minimum ${h} hours (${gbp(p.valor * h)})` : `${gbp(p.valor)} per hour`;
}

export function buildAccountWelcomeEmail(d: BoasVindasDaConta): { subject: string; html: string; text: string } {
  const empresa = d.empresa.trim();
  const nome = primeiroNome(d.contato);
  const email = d.emailDosJobs ?? "hello@getfixfy.com";
  const precos = d.precos.filter((p) => p.valor > 0);
  // Um preço só (o caso comum): vira o destaque. Vários: linhas.
  const unico = precos.length === 1 || (precos.length > 1 && precos.every((p) => linhaDoPreco(p) === linhaDoPreco(precos[0]!))) ? precos[0] : null;
  const servicos = unico && precos.length > 1 ? precos.map((p) => p.servico).join(", ") : null;

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: "Everything you need to send us your first jobs: how to book, what it costs and what happens next.",
    estado: { texto: "Welcome aboard", cor: "orange" },
    titulo: `Welcome to Fixfy, ${empresa}`,
    saudacao: nome ? `Hi ${nome},` : `Hi ${empresa} team,`,
    paragrafos: [
      `We're delighted to welcome ${empresa} to Fixfy, and we're looking forward to looking after your properties.`,
      "Below is everything your team needs to send us work, what it costs and what happens once a job is booked.",
    ],
    metricas: unico
      ? unico.modo === "hourly"
        ? [
            { rotulo: "Per hour", valor: gbp(unico.valor) },
            ...(Number(unico.horasMinimas) > 1 ? [{ rotulo: "Minimum per job", valor: gbp(unico.valor * Number(unico.horasMinimas)), sub: `covers up to ${unico.horasMinimas} hours` }] : []),
          ]
        : [{ rotulo: "Agreed price", valor: gbp(unico.valor) }]
      : null,
    linhas: [
      ["Send every job to", email],
      ["Calls and WhatsApp", "+44 20 4538 4668"],
      ...(servicos ? ([["Services at this rate", servicos]] as Array<[string, string]>) : []),
      ...(!unico ? precos.map((p) => [p.servico, linhaDoPreco(p)] as [string, string]) : []),
      ["Invoices", d.prazo ? `After each job, with the photo report · ${d.prazo}` : "After each job, with the photo report"],
    ],
    cartoes: [
      { icone: "📩", titulo: "Email the job", texto: "Address, what needs doing, access and your preferred date." },
      { icone: "🗓️", titulo: "We confirm", texto: "Date and arrival window, by email." },
      { icone: "📸", titulo: "Done and reported", texto: "A vetted professional does it; you get photos and the invoice." },
    ],
    nota: "Materials and parts are only bought with your approval, and are listed separately on the invoice with the receipt.",
  });

  return { subject: `Welcome to Fixfy, ${empresa}`, html, text };
}
