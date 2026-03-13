# Migração de dados: app antigo → Supabase único (Master OS)

Um único Supabase serve o **Master OS** (dashboard) e o **Master App** (parceiros). Os dados do banco antigo do app podem ser importados para esse mesmo projeto e normalizados nas tabelas canônicas.

## Visão geral

| Origem (app antigo) | Destino (canônico) |
|---------------------|---------------------|
| `booking`           | `jobs` (+ coluna `legacy_booking_id`) |
| `users`             | `profiles` (e opcionalmente `partners`) |

Depois da migração, o app usa apenas as tabelas do OS (`jobs`, `quote_bids`, `job_reports`, etc.) com `USE_MASTER_OS = true` e a mesma URL/anon key do projeto.

## Passos

### 1. Aplicar migrations no Supabase (Master OS)

Garanta que todas as migrations estão aplicadas, em especial:

- `018_unified_schema_legacy_staging.sql` — cria `legacy_booking`, `legacy_users` e `jobs.legacy_booking_id`
- `019_migrate_legacy_to_canonical.sql` — script que preenche `jobs` e `profiles` a partir dos dados legados

### 2. Exportar dados do banco antigo do app

No projeto Supabase (ou Postgres) **antigo** do app:

**Booking:**

```sql
COPY (
  SELECT id, service_type, service_description, address, latitude, longitude,
         date, time, customer_name, customer_phone, customer_email,
         price_labour, final_price, labour_id, status,
         "jobCompleted", "jobCancelled", zoho_job_id, created_at
  FROM booking
) TO STDOUT WITH (FORMAT csv, HEADER true);
```

Salve em `legacy_booking_export.csv`.

**Users (mínimo para migração):**

```sql
COPY (
  SELECT id, full_name, email, user_type, created_at
  FROM users
) TO STDOUT WITH (FORMAT csv, HEADER true);
```

Salve em `legacy_users_export.csv`.

(Se a tabela `users` tiver mais colunas, inclua só as que existem em `legacy_users`: id, full_name, email, user_type, created_at.)

### 3. Importar para as tabelas de staging no Supabase único

No projeto **Master OS** (Supabase único):

**3.1.** Criar as tabelas de staging (já criadas pela migration 018):

- `public.legacy_booking`
- `public.legacy_users`

**3.2.** Importar CSV pelo Supabase Dashboard (Table Editor → Import) ou via SQL:

- **legacy_booking:** colunas na ordem: id (opcional, pode ser serial), service_type, service_description, address, latitude, longitude, date, time, customer_name, customer_phone, customer_email, price_labour, final_price, labour_id, status, "jobCompleted", "jobCancelled", zoho_job_id, created_at.  
  Se o CSV vier de outro formato, ajuste os nomes das colunas para bater com a tabela.

- **legacy_users:** colunas: id, full_name, email, user_type, created_at.

**3.3.** Se os usuários do app antigo **já existem** em `auth.users` neste mesmo projeto, não é obrigatório popular `legacy_users` para auth; use-o para preencher `partner_name` nos jobs migrados. Se o banco antigo era outro projeto, importe primeiro os usuários para `auth.users` (Supabase Auth) e depois preencha `legacy_users` com os mesmos id, full_name, email, user_type para a migração.

### 4. Rodar a migração legado → canônico

Depois de importar os CSV para `legacy_booking` e `legacy_users`, execute no SQL Editor:

```sql
SELECT public.run_legacy_data_migration();
```

A função é **idempotente**: pode rodar várias vezes sem duplicar (insere só o que ainda não foi migrado). Ela retorna algo como `{"profiles_inserted": 5, "jobs_inserted": 120}`.

- **Profiles:** só cria perfil para `legacy_users` cujo `id` já existe em `auth.users`. Se o app antigo usava outro Supabase, é preciso criar esses usuários em Auth (ou importar) antes.
- **Jobs:** insere em `jobs` a partir de `legacy_booking` e preenche `legacy_booking_id` para rastreio.

### 5. Conferência

- `SELECT COUNT(*) FROM legacy_booking` vs `SELECT COUNT(*) FROM jobs WHERE legacy_booking_id IS NOT NULL`.
- Verificar alguns jobs: `SELECT id, reference, title, client_name, partner_name, status, legacy_booking_id FROM jobs WHERE legacy_booking_id IS NOT NULL LIMIT 20`.

## Estrutura canônica (resumo)

| Tabela | Uso |
|--------|-----|
| **profiles** | Usuários (auth + perfil OS/app). |
| **jobs** | Ordens de serviço; app usa `partner_id` = id do parceiro (auth); `legacy_booking_id` = id antigo em `booking`. |
| **clients** / **client_addresses** | Clientes e endereços (OS). |
| **quotes** / **quote_bids** | Orçamentos e lances do app. |
| **job_reports** | Relatórios por fase enviados pelo app. |
| **legacy_booking** / **legacy_users** | Staging para import; após migração podem ficar só para histórico. |

Depois da migração, você pode manter as tabelas `legacy_booking` e `legacy_users` só para histórico ou removê-las quando não precisar mais.
