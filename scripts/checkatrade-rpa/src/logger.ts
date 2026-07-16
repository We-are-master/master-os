function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>): void {
    console.log(`[${timestamp()}] [info] ${msg}`, meta ? JSON.stringify(meta) : "");
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    console.warn(`[${timestamp()}] [warn] ${msg}`, meta ? JSON.stringify(meta) : "");
  },
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : err;
    console.error(`[${timestamp()}] [error] ${msg}`, detail ?? "");
  },
};
