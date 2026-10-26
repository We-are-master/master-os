/**
 * Boas-vindas de conta nova (dono, 26/10/2026): o mesmo e-mail para toda conta, só
 * boas-vindas e o guia de como trabalhar com a gente. Sem preço (o combinado fica no
 * contrato e no orçamento). Inglês britânico, sem travessão, na moldura Fixfy.
 *
 * Puro (sem banco, sem envio): a rota `/api/accounts/[id]/welcome-email` lê a conta e manda.
 */
import { emailFixfy, primeiroNome } from "./fixfy-shell";

export type BoasVindasDaConta = {
  empresa: string;
  contato?: string | null;
  emailDosJobs?: string;
};

export function buildAccountWelcomeEmail(d: BoasVindasDaConta): { subject: string; html: string; text: string } {
  const empresa = d.empresa.trim();
  const nome = primeiroNome(d.contato);
  const email = d.emailDosJobs ?? "hello@getfixfy.com";

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: "How to send us work, what happens next and who to talk to.",
    estado: { texto: "Welcome aboard", cor: "orange" },
    titulo: `Welcome to Fixfy, ${empresa}`,
    saudacao: nome ? `Hi ${nome},` : `Hi ${empresa} team,`,
    paragrafos: [
      `We're delighted to welcome ${empresa} to Fixfy. From repairs and maintenance to cleaning and safety certificates, one team looks after your properties across London.`,
      "Here is a short guide to working with us, so your team can send us the first job today.",
    ],
    cartoes: [
      { icone: "📩", titulo: "1. Send the job", texto: `Email ${email}. One email per job.` },
      { icone: "🗓️", titulo: "2. We confirm", texto: "Date and arrival window, by email." },
      { icone: "📸", titulo: "3. Done and reported", texto: "Photo report and invoice when it's finished." },
    ],
    avisos: [
      {
        tom: "neutral",
        titulo: "What to include in each job request",
        itens: [
          "The property address, with the full postcode",
          "What needs doing, with photos or a short video if you have them",
          "Access: who will let us in, or where the keys are",
          "Your preferred date and time window",
          "A contact on site, if it's not you",
        ],
        lugar: "meio",
      },
      {
        tom: "blue",
        titulo: "Good to know",
        itens: [
          "Every job is carried out by a vetted, insured professional from our team.",
          "If anything extra is needed once we're on site, we ask you before going ahead.",
          "Need a quote first? Send the details and photos and we'll come back with a price.",
          "Anything not quite right after a visit? Reply to the job email and we'll put it right.",
        ],
        lugar: "meio",
      },
    ],
    linhas: [
      ["Job requests", email],
      ["Calls and WhatsApp", "+44 20 4538 4668"],
      ["Website", "getfixfy.com"],
    ],
    nota: "Save hello@getfixfy.com in your contacts so our booking emails never end up in spam.",
  });

  return { subject: `Welcome to Fixfy, ${empresa}`, html, text };
}
