/**
 * "Save all photos": o token assinado e o zip sem compressão.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkParaBaixarFotos, nomeDaFoto, nomeDoZip, pedidoDoToken, tokenDasFotos, zipSemCompressao } from "./fotos-zip";

test("token: ida e volta, e assinatura adulterada não passa", () => {
  const t = tokenDasFotos({ nome: "JOB-9812", urls: ["https://x.supabase.co/a.jpg", "http://inseguro/b.jpg", "https://x.supabase.co/c.png"] })!;
  assert.deepEqual(pedidoDoToken(t), { nome: "JOB-9812", urls: ["https://x.supabase.co/a.jpg", "https://x.supabase.co/c.png"] });
  const [carga] = t.split(".");
  const outra = Buffer.from(JSON.stringify({ n: "x", u: ["https://evil.example/z.jpg"] })).toString("base64url");
  assert.equal(pedidoDoToken(`${outra}.${t.split(".")[1]}`), null);
  assert.equal(pedidoDoToken(`${carga}.errado`), null);
  assert.equal(tokenDasFotos({ nome: "x", urls: [] }), null);
});

test("link aponta para a rota pública; sem foto, sem link", () => {
  assert.match(linkParaBaixarFotos("QT-1290", ["https://x.supabase.co/a.jpg"])!, /\/api\/public\/fotos-zip\/[\w-]+\.[\w-]+$/);
  assert.equal(linkParaBaixarFotos("QT-1290", []), null);
});

test("zip: cabeçalhos, nomes e conteúdo intactos", () => {
  const a = Buffer.from("primeira foto");
  const b = Buffer.from("segunda");
  const z = zipSemCompressao([{ nome: "photo-01.jpg", dados: a }, { nome: "photo-02.png", dados: b }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const fim = z.length - 22;
  assert.equal(z.readUInt32LE(fim), 0x06054b50);
  assert.equal(z.readUInt16LE(fim + 10), 2);
  const n1 = z.readUInt16LE(26);
  assert.equal(z.subarray(30, 30 + n1).toString(), "photo-01.jpg");
  assert.equal(z.subarray(30 + n1, 30 + n1 + a.length).toString(), "primeira foto");
});

test("nomes de arquivo", () => {
  assert.equal(nomeDoZip("JOB-9812"), "JOB-9812-photos.zip");
  assert.equal(nomeDoZip("QT 12/90"), "QT_12_90-photos.zip");
  assert.equal(nomeDaFoto(0, "https://x/a.JPEG?token=1", null), "photo-01.jpg");
  assert.equal(nomeDaFoto(9, "https://x/sem-ext", "image/png"), "photo-10.png");
});
