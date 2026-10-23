import { test } from "node:test";
import assert from "node:assert/strict";
import { gruposDoReport } from "./grupos";
import { normalizeReport } from "@/lib/job-report-v2";

test("fotos por cômodo, na ordem de quem anda pela casa (o jsonb embaralha as chaves)", () => {
  const r = normalizeReport({ photos: { bedrooms: ["b1"], outside: ["o1"], kitchen: ["k1", "k2"], entrance_and_hallway: ["e1"], bathroom: ["w1"] } });
  assert.deepEqual(gruposDoReport(r).map((g) => g.rotulo), ["Entrance And Hallway", "Kitchen", "Bathroom", "Bedrooms", "Outside"]);
  assert.deepEqual(gruposDoReport(r)[1].urls, ["k1", "k2"]);
});

test("fotos soltas viram um grupo só; o certificado fica de fora", () => {
  const r = normalizeReport({ photos: ["a", "cert.pdf", "b"] });
  assert.deepEqual(gruposDoReport(r, new Set(["cert.pdf"])), [{ rotulo: "Photos", urls: ["a", "b"] }]);
  assert.deepEqual(gruposDoReport(null), []);
});
