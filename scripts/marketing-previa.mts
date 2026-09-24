/**
 * Ver o e-mail antes de ele sair. Não manda nada.
 *
 *   npx tsx scripts/marketing-previa.mts              # a edição da vez + 3 amostras
 *   npx tsx scripts/marketing-previa.mts --tudo       # as 52 edições e os 10 do nurture
 *   npx tsx scripts/marketing-previa.mts --n 17       # uma edição específica
 *
 * Escreve HTML em `.previa-emails/` e um índice para abrir no navegador. A
 * pasta é descartável e está no .gitignore: é prévia, não é entrega.
 *
 * Serve para a conferência que nenhum teste faz: ler o e-mail inteiro, com o
 * logo, a caixa do cupom e o rodapé, do jeito que o cliente vai receber.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENDA, dataDaPeca } from "@/lib/email-sequences/agenda";
import { NURTURE } from "@/lib/email-sequences/lifecycle-templates";
import { renderPeca, type Peca } from "@/lib/email-sequences/render";
import { acharCupom, comoSeLe } from "@/lib/marketing/cupons";

const PASTA = join(process.cwd(), ".previa-emails");
const CTX = {
  name: "Marta",
  unsubscribeUrl: "https://app.getfixfy.com/api/email/unsubscribe?e=exemplo",
};

const args = process.argv.slice(2);
const tudo = args.includes("--tudo");
const nPedido = args.includes("--n") ? Number(args[args.indexOf("--n") + 1]) : null;

function escolher(): Array<{ peca: Peca; campanha: string; rotulo: string }> {
  if (nPedido) {
    const p = AGENDA.find((x) => x.n === nPedido);
    if (!p) throw new Error(`não existe edição ${nPedido}`);
    return [{ peca: p, campanha: "client_season", rotulo: `Edição ${p.n}` }];
  }
  if (tudo) {
    return [
      ...NURTURE.map((p, i) => ({ peca: p, campanha: "client_lead_nurture", rotulo: `Nurture ${i + 1}` })),
      ...AGENDA.map((p) => ({ peca: p, campanha: "client_season", rotulo: `Edição ${p.n}` })),
    ];
  }
  // O padrão: o primeiro do nurture, a edição da vez e duas de tipos diferentes.
  const comCupom = AGENDA.find((p) => p.etiqueta === "Offer")!;
  const util = AGENDA.find((p) => p.etiqueta === "Home notes")!;
  const senhorio = AGENDA.find((p) => p.etiqueta === "Landlords")!;
  return [
    { peca: NURTURE[0], campanha: "client_lead_nurture", rotulo: "Nurture 1 (quem não comprou, dia 0)" },
    { peca: NURTURE[5], campanha: "client_lead_nurture", rotulo: "Nurture 6 (a oferta, dia 8)" },
    { peca: comCupom, campanha: "client_season", rotulo: `Edição ${comCupom.n} (oferta)` },
    { peca: util, campanha: "client_season", rotulo: `Edição ${util.n} (útil)` },
    { peca: senhorio, campanha: "client_season", rotulo: `Edição ${senhorio.n} (senhorio)` },
  ];
}

mkdirSync(PASTA, { recursive: true });
const escolhidas = escolher();
const linhas: string[] = [];

/** A primeira frase do corpo, que é o resumo honesto da peça. */
function resumo(peca: Peca): string {
  const primeiro = peca.blocos.find((b) => b.tipo === "texto");
  const texto = primeiro && primeiro.tipo === "texto" ? primeiro.html.replace(/<[^>]+>/g, "") : "";
  return texto.length > 150 ? `${texto.slice(0, 150)}...` : texto;
}

for (const { peca, campanha, rotulo } of escolhidas) {
  const html = renderPeca(peca, campanha, CTX);
  const arquivo = `${peca.key}.html`;
  writeFileSync(join(PASTA, arquivo), html, "utf8");

  const cupom = peca.cupom ? acharCupom(peca.cupom) : null;
  const n = "n" in peca ? (peca as { n: number }).n : null;
  const quando = n ? dataDaPeca(n).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "funil";
  const tipo = "etiqueta" in peca ? String(peca.etiqueta) : "";

  linhas.push(
    `<tr>
      <td class="n">${n ?? ""}</td>
      <td class="d">${quando}</td>
      <td><span class="tag">${tipo}</span></td>
      <td><a href="${arquivo}">${peca.assunto}</a><div class="r">${resumo(peca)}</div></td>
      <td>${cupom ? `<span class="c">${cupom.codigo}</span><div class="r">${comoSeLe(cupom)}</div>` : "<span class=\"vazio\">·</span>"}</td>
    </tr>`,
  );
  console.log(`  ${arquivo.padEnd(28)} ${peca.assunto}`);
}

const comCupom = escolhidas.filter((e) => e.peca.cupom).length;

writeFileSync(
  join(PASTA, "index.html"),
  `<!DOCTYPE html><meta charset="utf-8"><title>Conteúdo da temporada</title>
<style>
 body{font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:1040px;margin:36px auto;padding:0 20px;color:#16171A;background:#fff}
 h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px} p.sub{color:#55524C;margin:0 0 26px}
 table{width:100%;border-collapse:collapse} th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:#88847D;border-bottom:1px solid #C7C1B7;padding:0 12px 9px 0}
 td{border-bottom:1px solid #E3DFD8;padding:11px 12px 11px 0;vertical-align:top}
 td.n,td.d{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#55524C;white-space:nowrap}
 a{color:#020040;font-weight:600;text-decoration:none} a:hover{color:#ED4B00}
 .r{font-size:12.5px;color:#88847D;margin-top:3px;max-width:520px}
 .tag{font-size:11px;border:1px solid #E3DFD8;border-radius:20px;padding:2px 9px;color:#55524C;white-space:nowrap}
 .c{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#020040;background:#FFF8F4;border:1px solid #FED7AA;padding:2px 7px;border-radius:4px}
 .vazio{color:#C7C1B7}
</style>
<h1>Conteúdo da temporada</h1>
<p class="sub">${escolhidas.length} e-mails, ${comCupom} com cupom. Clique no assunto para ver o e-mail inteiro do jeito que o cliente recebe.</p>
<table><thead><tr><th>#</th><th>Sai em</th><th>Tipo</th><th>Assunto</th><th>Cupom</th></tr></thead>
<tbody>${linhas.join("")}</tbody></table>`,
  "utf8",
);

console.log(`\n${escolhidas.length} e-mail(s) em .previa-emails/. Abra .previa-emails/index.html`);
