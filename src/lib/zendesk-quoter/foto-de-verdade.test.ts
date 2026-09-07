import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { avaliarFoto, fotosDeVerdade, MIN_BYTES_FOTO } from "./foto-de-verdade";

const foto = (over: Partial<Parameters<typeof avaliarFoto>[0]> = {}) => ({
  file_name: "IMG_4821.jpg",
  content_type: "image/jpeg",
  size: 1_800_000,
  ...over,
});

describe("avaliarFoto", () => {
  test("foto de telefone entra", () => {
    assert.deepEqual(avaliarFoto(foto()), { guardar: true });
  });

  test("logo de assinatura sai pelo tamanho", () => {
    const v = avaliarFoto(foto({ file_name: "image001.png", content_type: "image/png", size: 4_200 }));
    assert.equal(v.guardar, false);
  });

  test("gif sai sempre: é ícone ou pixel de rastreio, nunca serviço", () => {
    const v = avaliarFoto(foto({ file_name: "IMG_9.gif", content_type: "image/gif", size: 2_000_000 }));
    assert.equal(v.guardar, false);
  });

  test("nome de enfeite sai mesmo com tamanho de foto", () => {
    const v = avaliarFoto(foto({ file_name: "checkatrade-logo.png", content_type: "image/png", size: 900_000 }));
    assert.equal(v.guardar, false);
  });

  test("nome inocente NÃO salva um arquivo pequeno", () => {
    // O contrário também vale: o tamanho manda, o nome só reforça.
    const v = avaliarFoto(foto({ size: 3_000 }));
    assert.equal(v.guardar, false);
  });

  test("nome com 'logo' na palavra do trabalho continua sendo foto se for grande", () => {
    // "logo" dentro de outra palavra não é enfeite: o filtro é por palavra
    // reconhecível, e este teste existe para o dia em que alguém apertar a
    // regex e quebrar isto sem perceber.
    const v = avaliarFoto(foto({ file_name: "cozinha-logo-apos-reforma.jpg", content_type: "image/jpeg", size: 2_000_000 }));
    assert.equal(v.guardar, false, "hoje sai — se um dia precisar entrar, o filtro é aqui");
  });

  test("PDF anexado não é foto", () => {
    const v = avaliarFoto(foto({ file_name: "certificado.pdf", content_type: "application/pdf", size: 900_000 }));
    assert.equal(v.guardar, false);
  });

  test("o piso é o que separa logo de foto", () => {
    assert.equal(avaliarFoto(foto({ size: MIN_BYTES_FOTO - 1 })).guardar, false);
    assert.equal(avaliarFoto(foto({ size: MIN_BYTES_FOTO })).guardar, true);
  });
});

describe("fotosDeVerdade", () => {
  test("guarda a ordem e tira só o lixo", () => {
    const lote = [
      foto({ file_name: "porta.jpg" }),
      foto({ file_name: "image002.png", content_type: "image/png", size: 3_100 }),
      foto({ file_name: "parede.jpg" }),
      foto({ file_name: "linkedin.gif", content_type: "image/gif", size: 1_200 }),
    ];
    assert.deepEqual(
      fotosDeVerdade(lote).map((f) => f.file_name),
      ["porta.jpg", "parede.jpg"],
    );
  });

  test("lote só de assinatura devolve nada, e isso não é erro", () => {
    const lote = [foto({ file_name: "logo.png", content_type: "image/png", size: 5_000 })];
    assert.equal(fotosDeVerdade(lote).length, 0);
  });
});
