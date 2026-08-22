import { strict as assert } from "node:assert";
import { test } from "node:test";
import { drawerWidth } from "./responsive-drawer-width";

test("largura fixa vira estilo inline, nunca classe montada na hora", () => {
  // O Tailwind só gera classe que ele consegue LER no fonte. Montar
  // `max-w-[min(100vw,620px)]` com template string produzia uma classe que não
  // existe no CSS, e o drawer abria em tela cheia.
  const r = drawerWidth("w-[620px]");
  assert.equal(r.className, "w-full");
  assert.deepEqual(r.style, { maxWidth: "min(100vw, 620px)" });
});

test("rem também vira estilo", () => {
  const r = drawerWidth("w-[40rem]");
  assert.deepEqual(r.style, { maxWidth: "min(100vw, 40rem)" });
});

test("quem já se limita sozinho passa direto", () => {
  const r = drawerWidth("w-[min(100vw-1rem,40rem)]");
  assert.equal(r.className, "w-[min(100vw-1rem,40rem)]");
  assert.equal(r.style, undefined);
});

test("max-w escrito junto do w-full também é clampado", () => {
  // É como o drawer de Quotes pede: "w-full max-w-[620px]".
  const r = drawerWidth("w-full max-w-[620px]");
  assert.deepEqual(r.style, { maxWidth: "min(100vw, 620px)" });
});

test("classe de utilitário sem medida fixa continua funcionando", () => {
  const r = drawerWidth("w-1/2");
  assert.equal(r.className, "w-full w-1/2");
  assert.equal(r.style, undefined);
});
