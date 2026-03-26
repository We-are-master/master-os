#!/usr/bin/env python3
"""Read All Contacts CSV and emit INSERT INTO public.clients ... VALUES batches."""

import csv
import sys
from pathlib import Path


def sql_str(s: str | None) -> str:
    if s is None or not str(s).strip():
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_email(s: str | None) -> str:
    if s is None or not str(s).strip():
        return "NULL"
    return "'" + str(s).strip().lower().replace("'", "''") + "'"


# Texto da coluna ACCOUNT no CSV -> UUID em public.accounts (company_name na BD).
# Ajusta aqui se criares novas contas ou renomeares no Supabase.
# "Master Services" não existe na lista de accounts — fica NULL até haver conta.
ACCOUNT_CSV_TO_UUID: dict[str, str | None] = {
    "checkatrade": "38b48520-f116-4263-90e5-8cd5a7d39ecf",
    # CSV diz "Checkatrade Express"; na BD a empresa chama-se "Express"
    "checkatrade express": "8060fcf3-a538-4e5a-9318-1b49ee59f432",
    "master services": None,
    "housekeep": "9659bbfb-eb56-4a31-9773-7f5e1335d0b4",
}


def _normalize_account_key(raw: str) -> str:
    return " ".join(raw.strip().lower().split())


def account_expr(account: str | None) -> str:
    t = (account or "").strip()
    if not t:
        return "NULL"
    key = _normalize_account_key(t)
    if key not in ACCOUNT_CSV_TO_UUID:
        return "NULL"
    uid = ACCOUNT_CSV_TO_UUID[key]
    if not uid:
        return "NULL"
    return f"'{uid}'::uuid"


def last_job_expr(raw: str | None) -> str:
    t = (raw or "").strip()
    if not t:
        return "NULL"
    lit = t.replace("'", "''")
    return f"'{lit}'::date"


def row_values(row: dict[str, str]) -> str:
    name = (row.get("CONTACT_NAME") or "").strip()
    if not name:
        return ""
    email = sql_email(row.get("EMAIL"))
    phone = sql_str(row.get("PHONE")) if (row.get("PHONE") or "").strip() else "NULL"
    addr = sql_str(row.get("ADDRESS")) if (row.get("ADDRESS") or "").strip() else "NULL"
    pc = sql_str(row.get("POSTCODE")) if (row.get("POSTCODE") or "").strip() else "NULL"
    acc = account_expr(row.get("ACCOUNT"))
    last_d = last_job_expr(row.get("LAST_ACTIVITY"))
    esc_name = name.replace("'", "''")
    return f"""(
  '{esc_name}',
  {email},
  {phone},
  {addr},
  NULL::text,
  {pc},
  'residential',
  'direct',
  'active',
  NULL::text,
  '{{}}'::text[],
  0,
  0,
  {last_d},
  {acc},
  NULL::timestamptz
)"""


def main() -> None:
    csv_path = Path(
        "/Users/guilhermedantaspereira/Downloads/master_os_data_from_others_saas.xlsx - All Contacts.csv"
    )
    out_path = Path(__file__).resolve().parent / "import-all-contacts-insert.sql.example"
    if len(sys.argv) >= 2:
        csv_path = Path(sys.argv[1])
    if len(sys.argv) >= 3:
        out_path = Path(sys.argv[2])

    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or "CONTACT_NAME" not in reader.fieldnames:
            print("CSV must have CONTACT_NAME column", file=sys.stderr)
            sys.exit(1)
        rows = list(reader)

    chunks: list[list[str]] = []
    current: list[str] = []
    for row in rows:
        v = row_values(row)
        if not v:
            continue
        current.append(v)
        if len(current) >= 400:
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)

    header = """-- Gerado automaticamente a partir de All Contacts.csv
-- Cola no SQL Editor do Supabase (executa bloco a bloco se der timeout).
-- Vínculo ACCOUNT (CSV) -> source_account_id: ver ACCOUNT_CSV_TO_UUID em generate_clients_import_sql.py

"""

    insert_head = """INSERT INTO public.clients (
  full_name,
  email,
  phone,
  address,
  city,
  postcode,
  client_type,
  source,
  status,
  notes,
  tags,
  total_spent,
  jobs_count,
  last_job_date,
  source_account_id,
  deleted_at
) VALUES
"""

    parts = [header]
    for i, chunk in enumerate(chunks):
        parts.append(insert_head)
        parts.append(",\n".join(chunk))
        parts.append(";\n\n")

    out_path.write_text("".join(parts), encoding="utf-8")
    print(f"Wrote {out_path} ({sum(len(c) for c in chunks)} rows in {len(chunks)} statements)")


if __name__ == "__main__":
    main()
