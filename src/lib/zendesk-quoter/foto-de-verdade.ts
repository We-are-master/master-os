/**
 * Isto é foto do trabalho, ou é o rodapé do e-mail?
 *
 * Todo e-mail de empresa chega com logo, ícone de rede social, banner e pixel
 * de rastreio, e o Zendesk anexa tudo como imagem igual à foto da porta
 * quebrada. Guardar sem filtrar enche o card do job de logos, e o parceiro
 * abre a galeria para ver o serviço e encontra o logo da plataforma — que é
 * justamente o nome que a regra da casa manda tirar do job.
 *
 * Filtrar por TAMANHO é o único critério barato que funciona sem decodificar
 * a imagem: logo e pixel são pequenos porque precisam ser, e foto tirada de
 * telefone passa longe disso. O nome do arquivo entra como reforço, nunca
 * como única prova — um `IMG_4821.jpg` de 2 KB continua sendo lixo, e uma
 * `logo-da-cozinha-nova.jpg` de 3 MB continua sendo foto.
 */

/** Abaixo disto não existe foto de serviço: é logo, ícone ou pixel. */
export const MIN_BYTES_FOTO = 25 * 1024;

/** Acima disto o Zendesk já não é a origem provável (e o modelo não precisa). */
export const MAX_BYTES_FOTO = 12 * 1024 * 1024;

/**
 * Nome que denuncia enfeite de e-mail.
 *
 * Vem dos anexos reais da fila: assinaturas do Checkatrade e da Housekeep, e
 * o `image00x.png` que o Outlook gera para tudo que está no corpo.
 */
const NOME_DE_ENFEITE =
  /(logo|signature|assinatura|icon|favicon|banner|footer|header|badge|social|facebook|twitter|linkedin|instagram|spacer|pixel|tracking|beacon|smiley|emoji)/i;

/** Formato que nunca é foto de serviço. */
const FORMATO_DE_ENFEITE = /^image\/(gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

export interface AnexoDeImagem {
  file_name: string;
  content_type: string;
  size: number;
}

export type Veredito =
  | { guardar: true }
  | { guardar: false; motivo: string };

export function avaliarFoto(a: AnexoDeImagem): Veredito {
  const tipo = String(a.content_type ?? "").toLowerCase();
  const nome = String(a.file_name ?? "");
  const bytes = Number(a.size ?? 0);

  if (!tipo.startsWith("image/")) return { guardar: false, motivo: `não é imagem (${tipo || "sem tipo"})` };
  if (FORMATO_DE_ENFEITE.test(tipo)) return { guardar: false, motivo: `formato de enfeite (${tipo})` };
  if (bytes > MAX_BYTES_FOTO) return { guardar: false, motivo: `grande demais (${Math.round(bytes / 1024)} KB)` };
  if (bytes < MIN_BYTES_FOTO) return { guardar: false, motivo: `pequena demais (${Math.round(bytes / 1024)} KB)` };
  if (NOME_DE_ENFEITE.test(nome)) return { guardar: false, motivo: `nome de enfeite (${nome})` };
  return { guardar: true };
}

/** Só as que valem guardar, na ordem em que chegaram. */
export function fotosDeVerdade<T extends AnexoDeImagem>(anexos: readonly T[]): T[] {
  return anexos.filter((a) => avaliarFoto(a).guardar);
}
