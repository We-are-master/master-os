/**
 * Quem escreve é empresa (Fase 3, dono 09/10/2026)? Imobiliária, gestora, dono de
 * carteira ou short let vira conta, não reserva avulsa: o Harvey marca `b2b_potential`,
 * manda a tabela de parceiro e a equipe aprova a conta.
 *
 * Sinal forte (2 pontos) basta sozinho; fraco (1) precisa de outro ou do domínio próprio.
 */

const EMAIL_PESSOAL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk", "live.com", "live.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "msn.com", "btinternet.com",
  "sky.com", "virginmedia.com", "talktalk.net", "protonmail.com", "proton.me", "mail.com", "gmx.com", "gmx.co.uk",
]);

const SINAIS: Array<{ re: RegExp; sinal: string; peso: 1 | 2 }> = [
  { re: /\b(?:we|i)\s+(?:look after|manage|run)\s+(?:about\s+|around\s+|over\s+)?(?:\d+\s+)?(?:propert|flats|units|homes|blocks|apartments|houses)/i, sinal: "manages properties", peso: 2 },
  { re: /\b(?:letting|lettings|estate|managing)\s+agen(?:t|ts|cy)\b/i, sinal: "letting or estate agent", peso: 2 },
  { re: /\bproperty\s+(?:management|manager|managers|portfolio|company)\b/i, sinal: "property management", peso: 2 },
  { re: /\bblock\s+management\b|\bfacilities\s+manag/i, sinal: "block or facilities management", peso: 2 },
  { re: /\b\d{2,}\s+(?:properties|flats|units|homes|apartments|houses)\b/i, sinal: "many properties", peso: 2 },
  { re: /\b(?:trade\s+account|business\s+account|account\s+with\s+you|invoice\s+us|purchase\s+order|po\s+number)\b/i, sinal: "wants an account or invoicing", peso: 2 },
  { re: /\b(?:serviced\s+apartments?|airbnb|short[-\s]?lets?|holiday\s+lets?)\b/i, sinal: "short lets", peso: 1 },
  { re: /\b(?:student\s+(?:accommodation|housing|lets)|hmos?)\b/i, sinal: "student housing or HMO", peso: 1 },
  { re: /\b(?:our|my)\s+(?:tenants|landlords|portfolio|properties|units|clients)\b/i, sinal: "talks about a portfolio", peso: 1 },
  { re: /\b(?:regular|ongoing|recurring|monthly|weekly)\s+(?:work|jobs|cleans?|cleaning|maintenance|basis)\b/i, sinal: "recurring work", peso: 1 },
  { re: /\b[a-z0-9&'-]+\s+(?:ltd|limited|llp)\b/i, sinal: "company name", peso: 1 },
  { re: /\blandlord\b/i, sinal: "landlord", peso: 1 },
];

export type DeteccaoB2B = { potencial: boolean; pontos: number; sinais: string[]; dominio: string | null };

export function dominioDoEmail(email: string | null | undefined): string | null {
  const d = String(email ?? "").trim().toLowerCase().split("@")[1];
  return d && d.includes(".") ? d : null;
}

export function ehEmailDeEmpresa(email: string | null | undefined): boolean {
  const d = dominioDoEmail(email);
  return !!d && !EMAIL_PESSOAL.has(d) && !d.endsWith("getfixfy.com");
}

export function detectarB2B({ texto, email }: { texto: string; email?: string | null }): DeteccaoB2B {
  const sinais: string[] = [];
  let pontos = 0;
  for (const s of SINAIS) {
    if (s.re.test(texto)) {
      sinais.push(s.sinal);
      pontos += s.peso;
    }
  }
  const empresa = ehEmailDeEmpresa(email);
  if (empresa) {
    sinais.push(`business email (${dominioDoEmail(email)})`);
    pontos += 1;
  }
  return { potencial: pontos >= 2, pontos, sinais, dominio: empresa ? dominioDoEmail(email) : null };
}
