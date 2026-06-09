import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXFY_SCHOOL_PHASES } from "../src/lib/fixfy-school-curriculum.ts";

const out = join(process.cwd(), "public/school/fixfy-school/school-curriculum.json");

const payload = {
  phases: FIXFY_SCHOOL_PHASES.map((p) => ({
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    description: p.description,
    accent: p.accent,
    order: p.order,
    lessons: p.lessons.map((l) => ({
      id: l.id,
      phaseId: l.phaseId,
      title: l.title,
      description: l.description,
      format: l.format,
      assetPath: l.assetPath,
      durationMin: l.durationMin,
      xp: l.xp,
      order: l.order,
    })),
  })),
};

writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${out} (${payload.phases.length} phases)`);
