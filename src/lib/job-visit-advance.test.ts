import assert from "node:assert/strict";
import { test } from "node:test";
import { proximoPassoDasVisitas } from "./job-visit-advance";

const v = (id: string, idx: number, status: string, date: string) => ({ id, visit_index: idx, status, scheduled_date: date });

test("visita 1 ainda aberta: o job fica onde está", () => {
  assert.deepEqual(proximoPassoDasVisitas({ primaryDone: false, visits: [v("a", 2, "completed", "2026-10-20")] }), { kind: "primary_pending" });
});

test("V1 feita e V2 marcada: segue para a V2", () => {
  const r = proximoPassoDasVisitas({ primaryDone: true, visits: [v("b", 3, "scheduled", "2026-10-25"), v("a", 2, "scheduled", "2026-10-20")] });
  assert.equal(r.kind, "next_visit");
  assert.equal(r.kind === "next_visit" && r.visit.id, "a");
});

test("todas feitas ou canceladas: Final review", () => {
  assert.deepEqual(
    proximoPassoDasVisitas({ primaryDone: true, visits: [v("a", 2, "completed", "2026-10-20"), v("b", 3, "cancelled", "2026-10-21")] }),
    { kind: "finish" },
  );
});
