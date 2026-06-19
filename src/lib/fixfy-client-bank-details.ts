/** Client-facing bank details for RCP / statement payments by bank transfer. */
export const FIXFY_CLIENT_BANK_DETAILS = {
  accountName: "GETFIXFY LTD",
  sortCode: "04-00-03",
  accountNumber: "06913415",
  iban: "GB38 MONZ 0400 0306 9134 15",
  bankName: "Monzo Bank",
} as const;

export const FIXFY_CLIENT_BANK_DETAIL_ROWS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Account name", value: FIXFY_CLIENT_BANK_DETAILS.accountName },
  { label: "Sort code", value: FIXFY_CLIENT_BANK_DETAILS.sortCode },
  { label: "Account no.", value: FIXFY_CLIENT_BANK_DETAILS.accountNumber },
  { label: "IBAN", value: FIXFY_CLIENT_BANK_DETAILS.iban },
  { label: "Bank", value: FIXFY_CLIENT_BANK_DETAILS.bankName },
];
