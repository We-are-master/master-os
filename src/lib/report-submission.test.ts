import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReportPayload,
  deriveTimerWindow,
  isReportTemplate,
  londonWallClockToUtcIso,
  mergeReportPhotos,
  parseReportPhotoEntries,
  slotsForKind,
} from "@/lib/report-submission";
import { normalizeReport, renderableFields } from "@/lib/job-report-v2";

describe("report template validation", () => {
  it("accepts the four templates the partner app writes", () => {
    for (const t of ["general", "gardener", "cleaner", "certificate"]) {
      assert.equal(isReportTemplate(t), true);
    }
  });

  it("rejects anything else", () => {
    assert.equal(isReportTemplate("plumber"), false);
    assert.equal(isReportTemplate(""), false);
  });
});

describe("photo slots", () => {
  it("uses a flat array for general and gardener", () => {
    assert.equal(slotsForKind("general", "start"), null);
    assert.equal(slotsForKind("gardener", "final"), null);
  });

  it("keeps the equipment bucket out of the cleaner's final report", () => {
    assert.equal(slotsForKind("cleaner", "start")?.has("equipment"), true);
    assert.equal(slotsForKind("cleaner", "final")?.has("equipment"), false);
    assert.equal(slotsForKind("cleaner", "final")?.has("kitchen"), true);
  });

  it("accepts the certificate only on the final half", () => {
    assert.equal(slotsForKind("certificate", "start")?.size, 0);
    assert.equal(slotsForKind("certificate", "final")?.has("certificate"), true);
  });
});

describe("parseReportPhotoEntries", () => {
  it("groups files by slot and ignores the other form fields", () => {
    const form = new FormData();
    form.set("template", "general");
    form.set("startData", "{}");
    form.append("photos[before][]", new File(["a"], "a.jpg", { type: "image/jpeg" }));
    form.append("photos[after][]", new File(["b"], "b.jpg", { type: "image/jpeg" }));
    form.append("photos[after][]", new File(["c"], "c.pdf", { type: "application/pdf" }));

    const parsed = parseReportPhotoEntries(form);
    assert.deepEqual(Object.keys(parsed).sort(), ["after", "before"]);
    assert.equal(parsed.before.length, 1);
    assert.equal(parsed.after.length, 2);
  });

  it("ignores a photos key that carries text instead of a file", () => {
    const form = new FormData();
    form.append("photos[before][]", "not-a-file");
    assert.deepEqual(parseReportPhotoEntries(form), {});
  });
});

describe("buildReportPayload", () => {
  it("keeps source in the envelope, never among the rendered fields", () => {
    const payload = buildReportPayload({
      template: "general",
      source: "office_manual",
      submittedAt: "2026-08-13T10:00:00.000Z",
      photos: ["https://example.test/a.jpg"],
      data: { description: "Fixed the boiler", follow_up_required: false },
    });

    const normalized = normalizeReport(payload);
    assert.ok(normalized);
    assert.equal(normalized.source, "office_manual");
    assert.equal("source" in normalized.fields, false);

    // The PDF and the dashboard card both render off this list.
    const keys = renderableFields(normalized).map((f) => f.key);
    assert.equal(keys.includes("source"), false);
    assert.equal(keys.includes("description"), true);
  });

  it("reads back as a partner report when the partner link wrote it", () => {
    const normalized = normalizeReport(
      buildReportPayload({
        template: "cleaner",
        source: "partner_link",
        submittedAt: "2026-08-13T10:00:00.000Z",
        photos: { kitchen: ["https://example.test/k.jpg"] },
        data: { job_complete: true },
      }),
    );
    assert.equal(normalized?.source, "partner_link");
    assert.equal(normalized?.photosByRoom?.kitchen.length, 1);
  });
});

describe("deriveTimerWindow", () => {
  const now = "2026-08-13T16:00:00.000Z";

  it("never overwrites a timer the partner app actually measured", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T08:00:00.000Z",
      explicitStartedAt: "2026-08-13T09:00:00.000Z",
      durationMs: 3_600_000,
      now,
    });
    assert.equal(w.startedAt, "2026-08-13T08:00:00.000Z");
  });

  it("keeps a finish time the app already measured", () => {
    const w = deriveTimerWindow({
      existingEndedAt: "2026-08-13T15:10:00.000Z",
      explicitEndedAt: "2026-08-13T12:30:00.000Z",
      now,
    });
    assert.equal(w.endedAt, "2026-08-13T15:10:00.000Z");
  });

  it("takes the clock times the office typed", () => {
    const w = deriveTimerWindow({
      explicitStartedAt: "2026-08-13T09:00:00.000Z",
      explicitEndedAt: "2026-08-13T12:30:00.000Z",
      now,
    });
    assert.equal(w.startedAt, "2026-08-13T09:00:00.000Z");
    assert.equal(w.endedAt, "2026-08-13T12:30:00.000Z");
  });

  it("counts the typed duration backwards when there are no clock times", () => {
    const w = deriveTimerWindow({ durationMs: 90 * 60_000, now });
    assert.equal(w.endedAt, now);
    assert.equal(w.startedAt, "2026-08-13T14:30:00.000Z");
  });

  it("leaves the start empty rather than inventing one", () => {
    const w = deriveTimerWindow({ durationMs: 0, now });
    assert.equal(w.startedAt, null);
    assert.equal(w.endedAt, now);
  });

  // O caso dos dois toques (27/08/2026): 20 dos últimos 60 jobs tinham "timer"
  // de 4-49 segundos, gravado à noite para destravar o envio. Esse timer NÃO
  // mediu serviço e não pode vencer o horário de quem sabia a hora certa.
  it("a seconds-long tap-tap timer loses to the typed clock times", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T21:06:52.000Z",
      existingEndedAt: "2026-08-13T21:06:57.000Z",
      explicitStartedAt: "2026-08-13T09:00:00.000Z",
      explicitEndedAt: "2026-08-13T12:30:00.000Z",
      now,
    });
    assert.equal(w.startedAt, "2026-08-13T09:00:00.000Z");
    assert.equal(w.endedAt, "2026-08-13T12:30:00.000Z");
  });

  it("a seconds-long timer loses to a typed duration too", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T21:06:52.000Z",
      existingEndedAt: "2026-08-13T21:06:57.000Z",
      durationMs: 3 * 3_600_000,
      now,
    });
    assert.equal(w.endedAt, now);
    assert.equal(w.startedAt, "2026-08-13T13:00:00.000Z");
  });

  it("with nothing better, the tap-tap timer still fills the columns", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T21:06:52.000Z",
      existingEndedAt: "2026-08-13T21:06:57.000Z",
      now,
    });
    assert.equal(w.startedAt, "2026-08-13T21:06:52.000Z");
    assert.equal(w.endedAt, "2026-08-13T21:06:57.000Z");
  });

  it("a real measured window still beats everything outside edit mode", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T08:00:00.000Z",
      existingEndedAt: "2026-08-13T11:45:00.000Z",
      explicitStartedAt: "2026-08-13T09:00:00.000Z",
      explicitEndedAt: "2026-08-13T12:30:00.000Z",
      durationMs: 3_600_000,
      now,
    });
    assert.equal(w.startedAt, "2026-08-13T08:00:00.000Z");
    assert.equal(w.endedAt, "2026-08-13T11:45:00.000Z");
  });
});

describe("mergeReportPhotos (edit mode)", () => {
  it("appends fresh flat uploads after the saved ones", () => {
    assert.deepEqual(
      mergeReportPhotos(["a.jpg", "b.jpg"], ["c.jpg"]),
      ["a.jpg", "b.jpg", "c.jpg"],
    );
  });

  it("merges room maps slot by slot", () => {
    assert.deepEqual(
      mergeReportPhotos({ kitchen: ["k1.jpg"], bedrooms: ["b1.jpg"] }, { kitchen: ["k2.jpg"] }),
      { kitchen: ["k1.jpg", "k2.jpg"], bedrooms: ["b1.jpg"] },
    );
  });

  it("editing without new files keeps everything already saved", () => {
    assert.deepEqual(mergeReportPhotos(["a.jpg"], []), ["a.jpg"]);
    assert.deepEqual(mergeReportPhotos({ kitchen: ["k1.jpg"] }, {}), { kitchen: ["k1.jpg"] });
  });

  it("a create (no existing report) passes uploads straight through", () => {
    assert.deepEqual(mergeReportPhotos(null, ["a.jpg"]), ["a.jpg"]);
    assert.deepEqual(mergeReportPhotos(undefined, {}), {});
  });

  it("drops junk from the saved payload instead of crashing", () => {
    assert.deepEqual(mergeReportPhotos(["ok.jpg", 42, "", null], ["new.jpg"]), ["ok.jpg", "new.jpg"]);
  });
});

describe("deriveTimerWindow on edit (preferExplicit)", () => {
  const now = "2026-08-13T16:00:00.000Z";

  it("typed corrections beat the window a previous fill derived", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T08:00:00.000Z",
      existingEndedAt: "2026-08-13T10:00:00.000Z",
      explicitStartedAt: "2026-08-13T12:00:00.000Z",
      explicitEndedAt: "2026-08-13T14:00:00.000Z",
      now,
      preferExplicit: true,
    });
    assert.equal(w.startedAt, "2026-08-13T12:00:00.000Z");
    assert.equal(w.endedAt, "2026-08-13T14:00:00.000Z");
  });

  it("editing without typing times keeps the saved window", () => {
    const w = deriveTimerWindow({
      existingStartedAt: "2026-08-13T08:00:00.000Z",
      existingEndedAt: "2026-08-13T10:00:00.000Z",
      now,
      preferExplicit: true,
    });
    assert.equal(w.startedAt, "2026-08-13T08:00:00.000Z");
    assert.equal(w.endedAt, "2026-08-13T10:00:00.000Z");
  });
});

describe("londonWallClockToUtcIso", () => {
  it("subtracts the BST hour in summer", () => {
    assert.equal(londonWallClockToUtcIso("2026-08-13", "09:30"), "2026-08-13T08:30:00.000Z");
  });

  it("leaves winter times alone (GMT === UTC)", () => {
    assert.equal(londonWallClockToUtcIso("2026-01-15", "09:30"), "2026-01-15T09:30:00.000Z");
  });

  it("handles the day the clocks go forward", () => {
    // 2026-03-29: BST starts at 01:00 London. 09:00 that morning is already BST.
    assert.equal(londonWallClockToUtcIso("2026-03-29", "09:00"), "2026-03-29T08:00:00.000Z");
  });

  it("handles the day the clocks go back", () => {
    // 2026-10-25: BST ends at 02:00 London. 09:00 that morning is GMT.
    assert.equal(londonWallClockToUtcIso("2026-10-25", "09:00"), "2026-10-25T09:00:00.000Z");
  });

  it("rejects malformed input instead of guessing", () => {
    assert.equal(londonWallClockToUtcIso("13/08/2026", "09:00"), null);
    assert.equal(londonWallClockToUtcIso("2026-08-13", "9am"), null);
    assert.equal(londonWallClockToUtcIso("2026-08-13", "25:00"), null);
    assert.equal(londonWallClockToUtcIso("2026-08-13", "09:75"), null);
  });
});
