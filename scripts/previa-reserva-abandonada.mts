/**
 * Prévia dos três e-mails de reserva abandonada, com dados de exemplo.
 *
 *   npx tsx scripts/previa-reserva-abandonada.mts <pasta-de-saida>
 *
 * Grava email-1.html, email-2.html e email-3.html. Logo e ícones vão embutidos
 * na prévia (data URI) para abrir no navegador sem o OS no ar; no envio real
 * eles vêm de app.getfixfy.com.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agendaDoAbandono, email1, email2, email3, type ReservaAbandonada } from "../src/lib/emails/reserva-abandonada";

const saida = process.argv[2] ?? "previa-reserva-abandonada";
mkdirSync(saida, { recursive: true });

const parou = new Date("2026-09-24T14:12:00Z");
const agenda = agendaDoAbandono(parou);
const expira = new Date(agenda.email3.getTime() + 48 * 3_600_000);

const exemplo: ReservaAbandonada = {
  firstName: "Alex",
  service: { name: "2 bed deep clean", withArticle: "a 2 bed deep clean" },
  details: ["2 bedrooms", "Oven included"],
  postcode: "SE12 8AA",
  price: 237,
  resumeUrl: "https://www.getfixfy.com/?s=clean&kind=deep&size=2&utm_source=email&utm_campaign=abandono",
  whatsappUrl: "https://wa.me/442045384668?text=Hi%2C%20I%20have%20a%20question%20about%20my%20deep%20clean%20booking",
  unsubscribeUrl: "https://app.getfixfy.com/api/email/unsubscribe?t=exemplo",
  assetBase: "ASSET",
  promo: { code: "BACK-7K2Q", percentOff: 10, discountedPrice: 213.3, expiresAt: expira },
};

function embutir(html: string): string {
  return html.replace(/ASSET\/([a-z/.-]+\.png)/g, (_m, caminho: string) => {
    const b64 = readFileSync(join("public", caminho)).toString("base64");
    return `data:image/png;base64,${b64}`;
  });
}

const pecas = [
  ["email-1", email1(exemplo), agenda.email1],
  ["email-2", email2(exemplo), agenda.email2],
  ["email-3", email3(exemplo), agenda.email3],
] as const;

for (const [nome, e, quando] of pecas) {
  writeFileSync(join(saida, `${nome}.html`), embutir(e.html));
  writeFileSync(join(saida, `${nome}.txt`), `Subject: ${e.subject}\nPreview: ${e.preheader}\nSends: ${quando.toISOString()}\n\n${e.text}\n`);
  console.log(`${nome}: "${e.subject}" · sai ${quando.toISOString()}`);
}
