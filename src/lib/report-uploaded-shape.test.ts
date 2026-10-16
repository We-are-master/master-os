import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadedPhotoShape } from "./report-submission";

const JOB = "11111111-1111-1111-1111-111111111111";
const u = (n: string) => `https://kong.example/storage/v1/object/public/job-reports/${JOB}/${n}.jpg`;

test("trades: antes e depois vão para as metades certas", () => {
  const up = { "start:before": [u("a")], "final:after": [u("b"), u("c")] };
  assert.deepEqual(uploadedPhotoShape("general", "start", up, JOB), [u("a")]);
  assert.deepEqual(uploadedPhotoShape("general", "final", up, JOB), [u("b"), u("c")]);
});

test("limpeza: cômodo por metade, sem duplicar no depois", () => {
  const up = { "start:kitchen": [u("k1")], "final:kitchen": [u("k2")] };
  assert.deepEqual(uploadedPhotoShape("cleaner", "start", up, JOB), { kitchen: [u("k1")] });
  assert.deepEqual(uploadedPhotoShape("cleaner", "final", up, JOB), { kitchen: [u("k2")] });
});

test("endereço de outro job ou de fora é ignorado", () => {
  const up = { "final:after": ["https://evil.example/x.jpg", u("ok"), u("ok").replace(JOB, "22222222-2222-2222-2222-222222222222")] };
  assert.deepEqual(uploadedPhotoShape("general", "final", up, JOB), [u("ok")]);
});
