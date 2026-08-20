/**
 * Decide se a confirmação de agendamento vai para o cliente final, e por quê não.
 *
 * Duas perguntas, nesta ordem: a CONTA permite, e o NÚMERO serve? A ordem
 * importa. Perguntar do número primeiro faria a Fantastic aparecer como
 * "sem telefone" quando na verdade ela é "não mandamos, por decisão": o
 * primeiro convida alguém a caçar um dado que não deveria ser usado.
 *
 * Nada aqui envia. Esta função só decide, e devolve o motivo por escrito
 * quando decide que não. O motivo é gravado no job e vira a linha que a
 * pessoa lê no card, então ele é escrito para ser lido por gente.
 */

/** Como a conta responde: manda, não manda, ou ninguém decidiu ainda. */
export type PoliticaDaConta = boolean | null | undefined;

export type Decisao =
  | { manda: true; telefone: string }
  | { manda: false; motivo: string };

/**
 * Normaliza um número britânico para o formato E.164 (`+447…`).
 *
 * O banco tem os três formatos que a vida produz: `07508801803`,
 * `+44 78967 10967` e `07395 675020`. O respond.io identifica contato por
 * `phone:+44…`, então sem normalizar o mesmo cliente vira dois contatos e a
 * conversa se parte em duas.
 *
 * Devolve null para qualquer coisa que não seja mobile UK. Fixo de Londres
 * (`+4420…`) não recebe WhatsApp, e número de fora (o `+1 727-580-0572` do
 * JOB-9427) quase sempre é o landlord no exterior, não quem abre a porta:
 * mandar "chegamos amanhã às 8h" para ele não resolve o acesso e ainda gasta
 * uma janela de template.
 */
export function normalizarMobileUk(bruto: string | null | undefined): string | null {
  const so = String(bruto ?? "").replace(/[\s()\-.]/g, "");
  if (!so) return null;

  // `+447…` e `00447…`
  const internacional = so.match(/^(?:\+|00)44(7\d{9})$/);
  if (internacional) return `+44${internacional[1]}`;

  // `07…` nacional
  const nacional = so.match(/^0(7\d{9})$/);
  if (nacional) return `+44${nacional[1]}`;

  // `447…` sem prefixo nenhum
  const cru = so.match(/^44(7\d{9})$/);
  if (cru) return `+44${cru[1]}`;

  return null;
}

/** `true` só quando a conta decidiu explicitamente que sim. */
export function contaPermite(politica: PoliticaDaConta): boolean {
  return politica === true;
}

export function decidirEnvio(input: {
  /** `accounts.client_confirmation_whatsapp` da conta do cliente. */
  politicaDaConta: PoliticaDaConta;
  /** Nome da conta, só para o motivo ficar legível no card. */
  nomeDaConta?: string | null;
  /** `clients.phone`, cru como está no banco. */
  telefoneDoCliente: string | null | undefined;
  /** `jobs.client_confirmation_sent_at`: já foi? */
  jaEnviadoEm?: string | null;
}): Decisao {
  if (input.jaEnviadoEm) {
    return { manda: false, motivo: "already sent" };
  }

  const conta = input.nomeDaConta?.trim() || "this account";

  // Não decidido é diferente de decidido que não, e a mensagem diz qual é:
  // uma pede decisão do dono, a outra não pede nada.
  if (input.politicaDaConta === null || input.politicaDaConta === undefined) {
    return {
      manda: false,
      motivo: `no decision yet for ${conta}: turn client confirmations on or off in Account settings`,
    };
  }
  if (input.politicaDaConta === false) {
    return { manda: false, motivo: `${conta} does not send client confirmations` };
  }

  const telefone = normalizarMobileUk(input.telefoneDoCliente);
  if (!telefone) {
    const cru = String(input.telefoneDoCliente ?? "").trim();
    return {
      manda: false,
      motivo: cru
        ? `not a UK mobile: "${cru}" cannot receive this on WhatsApp`
        : "no phone number for the customer",
    };
  }

  return { manda: true, telefone };
}

/**
 * Trava mestra de TODA mensagem automática para o cliente final.
 *
 * Nasce desligada e é a única coisa que precisa mudar para o sistema começar a
 * falar com cliente de verdade. Existe porque três mensagens diferentes
 * (confirmação, lembrete de véspera, remarcação) foram construídas antes de o
 * processo ter sido validado de ponta a ponta: sem uma trava só, "ligar" seria
 * lembrar de três lugares, e esquecer um deles é mandar mensagem sem querer.
 *
 * Mesmo padrão do `PARTNER_ROUTING_ENABLED`, pelo mesmo motivo: a consequência
 * de errar é mensagem saindo para gente de verdade.
 */
export function mensagensAoClienteLigadas(): boolean {
  return process.env.CLIENT_MESSAGING_ENABLED === "1";
}
