# Master OS — Diagrama de Arquitetura

## Visão Geral do Sistema

Master OS é uma plataforma de gestão operacional para empresas de serviços imobiliários, construída em **Next.js 16 App Router** com Supabase como backend.

---

## Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER / CLIENT                          │
│                                                                     │
│  ┌───────────────┐  ┌────────────────┐  ┌────────────────────────┐ │
│  │  React Pages  │  │  React         │  │  Hooks & Services      │ │
│  │  (App Router) │  │  Components    │  │  src/services/*.ts     │ │
│  │               │  │  UI / Layout   │  │  src/hooks/*.ts        │ │
│  └───────┬───────┘  └────────────────┘  └──────────┬─────────────┘ │
│          │                                          │               │
└──────────┼──────────────────────────────────────────┼───────────────┘
           │  Next.js SSR / RSC                        │  Supabase JS SDK
           │                                           │  (anon key + RLS)
           ▼                                           ▼
┌─────────────────────────┐              ┌─────────────────────────────┐
│  NEXT.JS API ROUTES     │              │  SUPABASE                   │
│  src/app/api/           │              │                             │
│                         │  service     │  ┌─────────────────────┐   │
│  POST /quotes/send-pdf  │─ role key ──▶│  │  PostgreSQL DB      │   │
│  GET  /quotes/send-pdf  │              │  │  (20+ tables)       │   │
│                         │              │  └─────────────────────┘   │
│  POST /stripe/          │              │                             │
│    create-payment-link  │              │  ┌─────────────────────┐   │
│  POST /stripe/          │              │  │  Auth (JWT)         │   │
│    check-status         │              │  │  Row Level Security │   │
│  POST /stripe/          │              │  └─────────────────────┘   │
│    webhook              │              │                             │
└────┬──────────┬─────────┘              └─────────────────────────────┘
     │          │
     │          │
     ▼          ▼
┌─────────┐ ┌────────┐
│  STRIPE │ │ RESEND │
│  API    │ │ Email  │
└─────────┘ └────────┘
```

---

## Diagrama de Fluxo de Autenticação

```
Usuário acessa qualquer rota
          │
          ▼
    middleware.ts
          │
    Sessão válida?
    ┌─────┴─────┐
   NÃO         SIM
    │           │
    ▼           ▼
redirect    Continua
/login      para a rota
    │
    ▼
  /login
  page.tsx
    │
  Supabase Auth
  (email/senha)
    │
    ▼
Cria sessão JWT
+ cookie httpOnly
    │
    ▼
redirect para /
(dashboard)
```

---

## Diagrama de Camadas (Layered Architecture)

```
┌──────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                  │
│                                                      │
│  Pages (App Router)          Components              │
│  ├─ / (dashboard)            ├─ dashboard/           │
│  ├─ /requests                │   ├─ stats-grid       │
│  ├─ /quotes                  │   ├─ revenue-chart    │
│  ├─ /jobs                    │   ├─ activity-feed    │
│  ├─ /schedule                │   ├─ pipeline-summary │
│  ├─ /clients                 │   ├─ priority-tasks   │
│  ├─ /partners                │   └─ quick-actions    │
│  ├─ /accounts                ├─ layout/              │
│  ├─ /pipelines/corporate     │   ├─ sidebar          │
│  ├─ /pipelines/partners      │   ├─ header           │
│  ├─ /finance/invoices        │   └─ page-header      │
│  ├─ /finance/selfbill        └─ ui/                  │
│  └─ /settings                    ├─ data-table       │
│                                   ├─ kanban-board    │
│                                   ├─ drawer / modal  │
│                                   ├─ audit-timeline  │
│                                   └─ kpi-card / ...  │
├──────────────────────────────────────────────────────┤
│  SERVICE LAYER  (src/services/)                      │
│                                                      │
│  accounts.ts   clients.ts    invoices.ts             │
│  auth.ts       company.ts    jobs.ts                 │
│  audit.ts      partners.ts   quotes.ts               │
│  requests.ts   base.ts                               │
│                                                      │
│  → Chamadas diretas ao Supabase JS SDK               │
│  → Tipagem via src/types/database.ts                 │
├──────────────────────────────────────────────────────┤
│  API LAYER  (src/app/api/)                           │
│                                                      │
│  /quotes/send-pdf   → PDF + e-mail (Resend)          │
│  /stripe/*          → Stripe SDK (chaves secretas)   │
├──────────────────────────────────────────────────────┤
│  DATA LAYER  (Supabase / PostgreSQL)                 │
│                                                      │
│  profiles            audit_logs                      │
│  service_requests    company_settings                │
│  quotes              clients                         │
│  jobs                pipeline_deals                  │
│  payment_links       activities                      │
│  partners            invoices                        │
│  partner_documents   self_bills                      │
│  partner_notes       accounts                        │
└──────────────────────────────────────────────────────┘
```

---

## Diagrama de Entidades (ERD Simplificado)

```
                        ┌──────────────┐
                        │   profiles   │
                        │  (auth.users)│
                        └──────┬───────┘
                               │ owner_id / created_by
              ┌────────────────┼────────────────────┐
              │                │                    │
              ▼                ▼                    ▼
    ┌─────────────────┐ ┌────────────┐    ┌──────────────┐
    │ service_requests│ │   quotes   │    │    jobs      │
    │                 │ │            │    │              │
    │ REQ-YYYY-NNNN   │ │ QT-YYYY-NN │    │ JOB-NNNNN    │
    └────────┬────────┘ └─────┬──────┘    └──────┬───────┘
             │ converted to   │ leads to          │
             └───────────────▶┘                   │
                                                  │
                     ┌────────────────────────────┤
                     │                            │
                     ▼                            ▼
            ┌─────────────────┐       ┌──────────────────┐
            │    invoices     │       │    partners       │
            │                 │       │                   │
            │ INV-YYYY-NNN    │       │  partner_id (FK) │
            │ stripe_link_id  │       └────────┬──────────┘
            └─────────────────┘                │
                                    ┌──────────┴──────────┐
                                    │                     │
                                    ▼                     ▼
                         ┌──────────────────┐  ┌─────────────────┐
                         │partner_documents │  │  partner_notes  │
                         └──────────────────┘  └─────────────────┘

    ┌──────────────┐       ┌───────────────┐
    │   accounts   │       │pipeline_deals │
    │  (corporate) │──────▶│  (B2B Kanban) │
    └──────────────┘       └───────────────┘

    ┌──────────────┐       ┌───────────────┐
    │   clients    │       │  self_bills   │
    │ (individual) │       │ (payout B2B)  │
    └──────────────┘       └───────────────┘

    ┌──────────────────┐   ┌──────────────────┐
    │   audit_logs     │   │company_settings  │
    │ (imutável, todos)│   │  (linha única)   │
    └──────────────────┘   └──────────────────┘
```

---

## Fluxo de Pagamento (Stripe)

```
/finance/invoices
      │
      │ Usuário clica "Criar Link de Pagamento"
      ▼
POST /api/stripe/create-payment-link
      │
      ├─▶ Stripe: cria Product + Price + PaymentLink
      │
      └─▶ Supabase: salva paymentLinkUrl na fatura
               │
               ▼
       Usuário compartilha link com cliente
               │
               ▼
       Cliente acessa checkout.stripe.com
               │
               ▼
      Stripe dispara webhook ──▶ POST /api/stripe/webhook
                                       │
                                       ├─ checkout.session.completed
                                       │   └─▶ invoice.status = 'paid'
                                       │
                                       ├─ payment_intent.succeeded
                                       │   └─▶ invoice.status = 'paid'
                                       │
                                       └─ payment_intent.payment_failed
                                           └─▶ invoice.stripe_payment_status = 'failed'

      Usuário clica "Verificar Status" (polling manual)
               │
               ▼
      POST /api/stripe/check-status
               │
               └─▶ Stripe: lista Checkout Sessions
                       │
                       └─▶ Supabase: atualiza status da fatura
```

---

## Fluxo de Orçamento (Quote)

```
/quotes
   │
   │ Cria orçamento (status: draft)
   ▼
Supabase: INSERT quotes
   │
   │ Status progride:
   │ draft → partner_bidding → ai_review → sent → approved/expired
   ▼
Usuário clica "Enviar PDF"
   │
   ▼
POST /api/quotes/send-pdf
   │
   ├─▶ @react-pdf/renderer: gera PDF em memória
   │
   ├─▶ Resend: envia e-mail com PDF anexo
   │
   ├─▶ Supabase: atualiza quote.status = 'sent'
   │
   └─▶ Supabase: INSERT audit_logs (action: 'status_changed')

GET /api/quotes/send-pdf?quoteId=xxx
   │
   └─▶ Retorna PDF binário (visualização/download direto)
```

---

## Stack Tecnológica

| Categoria | Tecnologia | Versão |
|---|---|---|
| Framework | Next.js | 16 (App Router) |
| UI | React | 19 |
| Estilização | Tailwind CSS | v4 |
| Animações | Framer Motion | v12 |
| Ícones | Lucide React | ^0.577 |
| Gráficos | Recharts | v3 |
| Banco / Auth | Supabase (PostgreSQL) | v2 |
| Pagamentos | Stripe | v20 |
| E-mail | Resend | v6 |
| PDF | @react-pdf/renderer | v4 |
| Mapas | Mapbox GL + Geocoder | v3/v5 |
| Datas | date-fns | v4 |
| Notificações | Sonner | v2 |
| Deploy | Vercel (recomendado) | — |

---

## Estrutura de Pastas

```
master-os/
├── docs/                        ← Esta pasta (documentação)
│   ├── API.md
│   └── ARCHITECTURE.md
├── public/                      ← Assets estáticos
├── src/
│   ├── app/
│   │   ├── (auth)/login/        ← Rota de autenticação
│   │   ├── (dashboard)/         ← Rotas protegidas
│   │   │   ├── page.tsx         ← /
│   │   │   ├── requests/
│   │   │   ├── quotes/
│   │   │   ├── jobs/
│   │   │   ├── schedule/
│   │   │   ├── clients/
│   │   │   ├── partners/
│   │   │   ├── accounts/
│   │   │   ├── pipelines/
│   │   │   │   ├── corporate/
│   │   │   │   └── partners/
│   │   │   ├── finance/
│   │   │   │   ├── invoices/
│   │   │   │   └── selfbill/
│   │   │   └── settings/
│   │   └── api/                 ← API Routes (server-side)
│   │       ├── quotes/send-pdf/
│   │       └── stripe/
│   │           ├── create-payment-link/
│   │           ├── check-status/
│   │           └── webhook/
│   ├── components/
│   │   ├── dashboard/           ← Widgets do dashboard
│   │   ├── layout/              ← Sidebar, Header, etc.
│   │   ├── shared/              ← KanbanBoard
│   │   └── ui/                  ← Design system (Button, Card, etc.)
│   ├── hooks/                   ← React hooks customizados
│   ├── lib/
│   │   ├── supabase/            ← Clientes Supabase (client/server)
│   │   ├── stripe.ts            ← Instância Stripe
│   │   ├── pdf/                 ← Template PDF de orçamento
│   │   └── utils.ts             ← Utilitários gerais
│   ├── services/                ← Camada de acesso a dados
│   └── types/database.ts        ← Tipos TypeScript do banco
├── supabase/
│   ├── migrations/              ← 001..007 SQL migrations
│   └── seed.sql                 ← Dados de exemplo
├── middleware.ts                ← Auth guard (todas as rotas)
└── .env.local                   ← Variáveis de ambiente
```
