import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fotosDoCardHousekeep, linksDeFotoDoCard, MAX_FOTOS_DO_CARD } from "./fotos-housekeep";

const S3 = (n: string) => `https://housekeep-specialist-job-prod.s3.amazonaws.com/specialist-job/x/customer-photos/${n}?X-Amz-Signature=abc`;
const corpo = {
  form: [],
  visit_details: {
    visit_details_sections: [
      { details: [{ label: "Postcode", value: "SW1V 4DA" }] },
      { details: [{ file_paths: [S3("a.jpg"), S3("b.PNG"), S3("clip.mov"), S3("a.jpg")] }, { value: "I need help pivoting a desk" }] },
    ],
  },
};

test("as fotos do card: só imagem, sem repetir, na ordem", () => {
  assert.deepEqual(linksDeFotoDoCard(corpo), [S3("a.jpg"), S3("b.PNG")]);
  assert.deepEqual(linksDeFotoDoCard({}), []);
  assert.deepEqual(linksDeFotoDoCard(null), []);
  const muitas = { visit_details: { visit_details_sections: [{ details: [{ file_paths: Array.from({ length: 9 }, (_, i) => S3(`${i}.jpg`)) }] }] } };
  assert.equal(linksDeFotoDoCard(muitas).length, MAX_FOTOS_DO_CARD);
});

test("baixa as fotos do card e devolve data URL; card fora do ar não lança", async () => {
  const fake = (async (url: string) => {
    if (url.includes("/api/v1/work/job-reports/")) return new Response(JSON.stringify(corpo), { status: 200 });
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as unknown as typeof fetch;
  const fotos = await fotosDoCardHousekeep("https://housekeep.com/job-reports/367d21ab73d8423ebc4cc270dc796ac2", fake);
  assert.equal(fotos.length, 2);
  assert.match(fotos[0].dataUrl, /^data:image\/jpeg;base64,/);
  const caido = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await fotosDoCardHousekeep("https://housekeep.com/job-reports/367d21ab73d8423ebc4cc270dc796ac2", caido), []);
  assert.deepEqual(await fotosDoCardHousekeep(null, fake), []);
});
