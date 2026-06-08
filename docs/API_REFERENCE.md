# Master OS — API reference

Inventário completo das rotas REST sob `src/app/api/`. Cada secção agrupa rotas pelo seu papel funcional. Para detalhes de body/response, abre o `route.ts` correspondente — a maioria tem JSDoc no topo.

> Para deep-dive (request/response examples) das rotas de Quotes e Stripe ver [`docs/API.md`](API.md).

Convenções de autenticação:

- **session** → cookie de utilizador OS (`requireAuth`), dashboard
- **role-gated** → session + check de `profiles.role` (admin / manager / operator)
- **portal session** → cookie de portal user
- **bearer** → header `Authorization: Bearer <token>` (app móvel)
- **API key** → header `X-API-Key` (integrações externas — Zendesk webhooks / Zoho / scripts)
- **signed token** → query/body `token=…` HMAC assinado (links públicos)
- **cron secret** → `Authorization: Bearer <CRON_SECRET>` (comparação constant-time)
- **public** → sem autenticação

---

## 1. Inbound webhooks (Zoho Desk / Zendesk)

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/webhooks/desk/quote-request` | POST | API key | Cria quote em modo `bid` ou `manual` a partir de um ticket. Em `bid`, push-notifica partners cujos trades batem com `service_type`. |
| `/api/webhooks/desk/quote-created` | POST | API key | Espelha o ticket numa `service_requests` com `source='zendesk'` + `external_ref=ticket_id`. |
| `/api/webhooks/desk/job-created` | POST | API key | Cria job a partir de ticket. `assignment_mode: "auto"` → match de partners ativos por `service_type` → `status='auto_assigning'`. |

---

## 2. API externa (integrações)

Para Zendesk webhooks e scripts. Header obrigatório: `X-API-Key`.

> Create Job (macro Move to Job): [`docs/zendesk-create-job-webhook.md`](zendesk-create-job-webhook.md)

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/quotes` | POST | API key | Cria quote draft. Apenas `account_id` + `title` obrigatórios. Quando `ticket_id` enviado → guarda `external_source='zendesk'` + `external_ref`. Idempotente por ticket. |
| `/api/jobs` | POST | API key | Cria job (ou converte uma quote linkada se `ticket_id` já existir). Quando criado via Zendesk → posta confirmação no ticket principal + flip `custom_status_id`. |
| `/api/internal/zendesk/sync-status` | POST | API key | Sincroniza `custom_status_id` do ticket com o status interno do job/quote + dispara notificações de ciclo de vida. |

---

## 3. Página pública `/join` (cadastro de partner)

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/join/register` | POST | público (rate-limited por IP) | Cria auth user + linha `partners` + upload de 4 documentos obrigatórios (Photo ID, Public Liability, Proof of Address, Right to Work). Valida MIME + tamanho (10 MB max). 5 tentativas/IP/10 minutos. |

---

## 4. Portal do cliente (`/portal/*`)

### Autenticação

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/portal/auth/magic-link` | POST | público | Envia magic link Supabase se o email estiver registado. Resposta opaca (não vaza se email existe). |
| `/api/portal/auth/verify-otp` | POST | público | Cola do OTP de 6 dígitos em vez do click no link. |
| `/api/portal/auth/sign-out` | POST | portal session | Form action no sidebar do portal. |

### Conta + assets

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/portal/account` | PATCH | portal session | Atualiza campos restritos do account (contact_name, finance_email, contact_number, addresses…). |
| `/api/portal/assets` | GET, POST | portal session | Listar / criar properties do account. |
| `/api/portal/assets/[id]` | GET, PATCH | portal session | Detalhe + edição de uma property. |
| `/api/portal/property-documents/[docId]` | GET | portal session | Redirect 302 para signed URL de um documento. |

### Tickets, requests, quotes

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/portal/tickets` | POST | portal session | Cria ticket + primeira mensagem num só shot. Notifica equipa interna. |
| `/api/portal/tickets/[id]/messages` | POST | portal session | Portal user adiciona mensagem. Notifica `support@getfixfy.com` + staff member assignado. |
| `/api/portal/requests` | POST | portal session (multipart) | Cria `service_requests` (serviceType, descrição, propertyId, desiredDate, images[]). |
| `/api/portal/quotes/[id]/respond` | POST | portal session | Wrapper autenticado para `/api/quotes/respond`. |

---

## 5. App móvel do partner (`/app/*`)

Chamadas pela app React Native.

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/app/contracts/status` | GET | bearer | Quais contratos o partner autenticado ainda precisa assinar. |
| `/api/app/contracts/sign` | POST | bearer | Assina contrato (signature base64 → Storage + record imutável com IP/device/timestamps). |
| `/api/app/partner-cancel-job` | POST | bearer | Partner cancela job. Roda RPC `partner_cancel_job` (invalida invoices/self-bills). |
| `/api/app/partner-cancel-notify` | POST | bearer | Pós-cancelamento: envia email à equipa interna. |

---

## 6. Partner Upload Portal (`/partner-upload/*`)

Link público gerado pelo admin para um partner submeter documentos sem precisar criar conta.

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/partner-upload/session` | GET | signed token | Resolve token → metadata do request + branding. |
| `/api/partner-upload/info` | GET | signed token | Campos do perfil que o partner pode ver/editar. |
| `/api/partner-upload/profile` | PATCH | signed token | Atualiza colunas whitelisted do `partners` (allowlist estrita). |
| `/api/partner-upload/upload` | POST | signed token (multipart) | Upload de documento (cria/substitui linha em `partner_documents`). Path seguro derivado do MIME. |
| `/api/partner-upload/file` | POST | signed token (multipart) | Upload genérico (signatures, fotos auxiliares). |
| `/api/partner-upload/document` | DELETE | signed token | Remove documento do partner. |

---

## 7. Quotes — interações públicas

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/quotes/respond-info` | GET | signed token | Summary da quote para a página pública de Accept/Reject. |
| `/api/quotes/respond` | POST | signed token | Cliente aceita ou rejeita. Em accept com `deposit_required > 0` → cria job + invoice de depósito + Stripe payment link. |
| `/api/quotes/submit-bid` | POST | signed token | Partner submete bid. Token vincula `(quoteId, partnerId)`. |
| `/api/quotes/submit-report` | POST | signed token | Partner submete report (start + final) através do link público. |

---

## 8. Quotes — operações no dashboard

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/quotes/send-pdf` | GET, POST | session | **GET**: stream do PDF (preview ou `?download=1`). **POST**: gera PDF + envia ao cliente. **Roteia por Zendesk** quando a quote tem `external_ref`; só usa Resend quando não há ticket. Após envio: `status='awaiting_customer'` + portal users notificados. |
| `/api/quotes/email-preview` | GET, POST | session | HTML do email que será enviado (preview). |
| `/api/quotes/preview-links` | GET | session | Devolve URLs Accept/Reject que vão ser enviadas (preview). |
| `/api/quotes/partner-invite-email` | POST | session | Envia email a partners convidados a fazer bid. |
| `/api/quotes/[id]/invited-partners` | GET | session | Partners convidados + cada link único + estado dos bids. |
| `/api/quotes/[id]/partner-bid-link` | GET | session | URL público de bid para um partner específico. |

---

## 9. Jobs

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/jobs/[id]/final-review-email` | POST | session | Email final (job concluído) para o cliente com PDFs de report anexos. **Roteia por Zendesk** quando o job tem `external_ref`. Marca `review_sent_at` + `review_send_method`. |
| `/api/jobs/[id]/notify-partner-zendesk` | POST | role-gated | Push + abre/responde Side Conversation Zendesk para o partner. `kind: "on_hold"` também flippa `custom_status_id` para `5679178036127`. |
| `/api/jobs/[id]/partner-report-link` | GET | session | URL público para o partner atual submeter o report. |
| `/api/jobs/[id]/send-partner-report-link` | POST | session | Envia o link acima ao partner (Side Conversation se Zendesk-linked, senão email). |
| `/api/jobs/[id]/reports/[kind]/approve` | POST | session | Marca `<kind>_report_approved_at/by`. `kind` é `start` ou `final`. |
| `/api/jobs/[id]/reports/pdf` | GET | session | Stream do PDF combinado (start + final report) com fotos via signed URLs. |
| `/api/jobs/[id]/zendesk-link` | POST | session | Liga/desliga o job a um ticket (`external_source` + `external_ref`). |
| `/api/jobs/[id]/zendesk-events` | GET | session | Log de push + side-conversation events, mais recentes primeiro. |
| `/api/jobs/[id]/sync-zendesk-status` | POST | session | Manual: força sync do `custom_status_id` do ticket. |
| `/api/jobs/analyze-report` | POST | session | LLM analisa o report (issues, riscos, sumário). |

---

## 10. Partners

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/partners/[id]/request-documents` | POST | session | Envia email ao partner a pedir documentos em falta (com link Partner Upload). |
| `/api/partner-documents/suggest-expiry` | POST | session (multipart) | OCR/AI: extrai data de expiry de uma imagem de certificado. |
| `/api/push/notify-partner` | POST | role-gated | Push manual para um partner ou grupo via Expo. |

---

## 11. Invoices

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/invoices/[id]/pdf` | GET | session | Stream do PDF da invoice. |
| `/api/invoices/[id]/due-date` | PATCH | session | Atualiza `due_date` + audit log com motivo (min 10 chars). Bloqueado para paid/cancelled. |
| `/api/admin/invoices/recalculate-due-dates` | POST | admin | Recalcula `due_date` para todas invoices não pagas baseado em `payment_terms`. Suporta `dryRun`. |

---

## 12. Self-bills

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/self-bills/[id]/pdf` | GET | session | Stream do PDF do self-bill. |
| `/api/self-bills/[id]/due-date` | PATCH | session | Atualiza `due_date` em qualquer status (com motivo + audit). |
| `/api/self-bills/backfill-from-jobs` | POST | session | Cria self-bills semanais a partir de jobs com partner mas sem `self_bill_id`. Agrupa por (partner, ISO week). |
| `/api/self-bills/close-week` | POST | session | Fecha a semana: promove drafts → pending + recalcula totais. |
| `/api/admin/selfbills/full-sync` | POST | admin | Sync agressivo: linka todos os jobs aprovados e recompõe self-bills da raíz. |
| `/api/admin/selfbills/recalculate-due-dates` | POST | admin | Recomputa `due_date` para todos os self-bills não pagos. |

---

## 13. Stripe

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/stripe/create-payment-link` | POST | session | Cria payment link para uma invoice (deposit, partial, full). |
| `/api/stripe/check-status` | POST | session | Verifica status atual de um payment intent / link. |
| `/api/stripe/webhook` | POST | Stripe signature | Recebe events → marca invoices pagas + dispara follow-ups. |

---

## 14. Admin / staff (dashboard)

### Team / users

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/admin/team/invite` | POST | admin | Envia invite Supabase + cria linha `profiles`. |
| `/api/admin/team/create-user` | POST | admin | Cria user interno com password temporária + flag `must_change_password`. |
| `/api/admin/team/change-own-password` | POST | session | User troca a sua própria password — limpa a flag. |
| `/api/admin/team/user/[id]` | PATCH, DELETE | admin | Atualiza role/is_active/reset password OU remove user. |
| `/api/admin/account/invite-portal-user` | POST | admin/manager | Magic-link Supabase para um portal user de um account. |

### Partner admin tools

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/admin/partner/portal-link` | POST | admin | Cria URL Partner Upload time-limited (signed token). |
| `/api/admin/partner/send-email` | POST | session | Email manual ao partner com texto livre. |
| `/api/admin/partner/reset-password` | POST | admin (rate-limited) | Reset password do partner (mobile app account). |
| `/api/admin/partner/update-email` | POST | admin | Atualiza email auth do partner. |
| `/api/admin/partner/sync-app-user` | POST | admin | Garante linha em `public.users` (mobile app profile) para um partner. Idempotente. |

### Branding / outreach / tickets / catalog

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/admin/branding/upload` | POST | admin (multipart) | Upload de logo/favicon/email-header para bucket `company-branding`. |
| `/api/admin/outreach/campaigns` | GET | admin | Lista campanhas de outreach (prospecção). |
| `/api/admin/outreach/campaigns/[id]` | GET | admin | Detalhe da campanha + receivers + sends. |
| `/api/admin/outreach/send` | POST | admin | Envia/agenda batch de emails de outreach via Resend. |
| `/api/admin/outreach/templates` | GET, POST | admin | CRUD básico de templates. |
| `/api/admin/outreach/templates/[id]` | PUT, DELETE | admin | Atualizar / remover template. |
| `/api/admin/tickets/[id]` | PATCH | staff | Atualiza metadata do ticket (status, assigned_to, priority, job_id). |
| `/api/admin/tickets/[id]/messages` | POST | staff | Resposta da staff num ticket. Notifica portal users do account. |
| `/api/admin/service-catalog/sync-canonical` | POST | admin | Garante todas as canonical types of work no catálogo. Idempotente. |

---

## 15. Cron jobs

Header obrigatório: `Authorization: Bearer <CRON_SECRET>` (comparação constant-time).

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/cron/daily-brief` | GET | cron secret | Gera e envia daily brief ao admin (resumo de KPIs do dia anterior). |
| `/api/cron/expand-recurrence-series` | GET | cron secret | Expande a próxima ocorrência de jobs recorrentes (PPM). |

---

## 16. AI

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/ai/chat` | GET, POST | role-gated | Fixfy Brain chat. Requer `OPENAI_API_KEY` + feature flag em `company_settings`. |

---

## 17. Misc / utilities

| Rota | Métodos | Auth | O que faz |
|---|---|---|---|
| `/api/public/company-branding` | GET | público | Logo + cores do tenant para telas pré-login (usa service role se configurado). |
| `/api/geocode/opencage` | POST | session | Geocoding UK via OpenCage. `{ q: "address" }` → `{ latitude, longitude }`. |

---

## Apêndice A — Status IDs do Zendesk

| Evento | `custom_status_id` |
|---|---|
| Quote enviada ao cliente | `5688280626847` |
| Job criado | `5688453749919` |
| Job em on_hold | `5679178036127` |

## Apêndice B — Linkagem Zendesk

Quando uma entidade do OS (`quotes`, `jobs`, `service_requests`) tem origem num ticket Zendesk:

```
external_source = 'zendesk'
external_ref    = '<ticket_id>'
```

O helper `getZendeskTicketId(entity)` em [`src/lib/zendesk.ts`](../src/lib/zendesk.ts) lê este par e devolve o ticket id ou null. Rotas customer-facing usam-no para decidir entre Zendesk e Resend:

```ts
const ticketId = getZendeskTicketId(entity);
if (ticketId && isZendeskConfigured()) {
  await sendCustomerCommentWithAttachments({ ticketId, htmlBody, attachments });
} else {
  // Resend fallback
}
```

## Apêndice C — Side Conversations vs comentários públicos

| Tipo | Quando usar | Destinatário |
|---|---|---|
| **Comentário público no ticket principal** | Comunicações para o **cliente** (quote enviada, job criado, completo) | Aparece como reply no thread original do cliente |
| **Side Conversation** | Comunicações para o **partner** (job assigned, on_hold, rescheduled, cancelled) | Email separado do thread principal, agentes do Zendesk veem na sidebar |

Tracking do partner: `jobs.zendesk_side_conversation_id` é populada na primeira call e reutilizada nas seguintes (reply no mesmo thread). Cada evento é registado em `job_zendesk_events`.

---

## Como manter este documento atualizado

Quando adicionares uma nova rota:

1. Adiciona JSDoc no topo do `route.ts` com método + path + descrição curta + body shape
2. Adiciona uma linha na tabela apropriada acima
3. Se for customer-facing e suportar Zendesk, documenta o `custom_status_id` no Apêndice A

Listagem rápida de todas as rotas existentes:

```bash
find src/app/api -name 'route.ts' -o -name 'route.tsx' | sort
```
