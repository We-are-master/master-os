/**
 * Um ZIP sem compressão, escrito à mão.
 *
 * Existe para o botão "baixar as fotos do relatório": quem revisa um job quer
 * as fotos do parceiro numa pasta, não trinta abas do navegador.
 *
 * Sem dependência de propósito. O formato ZIP tem um modo `store`, que é
 * "guarde os bytes como estão", e ele é o certo aqui: JPEG já é comprimido, e
 * passar um deflate por cima gasta CPU para economizar 1 ou 2 por cento. O que
 * sobra é cabeçalho, e cabeçalho é struct de tamanho fixo.
 *
 * O que este arquivo NÃO faz, e nem tenta: compressão, zip64 (arquivos acima
 * de 4GB), criptografia, pastas vazias. Um relatório são dezenas de fotos de
 * celular; se um dia passar de 4GB o problema é outro.
 */

/** Tabela do CRC-32 (polinômio 0xEDB88320), montada uma vez. */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Data e hora no formato do MS-DOS, que é o que o ZIP guarda.
 *
 * Segundos têm resolução de 2 (o campo tem 5 bits), e o ano conta a partir de
 * 1980. Não é escolha nossa: é o formato de 1989 que todo descompactador lê.
 */
function dataDos(d: Date): { hora: number; data: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    data: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export type ArquivoDoZip = { nome: string; dados: Uint8Array };

/**
 * Nome seguro dentro do zip.
 *
 * Barra e `..` saem porque nome de arquivo vindo de dado do usuário é como se
 * escreve fora da pasta de destino na hora de descompactar. Acentos ficam: o
 * bit 11 da flag diz que o nome é UTF-8.
 */
export function nomeSeguroNoZip(nome: string): string {
  const limpo = nome
    .replace(/[/\\]+/g, "-") // sem separador de caminho
    .replace(/\.{2,}/g, ".") // sem "..", que sobe uma pasta
    .replace(/^[.\-\s]+/, "") // sem começar por ponto ou traço, que sobra da limpeza acima
    .trim();
  return limpo.length > 0 ? limpo.slice(0, 180) : "file";
}

/** Monta o ZIP inteiro em memória. */
export function montarZip(arquivos: ArquivoDoZip[], quando = new Date()): Uint8Array {
  const { hora, data } = dataDos(quando);
  const codificador = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;

  for (const arq of arquivos) {
    const nome = codificador.encode(nomeSeguroNoZip(arq.nome));
    const crc = crc32(arq.dados);
    const tam = arq.dados.length;

    // Cabeçalho local: 30 bytes fixos + nome, e logo depois os bytes do arquivo.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // assinatura
    local.setUint16(4, 20, true); // versão necessária
    local.setUint16(6, 0x0800, true); // flag: nome em UTF-8
    local.setUint16(8, 0, true); // método 0 = store
    local.setUint16(10, hora, true);
    local.setUint16(12, data, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, tam, true); // tamanho comprimido
    local.setUint32(22, tam, true); // tamanho original
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true); // sem campo extra
    locais.push(new Uint8Array(local.buffer), nome, arq.dados);

    // Diretório central: a mesma coisa, mais onde o cabeçalho local começou.
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // versão de quem escreveu
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, data, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, tam, true);
    central.setUint32(24, tam, true);
    central.setUint16(28, nome.length, true);
    central.setUint32(42, deslocamento, true);
    centrais.push(new Uint8Array(central.buffer), nome);

    deslocamento += 30 + nome.length + tam;
  }

  const tamanhoCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); // entradas neste disco
  fim.setUint16(10, arquivos.length, true); // entradas no total
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true); // onde o diretório central começa
  const partes = [...locais, ...centrais, new Uint8Array(fim.buffer)];

  const total = partes.reduce((s, b) => s + b.length, 0);
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}
