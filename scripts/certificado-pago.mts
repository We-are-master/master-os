/**
 * Certificado liberado com o pagamento (dono, 22/10/2026): chama a rota do OS, que manda
 * o e-mail "pagamento recebido + certificado" para os jobs de certificado da Fixfy que
 * fecharam com saldo e agora estão pagos. A regra mora em `src/lib/certificado/`; aqui é só
 * o gatilho, porque o envio usa código só de servidor (Next).
 *
 *   npx tsx scripts/certificado-pago.mts            # ENSAIO: a rota lista, não manda
 *   npx tsx scripts/certificado-pago.mts --aplicar  # manda
 *
 * Precisa de MASTER_OS_BASE_URL (ou NEXT_PUBLIC_APP_URL) e INTERNAL_SYNC_SECRET.
 * No Railway roda a cada 15 min (scripts/workers/rotinas.mts).
 */
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

const base = (process.env.MASTER_OS_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.getfixfy.com").replace(/\/$/, "");
const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
if (!segredo) {
  console.error("[certificado-pago] INTERNAL_SYNC_SECRET vazia: nada a fazer");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const r = await fetch(`${base}/api/cron/certificado-pago${aplicar ? "" : "?dry-run=1"}`, { headers: { "x-internal-secret": segredo } });
const corpo = (await r.json().catch(() => ({}))) as { modo?: string; aviso?: string | null; linhas?: Array<{ reference: string; resultado: string; detalhe: string }> };
if (!r.ok) {
  console.error(`[certificado-pago] HTTP ${r.status}`, corpo);
  process.exit(1);
}
console.log(`\n[certificado-pago] ${corpo.modo === "envio" ? "ENVIO REAL" : "ENSAIO"}${corpo.aviso ? ` · ${corpo.aviso}` : ""}`);
for (const l of corpo.linhas ?? []) console.log(`  ${l.resultado.padEnd(8)} ${l.reference.padEnd(10)} ${l.detalhe}`);
console.log(`${corpo.linhas?.length ?? 0} job(s).`);
