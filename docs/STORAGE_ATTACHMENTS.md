# Storage e anexos (Supabase Storage)

Mapeamento dos buckets e onde cada tipo de arquivo é usado no Master OS (e no app de parceiros).

## Buckets (migration `025_storage_buckets_attachments.sql`)

| Bucket               | Público | Limite  | Tipos permitidos | Uso |
|----------------------|--------|---------|-------------------|-----|
| **partner-documents** | Não    | 10 MB   | PDF, JPEG/PNG/Webp/GIF, Word | Documentos do parceiro (seguro, certificação, contrato, fiscal, etc.) |
| **job-reports**      | Não    | 10 MB   | PDF, JPEG/PNG/Webp/GIF | Fotos e PDFs dos relatórios de fase do job (app ou OS) |
| **company-assets**   | Sim    | 5 MB    | JPEG/PNG/Webp/SVG/GIF | Logos (empresa em `company_settings`, contas em `accounts.logo_url`) |
| **quote-pdfs**       | Não    | 5 MB    | PDF | Cópias armazenadas de PDFs de quotes (opcional) |

---

## Onde cada bucket é usado

### 1. `partner-documents`

- **Tabela:** `partner_documents`
- **Colunas:** `file_url`, `file_name`
- **Quem sobe:** Dashboard OS (staff) ao anexar documento a um parceiro.
- **Sugestão de path no bucket:** `{partner_id}/{document_id}/{file_name}`  
  Ex.: `a1b2c3.../d4e5f6.../insurance-cert.pdf`
- **Fluxo:** Upload no OS → gravar em `storage.partner-documents` → atualizar `partner_documents.file_url` (e `file_name`). Para leitura, usar signed URL se o bucket for privado.

### 2. `job-reports`

- **Tabela:** `job_reports`
- **Colunas:** `images` (jsonb array de URLs), `pdf_url` (text)
- **Quem sobe:** App (parceiro) ao enviar relatório por fase, ou OS ao anexar manualmente.
- **Sugestão de path:** `{job_id}/{report_id}/phase-{n}/{filename}` ou `{job_id}/{report_id}/report.pdf`  
  Ex.: `job-uuid/report-uuid/phase-1/photo1.jpg`, `.../report.pdf`
- **Fluxo:** App/OS faz upload → guardar URLs em `job_reports.images` e/ou `job_reports.pdf_url`. Usar signed URLs se o bucket for privado.

### 3. `company-assets`

- **Tabela:** `company_settings`
- **Coluna:** `logo_url`
- **Quem sobe:** Dashboard OS (Settings / branding).
- **Paths sugeridos:**
  - Empresa (Settings): `logo.png` ou `logo.{ext}` na raiz do bucket.
  - **Conta corporativa (Accounts):** `accounts/{account_id}/logo.{ext}` — upload no dashboard grava a URL pública em `accounts.logo_url`.
- Bucket público ⇒ `logo_url` pode ser a URL pública do Supabase (ex.: `https://...supabase.co/storage/v1/object/public/company-assets/...`).

### 4. `quote-pdfs`

- **Uso:** Opcional; para guardar uma cópia do PDF gerado ao enviar quote por email.
- **Path sugerido:** `{quote_id}/{reference}.pdf`
- Hoje o PDF é gerado sob demanda e enviado por email; não é obrigatório gravar aqui.

---

## RLS (resumo)

- **partner-documents, job-reports, quote-pdfs:** apenas usuários **authenticated** podem SELECT, INSERT, UPDATE e DELETE nos objetos do bucket.
- **company-assets:** leitura **pública** (SELECT para `public`); escrita apenas **authenticated** (INSERT, UPDATE, DELETE).

Serviços que usam **service role** (ex.: API routes server-side) ignoram RLS e podem ler/escrever em qualquer bucket.

---

## URLs públicas vs signed

- **company-assets:** bucket público ⇒ use a URL pública do objeto (ex.: `getPublicUrl`) para `logo_url`.
- **partner-documents e job-reports:** bucket privado ⇒ use `createSignedUrl()` (ou equivalente) com expiração ao exibir no dashboard ou no app.
- **quote-pdfs:** privado; signed URL quando precisar de download.

---

## Próximos passos (implementação no código)

1. **Partner documents:** na tela de documentos do parceiro, adicionar upload para `partner-documents` e preencher `partner_documents.file_url` / `file_name`.
2. **Job reports:** no app e/ou no OS, upload de imagens e PDF para `job-reports` e atualizar `job_reports.images` / `pdf_url`.
3. **Logo:** na página de Settings, upload para `company-assets` e salvar a URL pública em `company_settings.logo_url`.
4. (Opcional) Ao enviar quote por email, gravar cópia do PDF em `quote-pdfs` e, se quiser, guardar essa URL em uma coluna futura em `quotes`.
