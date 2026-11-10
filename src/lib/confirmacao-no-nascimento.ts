/** Até quantas horas depois de nascer o job Unassigned ainda confirma sozinho. */
export const HORAS_DA_CONFIRMACAO_NO_NASCIMENTO = 6;

/**
 * Job novo confirma na hora, mesmo sem parceiro (dono, 10/11/2026: "se tá no OS
 * tem que virar confirmation"; job marcado para daqui a uma semana não pode
 * deixar o cliente sem nada até alguém atribuir o parceiro).
 *
 * Só no nascimento: a varredura de status também chama a confirmação, e sem a
 * janela todo Unassigned antigo receberia um "your booking is confirmed" de uma
 * vez. Data no passado nunca confirma.
 */
export function confirmaNoNascimento(
  args: { createdAt?: string | null; dia: string },
  agora: Date = new Date(),
): boolean {
  const criado = Date.parse(String(args.createdAt ?? ""));
  if (!Number.isFinite(criado)) return false;
  const horas = (agora.getTime() - criado) / 3_600_000;
  if (horas < -0.1 || horas > HORAS_DA_CONFIRMACAO_NO_NASCIMENTO) return false;
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
  return /^\d{4}-\d{2}-\d{2}$/.test(args.dia) && args.dia >= hoje;
}
