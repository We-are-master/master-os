# Master OS — Documentação de API

> **Base URL:** `http://localhost:3000` (dev) / `https://<seu-domínio>` (prod)  
> Todas as rotas de API exigem autenticação via sessão Supabase (cookie), exceto o webhook do Stripe.  
> **Postman:** Collection pronta em [`docs/Master-OS-API.postman_collection.json`](Master-OS-API.postman_collection.json) — importe no Postman para testar todas as APIs.

---

## Índice

- [Quotes](#quotes)
  - [POST /api/quotes/send-pdf](#post-apiquotessend-pdf)
  - [GET /api/quotes/send-pdf](#get-apiquotessend-pdf)
- [Stripe — Pagamentos](#stripe--pagamentos)
  - [POST /api/stripe/create-payment-link](#post-apistripecreate-payment-link)
  - [POST /api/stripe/check-status](#post-apistripecheck-status)
  - [POST /api/stripe/webhook](#post-apistripewebhook)

---

## Quotes

### `POST /api/quotes/send-pdf`

Gera um PDF do orçamento e o envia por e-mail via **Resend**. Atualiza o status do orçamento para `"sent"` e registra uma entrada no `audit_logs`.

#### Request

```http
POST /api/quotes/send-pdf
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `quoteId` | `string` | ✅ | UUID do orçamento no Supabase |
| `recipientEmail` | `string` | — | E-mail do destinatário (usa o do orçamento se omitido) |
| `recipientName` | `string` | — | Nome do destinatário |
| `notes` | `string` | — | Notas adicionais incluídas no PDF |
| `items` | `array` | — | Itens a serem exibidos no orçamento (sobrescreve os do banco) |

**Estrutura de `items`:**
```json
[
  {
    "description": "Serviço de instalação",
    "quantity": 2,
    "unitPrice": 150.00,
    "total": 300.00
  }
]
```

#### Response `200 OK`

```json
{
  "pdfGenerated": true,
  "emailSent": true,
  "emailId": "re_abc123xyz",
  "sentTo": "cliente@exemplo.com"
}
```

#### Erros

| Status | Motivo |
|---|---|
| `400` | `quoteId` ausente |
| `404` | Orçamento não encontrado no Supabase |
| `500` | Falha na geração do PDF ou no envio de e-mail |

---

### `GET /api/quotes/send-pdf`

Retorna o PDF do orçamento diretamente como binário para visualização ou download no navegador.

#### Request

```http
GET /api/quotes/send-pdf?quoteId=<uuid>
```

| Query Param | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `quoteId` | `string` | ✅ | UUID do orçamento |

#### Response `200 OK`

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="quote-QT-2026-0901.pdf"
```

Body: binário PDF.

#### Erros

| Status | Motivo |
|---|---|
| `400` | `quoteId` ausente |
| `404` | Orçamento não encontrado |
| `500` | Falha na geração do PDF |

---

## Stripe — Pagamentos

### `POST /api/stripe/create-payment-link`

Cria um **Produto + Preço + PaymentLink** no Stripe para uma fatura e persiste a URL do link de volta no Supabase (`invoices.stripe_payment_link_url`).

#### Request

```http
POST /api/stripe/create-payment-link
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `invoiceId` | `string` | ✅ | UUID da fatura no Supabase |
| `amount` | `number` | ✅ | Valor em GBP (convertido para pence internamente) |
| `clientName` | `string` | ✅ | Nome do cliente para o produto no Stripe |
| `reference` | `string` | ✅ | Referência da fatura (ex.: `INV-2026-101`) |
| `customerEmail` | `string` | — | E-mail pré-preenchido no checkout do Stripe |

#### Response `200 OK`

```json
{
  "paymentLinkId": "plink_abc123",
  "paymentLinkUrl": "https://buy.stripe.com/abc123"
}
```

#### Erros

| Status | Motivo |
|---|---|
| `400` | Campos obrigatórios ausentes |
| `500` | Falha na criação do link no Stripe ou atualização no Supabase |

---

### `POST /api/stripe/check-status`

Consulta as **Checkout Sessions** do Stripe para um link de pagamento e atualiza o status da fatura no Supabase (`invoices.stripe_payment_status`, `invoices.stripe_paid_at`).

#### Request

```http
POST /api/stripe/check-status
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `invoiceId` | `string` | ✅ | UUID da fatura no Supabase |
| `paymentLinkId` | `string` | ✅ | ID do PaymentLink no Stripe (ex.: `plink_abc123`) |

#### Response `200 OK`

```json
{
  "paymentStatus": "paid",
  "paidAt": "2026-03-07T14:30:00Z",
  "sessionsCount": 1,
  "latestSessionStatus": "complete",
  "latestPaymentStatus": "paid",
  "customerEmail": "cliente@exemplo.com"
}
```

**Valores possíveis de `paymentStatus`:** `none` | `pending` | `paid` | `expired` | `failed`

#### Erros

| Status | Motivo |
|---|---|
| `400` | `invoiceId` ou `paymentLinkId` ausentes |
| `500` | Falha na consulta ao Stripe ou atualização no Supabase |

---

### `POST /api/stripe/webhook`

Recebe eventos de webhook do Stripe e sincroniza o status das faturas no Supabase. **Não requer autenticação de sessão** — usa verificação de assinatura HMAC via `STRIPE_WEBHOOK_SECRET`.

#### Request

```http
POST /api/stripe/webhook
Content-Type: application/json
stripe-signature: t=...,v1=...
```

Body: payload de evento Stripe (raw JSON).

#### Eventos Tratados

| Evento Stripe | Ação no Supabase |
|---|---|
| `checkout.session.completed` | Atualiza `invoices.status = 'paid'`, `stripe_payment_status = 'paid'`, `stripe_paid_at` |
| `payment_intent.succeeded` | Atualiza `invoices.status = 'paid'`, `stripe_payment_status = 'paid'`, `stripe_paid_at` |
| `payment_intent.payment_failed` | Atualiza `invoices.stripe_payment_status = 'failed'` |

#### Response `200 OK`

```json
{ "received": true }
```

#### Erros

| Status | Motivo |
|---|---|
| `400` | Assinatura inválida ou payload malformado |
| `500` | Erro ao processar o evento |

---

## Variáveis de Ambiente Necessárias

| Variável | Usado em |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Todos os serviços (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Todos os serviços (client-side) |
| `SERVICE_ROLE_KEY` | Todas as rotas de API (Supabase server-side) |
| `STRIPE_SECRET_KEY` | `/api/stripe/*` |
| `STRIPE_WEBHOOK_SECRET` | `/api/stripe/webhook` |
| `RESEND_API_KEY` | `/api/quotes/send-pdf` |
| `RESEND_FROM_EMAIL` | `/api/quotes/send-pdf` |
| `NEXT_PUBLIC_APP_URL` | Geração de URLs absolutas |
