/**
 * Lifecycle sequence model. A sequence is an ordered list of steps; each step
 * has a delay measured from enrollment (`offsetHours`) and renders a Resend
 * email from the enrollment's `context`. The cron engine sends due steps,
 * then advances. Recurring sequences loop back to step 0 forever.
 */

export type SequenceContext = Record<string, string | number | null | undefined>;

export type SequenceStep = {
  /** Stable identifier for this step (used in the send log for idempotency). */
  key: string;
  /** Delay from `enrolled_at` (cumulative, not relative to the previous step). */
  offsetHours: number;
  subject: (ctx: SequenceContext) => string;
  html: (ctx: SequenceContext) => string;
};

export type SequenceDefinition = {
  key: string;
  label: string;
  /** When true, after the last step the enrollment loops back to step 0. */
  recurring?: boolean;
  /** For recurring sequences: hours from the last step's send to the next cycle. */
  recurEveryHours?: number;
  steps: SequenceStep[];
};

export function ctxStr(ctx: SequenceContext, key: string, fallback = ""): string {
  const v = ctx[key];
  return v === undefined || v === null ? fallback : String(v);
}
