import { strict as assert } from "node:assert";
import { test } from "node:test";
import { crc32, montarZip, nomeSeguroNoZip } from "./zip-simples";

const bytes = (s: string) => new TextEncoder().encode(s);
const u32 = (z: Uint8Array, i: number) => new DataView(z.buffer, z.byteOffset).getUint32(i, true);
const u16 = (z: Uint8Array, i: number) => new DataView(z.buffer, z.byteOffset).getUint16(i, true);

test("crc32 bate com o vetor canônico do padrão", () => {
  // "123456789" → 0xCBF43926 é o teste que toda implementação de CRC-32 usa.
  assert.equal(crc32(bytes("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("o zip começa e termina com as assinaturas certas", () => {
  const z = montarZip([{ nome: "a.txt", dados: bytes("oi") }]);
  assert.equal(u32(z, 0), 0x04034b50); // cabeçalho local
  assert.equal(u32(z, z.length - 22), 0x06054b50); // fim do diretório central
  assert.equal(u16(z, z.length - 22 + 10), 1); // uma entrada
});

test("guarda sem comprimir, e os dois tamanhos são o mesmo", () => {
  const dados = bytes("uma foto seria bem maior que isto");
  const z = montarZip([{ nome: "f.jpg", dados }]);
  assert.equal(u16(z, 8), 0); // método 0 = store
  assert.equal(u32(z, 18), dados.length); // tamanho comprimido
  assert.equal(u32(z, 22), dados.length); // tamanho original
  assert.equal(u32(z, 14), crc32(dados));
});

test("os bytes do arquivo entram intactos", () => {
  const dados = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const z = montarZip([{ nome: "x.jpg", dados }]);
  const inicio = 30 + "x.jpg".length;
  assert.deepEqual(Array.from(z.slice(inicio, inicio + dados.length)), Array.from(dados));
});

test("nome de arquivo não escapa da pasta de destino", () => {
  // Barra e `..` vindos de dado do usuário são como se escreve fora do
  // destino na hora de descompactar.
  assert.equal(nomeSeguroNoZip("../../etc/passwd"), "etc-passwd");
  assert.equal(nomeSeguroNoZip("kitchen/foto.jpg"), "kitchen-foto.jpg");
  assert.equal(nomeSeguroNoZip("  "), "file");
  assert.ok(nomeSeguroNoZip("x".repeat(400)).length <= 180);
});

test("nome com acento é marcado como UTF-8", () => {
  const z = montarZip([{ nome: "cozinha ação.jpg", dados: bytes("a") }]);
  // Bit 11 da flag: sem ele o descompactador lê o nome em cp437 e o acento vira lixo.
  assert.equal(u16(z, 6) & 0x0800, 0x0800);
});

test("zip vazio continua sendo um zip válido", () => {
  const z = montarZip([]);
  assert.equal(z.length, 22);
  assert.equal(u32(z, 0), 0x06054b50);
  assert.equal(u16(z, 10), 0);
});

test("várias entradas: o diretório central aponta para cada cabeçalho local", () => {
  const arquivos = [
    { nome: "um.txt", dados: bytes("primeiro") },
    { nome: "dois.txt", dados: bytes("segundo") },
  ];
  const z = montarZip(arquivos);
  const inicioCentral = u32(z, z.length - 22 + 16);
  assert.equal(u32(z, inicioCentral), 0x02014b50);
  // O primeiro local mora no byte 0; o segundo, logo depois do primeiro inteiro.
  assert.equal(u32(z, inicioCentral + 42), 0);
  const segundoCentral = inicioCentral + 46 + "um.txt".length;
  assert.equal(u32(z, segundoCentral + 42), 30 + "um.txt".length + 8);
});
