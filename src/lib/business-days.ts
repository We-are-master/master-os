/**
 * Business-day helpers. Mon–Fri = working days, Sat/Sun skipped.
 * UK bank holidays are NOT excluded — partner upload links land in the middle of
 * the week most of the time and a one-day buffer either way isn't worth the data.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** Returns a NEW Date `n` business days after `from` (n must be >= 0). */
export function addBusinessDays(from: Date, n: number): Date {
  if (n <= 0) return new Date(from.getTime());
  const out = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    out.setTime(out.getTime() + MS_PER_DAY);
    if (!isWeekend(out)) added += 1;
  }
  return out;
}
