/**
 * Uma porta só para todo relatório de agente sair.
 *
 * Antes: seis scripts com o mesmo bloco de `fetch` para a API do Resend
 * copiado e colado, cada um mandando o seu e-mail. Na caixa do dono isso
 * viravam cinco e-mails por dia, todo dia, e descobrir se havia algo a fazer
 * exigia abrir os cinco.
 *
 * Agora todo mundo chama `entregar()` e ela decide o destino:
 *
 *   BRIEF_DIR definido   grava a seção num arquivo e NÃO manda e-mail. É o
 *                        modo do turno: cada script escreve o seu pedaço e o
 *                        `brief-unico.mjs` junta tudo num e-mail só no fim.
 *   BRIEF_DIR vazio      manda o e-mail sozinho, exatamente como antes. É o
 *                        modo de rodar o script à mão, e é o que garante que
 *                        nada mudou para quem chama fora do turno.
 *
 * A regra de ouro do desenho: **um script que quebra não pode calar os
 * outros**. Por isso cada um grava o seu arquivo assim que termina, em vez de
 * o turno acumular tudo em memória. Se o terceiro morrer, os dois primeiros já
 * estão no disco e entram no e-mail; o que faltou aparece como ausente no
 * fim, em vez de sumir em silêncio.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

/** A lista única de destinatários, que mora no banco e não no código. */
export async function destinatarios() {
  try {
    const r = await fetch(`${SB}/rest/v1/company_settings?select=daily_brief_emails&limit=1`, {
      headers: { apikey: SK, authorization: `Bearer ${SK}` },
    });
    const cfg = await r.json();
    return String(cfg?.[0]?.daily_brief_emails ?? "")
      .split(/[,;\s]+/)
      .filter((s) => s.includes("@"));
  } catch {
    return [];
  }
}

/**
 * Entrega uma seção do brief.
 *
 * @param {object} p
 * @param {string} p.secao     chave curta e estável, ex.: "zia", "housekeep".
 *                             Vira o nome do arquivo e some do e-mail.
 * @param {number} p.ordem     posição no e-mail final. Dinheiro primeiro.
 * @param {string} p.titulo    o cabeçalho da seção no e-mail junto.
 * @param {string} p.assunto   o assunto que ele usaria sozinho. No e-mail
 *                             junto vira o resumo de uma linha da seção.
 * @param {string} [p.texto]   corpo em texto puro.
 * @param {string} [p.html]    corpo em HTML, quando o script já desenha um.
 * @param {string} [p.rodape]  a linha de rodapé própria da seção.
 * @param {boolean} [p.precisaAcao]  true quando há pendência esperando alguém.
 */
export async function entregar({ secao, ordem = 50, titulo, assunto, texto, html, rodape, precisaAcao = false }) {
  const dir = process.env.BRIEF_DIR?.trim();

  if (dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const arquivo = join(dir, `${String(ordem).padStart(2, "0")}-${secao}.json`);
    writeFileSync(
      arquivo,
      JSON.stringify({ secao, ordem, titulo, assunto, texto, html, rodape, precisaAcao, em: new Date().toISOString() }, null, 1),
    );
    console.log(`[brief] seção "${secao}" gravada em ${arquivo} (o e-mail sai no fim do turno)`);
    return { modo: "arquivo", arquivo };
  }

  const para = await destinatarios();
  if (!para.length || !process.env.RESEND_API_KEY) {
    console.log("[brief] sem destinatário ou sem RESEND_API_KEY: nada enviado");
    return { modo: "nenhum" };
  }
  const corpo = { from: process.env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>", to: para, subject: assunto };
  if (html) corpo.html = html;
  else corpo.text = rodape ? `${texto}\n\n-- \n${rodape}` : texto;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify(corpo),
  });
  console.log(r.ok ? `[brief] "${secao}" enviado para ${para.join(", ")}` : `[brief] falha em "${secao}": ${(await r.text()).slice(0, 160)}`);
  return { modo: "email", ok: r.ok };
}
