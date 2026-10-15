# Master OS — Professional nomenclature

Date: 15 October 2026. Status: implementation submitted for review; plan retained as the decision record. UI copy: British English. Planning notes: Portuguese.

## 1. Objetivo e limites

Padronizar nomes, títulos, abas, ações, estados e descrições de ajuda do Master OS. Textos curtos na interface; explicações no ícone `!` existente. Preservar a organização atual, URLs, IDs de abas, permissões, filtros, fórmulas e comportamento. A implementação está em branch de revisão. Nenhuma migração de dados ou implantação em produção foi executada.

Escopo: todas as rotas do grupo `src/app/(dashboard)`, incluindo telas secundárias, painéis laterais, configurações e redirecionamentos. Portais públicos de clientes e parceiros não são redesenhados nesta fase; componentes compartilhados precisam de verificação de impacto nesses portais.

Base: inspeção estática do código local, não sessão autenticada em produção. A navegação persistida e os textos editáveis precisam ser comparados com a configuração real durante a implementação. O inventário anexo lista rotas e ocorrências de textos, com arquivo e linha; a extração não substitui a validação semântica de cada fluxo.

## 2. Achados que orientam a mudança

- `PageHeader` já converte `infoTooltip ?? subtitle` em `FixfyHintIcon`. Não acrescentar um parágrafo abaixo de todos os títulos: a estrutura desejada já existe.
- `FixfyHintIcon` já usa hover/foco, portal e modal por clique. Reutilizar e verificar acessibilidade em vez de criar uma segunda implementação.
- `Tabs` ainda não tem propriedade de descrição. Adicionar ajuda contextual sem colocar um botão interativo dentro de outro botão.
- Menu canônico em `src/lib/constants.ts`; configuração persistida passa por `mergeNewNavItems`. A função conserva labels existentes e associa grupos pelo label. Trocar apenas constantes não garante atualização dos nomes salvos.
- `/agents` e `/services` são abas de Settings; `/requests`, `/compliance`, `/ppm`, `/school` e `/leads` estão ocultos no menu. Não reapresentá-los como áreas novas.
- `/crm` é a área de leads comerciais; `/leads` é a distribuição de oportunidades para parceiros. Não dar o mesmo nome aos dois.
- Existem variações como Jobs / Jobs management, Financial / Finance, History / Activity / Timeline, além de português misturado com inglês.
- O modo financeiro chamado P&L usa recebíveis e pagamentos por vencimento, conforme `billing-cashflow-runway-copy.ts`. O novo rótulo deve indicar projeção, sem sugerir demonstração contábil realizada.
- `need_attention` aparece como Need attention em Schedule e Final check no detalhe do job. Confirmar o agrupamento atual e centralizar a apresentação, sem mudar o status gravado.
- Alguns textos explicam implementação: PropertyDrawer, job_payments, SB-INT e Apply migration 316. Remover essas referências da linguagem operacional, preservando instruções úteis.

## 3. Padrão editorial

- Navegação: 1–2 palavras quando suficientes; até 3 quando necessário para distinguir o conceito.
- Sentence case: `Final review`, `Payment history`, `Service rates`.
- Botões: ação explícita, como `Create job`, `Send quote`, `Record payment`.
- Abas nomeiam conteúdo; verbos ficam nas ações. `Commissions`, não `Run commission` como aba.
- Subtítulo/ajuda curta: idealmente 12–25 palavras, uma frase que explica a finalidade.
- Ajuda de indicadores: até duas frases curtas com base, período e exceção material. Uma explicação adicional pode ficar no modal, sem esconder limitações essenciais.
- Quantias e percentuais recebem nomes distintos: `Gross profit` (£) e `Gross margin` (%), quando correspondem ao cálculo real. Projeções são explicitamente identificadas.
- Não encurtar Awaiting payment para Payment quando isso remover o significado do estado.
- Manter termos operacionais estabelecidos: Job, Quote, Invoice, Self-bill, Partner. Não renomear documentos legais nem valores técnicos do banco.
- Nomes de pessoas, empresas, serviços cadastrados e títulos livres de jobs são conteúdo do usuário, não alvos de substituição global.

## 4. Navegação principal e ajuda no !

| Rota | Atual | Proposto | Descrição no ! |
|---|---|---|---|
| / | Pulse | Overview | Monitor job activity, revenue, costs and outstanding balances across the operation. |
| /operations/schedule | Schedule | Schedule | Plan job visits by day, week, month or year and filter by partner. |
| /schedule | Live view | Live operations | Track job progress, partner locations and daily routes across the operation. |
| /crm | Leads | Leads | Manage residential and business enquiries from first contact to conversion. |
| /quotes | Quotes | Quotes | Prepare customer quotes, review partner bids and track approval and payment. |
| /jobs | Jobs / Jobs management | Jobs | Manage assignments, visits, reports and payments throughout each job. |
| /accounts | Accounts | Accounts | Manage account relationships, contacts, agreed rates, jobs and invoices. |
| /clients | Clients | Clients | Manage individual client records, addresses and service history. |
| /partners | Partners | Partners | Manage service partners, documents, rates, job history and self-bills. |
| /people | Workforce | Workforce | Manage employees and contractors, including documents, schedules, pay and system access. |
| /finance/billing | Billing | Billing | Review customer invoices, partner self-bills and expected cash movements. |
| /finance/bills | Expenses / Bills & expenses | Expenses | Manage one-off and recurring expenses and track payment status. |
| /settings | Settings | Settings | Manage business settings, pricing, AI agents, users and access permissions. |

Schedule ocupa uma tela de calendário sem título duplicado por decisão explícita no código. Acrescentar a ajuda junto aos controles existentes, sem introduzir uma nova faixa vertical.

Accounts, Clients, Partners e Workforce continuam separados: não há equivalência entre essas entidades.

## 5. Overview: cards e modos

| Atual | Proposto | Diretriz de ajuda |
|---|---|---|
| Pulse | Overview | Visão agregada da operação; separar valores atuais de períodos filtrados. |
| CEO | Financial overview | Detalhamento financeiro restrito aos usuários que já têm acesso. |
| Operations | Operations | Distribuição dos jobs por etapa; documentar os estados incluídos. |
| Live Now | Active jobs | A regra inclui jobs agendados e pausados: não significa apenas técnicos trabalhando agora. |
| No Partner | Unassigned | Jobs que ainda precisam de parceiro, conforme a regra atual do componente. |
| Final Check | Final review | Trabalho aguardando revisão operacional antes de avançar. |
| This month | Period results | A legenda deve refletir o intervalo selecionado, não presumir mês atual. |
| To receive | Receivables | Saldos de faturas em aberto e vencidas, com exceções das plataformas explicadas. |
| Awaiting Payment | Outstanding | Explicar que o indicador inclui a exceção de plataformas após o vencimento. |
| Paid | Collected | Recebimentos no período, conforme a base utilizada pelo indicador. |
| Jobs Forecasting | Job forecast | Receita e custos projetados dos jobs incluídos no cenário. |
| Monthly Results | Monthly results | Padronização de capitalização; preservar base e período. |
| Needs Attention | Action required | Itens operacionais que exigem intervenção. |
| Operating Cost | Job costs | Custos de parceiros, materiais e despesas por job incluídos no cálculo. |
| Fixed Costs | Overheads | A regra também inclui contas pontuais: explicar a composição, sem afirmar que tudo é fixo. |
| Net Margin em £ | Projected result | Receita considerada menos custos dos jobs e despesas gerais; não apresentar como lucro realizado. |
| Net margin em % | Projected margin | Relação percentual do resultado projetado com a receita considerada. |

A meta mensal usa o mês corrente de Londres independentemente do filtro global: manter `Monthly target` e explicitar essa exceção no !. Auditar também gráficos, funil, maiores contas e modo financeiro antes de aprovar cada descrição.

## 6. Leads e distribuição

Leads comerciais: manter seletor B2C/B2B com ajuda `Residential enquiries` / `Business enquiries` sem alterar classificação.

| Contexto | Atual | Proposto | Descrição |
|---|---|---|---|
| B2C | Open | Open | Enquiries currently marked new, hot or contacted. |
| B2C | Hot | High interest | Enquiries currently marked as high interest. |
| B2C | In contact | Contacted | Enquiries where contact has been recorded. |
| B2C | Lost | Closed | Enquiries marked lost or unsubscribed. |
| B2C | All | All leads | All enquiries except those already converted to clients. |
| Detalhe | Overview | Overview | Review contact details and the current enquiry. |
| Detalhe | Timeline | Activity | Review recorded events and follow-up activity. |
| Importação B2B | Existing accounts | Accounts | Select existing accounts to import into the business pipeline. |
| Importação B2B | CSV list | CSV import | Import a list of business prospects from a CSV file. |
| /leads oculto | Leads | Partner offers | Review job opportunities offered to service partners. |

A aba All já exclui won: registrar explicitamente no tooltip. Não alterar o filtro para corresponder a uma interpretação nova do nome. As colunas do pipeline B2B dependem da configuração; mapear IDs e textos antes de migrar labels.

## 7. Quotes

| Aba atual | Proposta | Tooltip |
|---|---|---|
| New | Drafts | Quotes being prepared before progressing to partner bids or customer review. |
| Bidding | Sourcing | Quotes in partner bidding or survey stages. |
| Quote ready | Ready to send | Quotes ready for review before being sent to the customer. |
| Approval | Awaiting approval | Quotes awaiting the customer's decision. |
| Payment | Awaiting payment | Quotes awaiting the required customer payment. |
| Closed | Closed | Quotes that have reached a closed outcome. |

Detalhe: `Review & send` → `Proposal`; `New` → `Details`; `Bids` → `Partner bids`; `History` → `Activity`. Preservar presença condicional das abas. `Send quote` continua sendo ação separada.

Colunas: `AVG Bid` → `Average bid`; `SLA` → `Response deadline` apenas onde o campo representa bidding_sla; `Type of work` → `Service`; `Accounts` → `Account` em linha individual. Confirmar Drafts com a regra de draft antes de aplicar: se contiver entradas já submetidas que não são rascunhos, manter New.

## 8. Jobs e detalhe

| Aba atual | Proposta | Tooltip |
|---|---|---|
| Action required | Action required | Jobs requiring an operational action. Open a job to review the reason. |
| Scheduled | Scheduled | Jobs included in the scheduled queue under the current filters. |
| In progress | In progress | Jobs currently being carried out. |
| Final checks | Final review | Jobs awaiting review of completion details and reports. |
| Awaiting payment | Awaiting payment | Jobs awaiting customer payment under the current workflow. |
| Closed | Closed | Closed jobs, including the outcomes available in the status filter. |

Não confundir Closed com Completed: o agrupamento inclui resultados distintos.

Detalhe: manter `Details`, `Visits`, `Documents`, `Reports`, `Complaint`; `Setup` → `Settings`. Manter abas condicionais, inclusive Complaint e permissões de Settings.

Ações: `Swap partner` → `Change partner`; `Finish` → `Complete job`; `Copy pay link` → `Copy payment link`; `Add partner extra` → `Add partner charge`; `Request part of the balance` → `Request partial payment`. Cada confirmação deve explicar o efeito real antes de confirmar.

`CCZ` → `Congestion charge` somente onde representa a taxa da zona de congestionamento. Visitas extras devem esclarecer sua situação real no app do parceiro; não prometer relatórios e visibilidade que ainda não existem.

## 9. Accounts e Clients

Accounts: manter `Overview`, `Clients`, `Jobs`; `Finance` → `Invoices` se a aba continuar mostrando exclusivamente faturas. Ajuda: `Review invoices and balances linked to this account.` Se houver mais conteúdo financeiro na versão aplicada, manter Finance.

As seções Services, Rates e Portal já foram movidas para Overview: manter essa estrutura. Padronizar `Services`, `Service rates`, `Portal access`.

Clients: manter filtros `All`, `Active`, `VIP`, `Inactive`, `Blocked`; detalhes `Overview`, `History` → `Service history`, `Addresses`, `Edit` → `Details`. O histórico de serviços não deve ser confundido com log de eventos.

Ajudas: `Addresses` → `Manage service addresses linked to this client.`; `Service history` → `Review this client's jobs, quotes and requests.`; `Details` → `Update contact and client information.`

## 10. Partners

Lista: `Directory` permanece; `Team (App)` → `App users`. Explicar que se trata dos registros de usuários do app associados à rede de parceiros, não da Workforce interna.

Filtros: `All`, `Onboarding`, `Active`, `Inactive`. Não renomear Onboarding como Pending quando envolver etapas documentais.

Detalhe principal: manter `Overview`, `Documents`, `Finance`, `Jobs`, `Self-bills`.

- Overview: `Review partner details, trades, coverage and agreed rates.`
- Documents: `Review uploaded files, compliance records and contracts.`
- Finance: `Review the partner's financial information and balances.`
- Jobs: `Review jobs linked to this partner.`
- Self-bills: `Review self-billing documents issued for this partner's work.`

Subabas documentais: `Files`, `Compliance`, `Contracts`. Perfil do app: `Profile`, `Jobs`, `Location`, `Financial` → `Finance`, `Actions` → `Account actions`.

Outros: `Partner info` → `Details`; `Rate card` → `Service rates`; feedback `Good` → `Positive`; `Bad / poor` → `Complaint`. Não modificar o significado dos tipos gravados.

## 11. Workforce

Manter `Workforce` como distinção da rede Partners. Segmentos `All`, `Employees`, `Contractors`; estados `All`, `Onboarding`, `Active`, `Offboarded`.

Abas: `Profile`, `Documents`, `Schedule`, `Finance`, `Login details` → `Access`.

- Profile: `Review employment details, contact information and payment arrangements.`
- Documents: `Review required documents and their current status.`
- Schedule: `Manage the contractor's working schedule.`
- Finance: `Review service fees, commissions and payment records.`
- Access: `Manage linked system access and login details.`

Manter Schedule exclusivo para o tipo já suportado. Traduzir mensagens técnicas como SB-INT para `Contractor self-bill` no texto explicativo, mantendo número e referência do documento.

## 12. Billing, Expenses e histórico

| Atual | Proposta | Ajuda |
|---|---|---|
| To collect · receivables | Receivables | Outstanding customer invoice balances included in this view. |
| To pay · self-bills | Partner payables | Partner self-bills ready for payment with an outstanding balance. Excludes workforce self-bills, drafts and paid items. |
| Cash-Flow Runway | Cash forecast | Compare incoming and outgoing amounts using the selected forecast basis. |
| P&L (modo atual) | Due-date forecast | Open receivables minus self-bills and expenses due in each period. This is a forecast, not realised profit. |
| Accrual (modo atual) | Pipeline forecast | Project the running balance using pipeline revenue and the costs included in this scenario. |
| Cash (modo atual) | Cash movements | Past periods use recorded movements; current and future outgoings include projected amounts. |
| Em caixa | Closing balance | Opening balance plus incoming amounts minus outgoing amounts for the period. |
| Fortnight | Fortnight | Valores agrupados em períodos de duas semanas. |
| Self-bill history | Self-bill archive | Review paid, archived and rejected self-bills outside the active billing workflow. |

Manter Invoices e Self-bills distintos. Self-bill não é sinônimo de pagamento. `Settled` no histórico só será renomeado após verificar sua composição: não chamar itens rejeitados de pagos.

Detalhe de invoice: `Overview`, `Details`, `Stripe`, `Job`, `Activity`. Stripe permanece quando a aba mostra dados específicos desse provedor; não rebatizar como Card indiscriminadamente.

Detalhe de self-bill: `Details`, `Jobs`, `Invoices`, `Payment`, `Activity`. Filtro `Internal` → `Workforce` quando essa é a população real.

Expenses: título único `Expenses`; filtros `All`, `One-off`, `Recurring`, `Unpaid`, `Paid`, `Archived`. Ajuda de pagamento deve conservar a restrição atual de marcação manual por tipo de despesa.

Payroll & costs → `Payroll`; `Payroll staff` → `Staff costs`; `Recurring bills` → `Recurring expenses`; `Run commission` → `Commissions`. Explicar o conteúdo misto de salários, custos e comissões em cada aba.

`Pay run` → `Payment run`; `Payout` → `Payouts`. Não juntar as duas rotas nem tratá-las como sinônimos até confirmar o fluxo: são implementações distintas.

## 13. Settings: todas as abas principais

| Atual | Proposta | Descrição no ! |
|---|---|---|
| My profile | Profile | Update your personal details and account preferences. |
| AI & Daily brief | AI & briefs | Configure AI settings and scheduled daily summaries. |
| Setup | Business settings | Configure operating rules, finance defaults and document requirements. |
| Agents | AI agents | Manage AI agents and the guidance used in their conversations. |
| Services | Pricing | Manage service prices, labour rates, material costs and quote calculations. |
| Lead origins | Lead sources | Manage the sources used to classify incoming leads. |
| Navigation | Navigation | Configure menu labels, destinations and visibility. |
| Roles & permissions | Permissions | Define access and actions available to each role. |
| Users access | Users | Manage user accounts, invitations and access roles. |
| System | System | Configure company information, integrations and system preferences. |

Business settings: `Working calendar` → `Working hours`; manter `Operations`, `Finance`, `Partners`, `Workforce`.

Ajudas: Working hours — `Set office hours and operating days.`; Operations — `Set response deadlines, access charges, margins and job reasons.`; Finance — `Set statement preferences, platform fees and revenue targets.`; Partners — `Set payment schedules, partner levels and document requirements.`; Workforce — `Set document requirements for employees and contractors.`

Pricing: `Catalog` → `Catalogue`; `Labour`, `Materials`; `Quote` → `Estimator`; `Thin margin` → `Low margin`. Validar que Estimator continua sendo simulação e não criação de proposta. Tabela de serviços: `Manage` → `Services`; `Overview` permanece.

AI agents: manter nome próprio Harvey; `With customers` → `Customers`; `With partners` → `Partners`; `Prices` → `Pricing`. `Rules` → `Policies` quando o conteúdo são regras de negócio aplicáveis aos públicos, sem confundir com automações técnicas.

System: `Navigation (Sidebar)` → `Navigation`; `System configuration` → `System`. Fusos devem exibir London, New York etc. sem fixar GMT/EST durante todo o ano.

## 14. Telas secundárias, ocultas e redirecionamentos

| Rota/área | Nome proposto | Descrição no ! / tratamento |
|---|---|---|
| /requests | Requests | Review incoming service requests and their conversion into quotes or jobs. |
| /assets | Properties | Manage service locations linked to client accounts. |
| /assets/new | Add property | Add a service location and link it to an account. |
| /assets/[id] | Nome do imóvel preservado | Keep the service address visible; descriptive help must not replace operational address information. |
| /compliance | Certificates | Review property certificates, expiry dates and uploaded documents. |
| /ppm | Maintenance plans | Manage planned maintenance schedules for accounts and properties. |
| /tickets | Support | Manage support requests submitted through the client portal. |
| /activity | Audit log | Review recorded system actions and their timestamps. |
| /outreach | Email campaigns | Compose personalised emails, manage templates and review sent campaigns. |
| /marketing | Marketing | Review audience availability and campaign performance. |
| /marketing/ao-vivo | Campaign monitor | Monitor the selected campaign's delivery and outcomes. |
| /automation | Automation | Review work attributed to AI, system processes and the team. |
| /harvey-whatsapp | WhatsApp | Monitor conversations and take over from the AI agent when needed. |
| /agents/harvey | Harvey | Manage the guidance Harvey uses in customer and partner conversations. |
| /agents/rules | Redirecionamento preservado | Destino /agents?view=rules; usar Policies no conteúdo de destino. |
| /pipelines/corporate | Business pipeline | Track business prospects and sales stages. |
| /pipelines/partners | Partner onboarding | Track partner applications through onboarding. |
| /school | Training | Access operational training and learning progress. |
| /school/[phaseId] | Nome da etapa preservado | Review lessons and progress for this training stage. |
| /school/lesson/[lessonId] | Nome da aula preservado | Read the lesson and record your progress. |
| /school/[phaseId]/quiz | Assessment | Complete the assessment for this training stage. |
| /website-leads | Redirecionamento preservado | Destino /crm?side=b2c confirmado no código; não criar navegação duplicada. |
| /rules | Redirecionamento preservado | Destino /agents?view=rules; novo nome aplicado no destino. |
| /finance/invoices | Redirecionamento preservado | Novo nome aplicado em Billing. |
| /finance/selfbill | Redirecionamento preservado | Novo nome aplicado em Billing. |
| /finance/billing/invoices | Redirecionamento preservado | Manter tab=inv. |
| /finance/billing/selfbill | Redirecionamento preservado | Manter tab=sb e selfBillId. |

Outreach: `Compor` → `Compose`; `Templates` permanece; `Histórico` → `Sent campaigns`. Marketing monitor: uniformizar estados, datas e mensagens em inglês britânico. Tickets: `Mine` → `Assigned to me`; Open inclui andamento e espera do cliente, conforme filtro atual; explicar isso.

Requests: `All requests` → `All`; manter New, Approved e Not qualified; `Converted to quote` → `Quoted`, `Converted to job` → `Booked` somente se esses nomes não omitirem estados intermediários importantes. Preferir nomes originais quando a equivalência não for exata.

## 15. Glossário e invariantes

| Termo | Uso |
|---|---|
| Account | Relação comercial/conta; não o endereço do imóvel. |
| Client | Registro de cliente individual. |
| Contact | Pessoa de contato; não sinônimo automático de Client. |
| Property | Local físico de execução do serviço. |
| Partner | Prestador da rede operacional. |
| Workforce | Funcionários e contratados internos. |
| User | Identidade com acesso ao sistema. |
| Lead | Potencial cliente no fluxo comercial. |
| Partner offer | Oportunidade enviada a parceiro. |
| Quote | Proposta/orçamento ao cliente. |
| Bid | Oferta de preço do parceiro. |
| Job | Ordem de serviço. |
| Visit | Visita vinculada a um job. |
| Invoice | Documento de cobrança ao cliente. |
| Self-bill | Documento de autofaturamento ao prestador. |
| Payment | Movimento/registro de pagamento; indicar recebido ou enviado quando necessário. |
| Activity | Eventos de uma entidade. |
| Service history | Histórico de serviços de um cliente. |
| Audit log | Registro geral de ações do sistema. |

Não usar uma substituição global para History, Finance, Setup, Lead, Client ou Account: o novo texto depende do contexto.

## 16. Arquitetura de implementação

1. Criar um catálogo pequeno de copy por domínio, com IDs estáveis, labels e hints. Reutilizar as fontes de status já existentes antes de adicionar outras.
2. Aplicar PageHeader.infoTooltip e FixfyHintIcon nas telas sem ajuda. Manter o calendário e telas de mapa compactos.
3. Estender Tabs com hint opcional. Ícone de ajuda deve ser irmão do controle da aba, sem botão dentro de botão; preservar navegação e semântica acessível.
4. Reutilizar FixfyHintIcon para cards/colunas complexos; evitar ! em todas as palavras ou ações evidentes. Para uma aba simples, pode haver um ! contextual da aba ativa.
5. Separar os textos visíveis dos valores de status, query params e IDs persistidos.
6. Inventariar labels salvos em admin_config antes de qualquer migração. Fazer snapshot e migração idempotente por href/ID, atualizando apenas labels legados conhecidos e preservando customizações deliberadas.
7. Não renomear grupos do menu indiscriminadamente: mergeNewNavItems usa label como chave. Se necessário, migrar grupos com mapa explícito e proteção contra duplicação.
8. Revisar títulos editáveis do dashboard: padrões novos não podem sobrescrever personalização automaticamente.
9. Revisar links, breadcrumbs, busca global, seletores, exportações e estados vazios que repetem os termos alterados.
10. Não alterar nomes de serviços comerciais, documentos emitidos, email templates ou portais externos automaticamente como efeito desta fase.

## 17. Entregas e ordem

### Lote 1 — Fundamentos
Catálogo de termos, nomes principais, PageHeader, Tabs e ajuda contextual. Critério: mesmo nome no menu, título e busca, sem perda de permissões.

### Lote 2 — Operação
Overview, Schedule, Live operations, Leads, Quotes, Jobs e detalhe. Prioridade para agrupamentos de status e ambiguidades de filas.

### Lote 3 — Relacionamentos
Accounts, Clients, Partners e Workforce; incluir todos os drawers e abas condicionais.

### Lote 4 — Financeiro
Billing, Expenses, Payroll, Payment run, Payouts, arquivos e detalhes. Validar cada label de valor contra sua fórmula e população.

### Lote 5 — Administração e secundárias
Settings e suas dez abas, Pricing, agentes, políticas, marketing, suporte, propriedades, certificados, manutenção e treinamento. Preservar rotas ocultas e redirects.

### Lote 6 — Revisão integrada
Eliminar resíduos dos nomes substituídos, conferir todos os perfis e validar ajuda em teclado, toque e telas estreitas.

## 18. Critérios de aceite e verificação

- Cada rota do inventário recebeu decisão: manter, renomear, título dinâmico ou redirect.
- Cada aba e painel lateral tem texto final e ajuda quando necessária.
- Todos os títulos fixos têm contexto acessível pelo !; títulos dinâmicos preservam o dado do usuário.
- Tooltip abre por foco/hover; clique/toque abre ajuda; Escape e retorno de foco são verificados; nenhum conteúdo fica cortado em drawer/modal.
- O ícone tem nome acessível contextual, como About receivables; o conteúdo usa descrição associada.
- Toda métrica documenta período e exclusões materiais; valores atuais, previstos e recebidos não são confundidos.
- Filtros e contagens permanecem iguais antes/depois; o mesmo status recebe label coerente em lista, mapa e detalhe.
- Não há abas reintroduzidas, perda de visibilidade por perfil nem alterações de URLs/IDs.
- Navegação persistida é verificada após reload e login; customizações não são apagadas.
- Layout validado em desktop e mobile, inclusive menu recolhido, strings longas e zoom.
- Rodar typecheck/lint e testes existentes pertinentes. Adicionar testes apenas para mudanças funcionais da migração de nav, mapeamentos de status ou interação de ajuda.
- Não criar snapshots de texto repetitivos para cada label.

## 19. O que falta verificar na aplicação

O plano não equivale a uma aprovação visual em produção. Confirmar em execução: nomes customizados no banco, estados por perfil, dados dos KPIs, rótulos calculados do B2B e alcance dos componentes compartilhados com portais. As condições explicitadas nas tabelas devem ser resolvidas antes de aplicar cada renomeação.

## 20. Implementação e decisões finais

- Nomes e ajuda aplicados ao menu, telas operacionais, detalhes, configurações, finanças e áreas secundárias.
- Mantida Finance em Accounts por prudência; não houve alteração da estrutura de abas.
- Drafts descreve a fila de rascunhos de Quotes; o registro individual usa Draft.
- Menu persistido recebe normalização em memória dos defaults conhecidos por href. Nomes personalizados e permissões são preservados; não foi necessário escrever no banco.
- Ajuda da aba ativa usa um botão irmão das abas. Diálogos de ajuda recebem foco, contenção de Tab, Escape e retorno de foco.
- IDs, rotas, fórmulas, filtros, valores persistidos e conteúdo de usuários foram preservados.
- As rotas de redirecionamento permanecem intactas; os novos nomes são exibidos no destino.
- Validação em navegador realizada em um harness local dos componentes compartilhados, não em uma sessão autenticada de produção.

### Verificação da branch

- 31 testes aprovados: navegação persistida, filtros de propostas, requisitos de conclusão de jobs e períodos financeiros.
- Chromium: ajuda por hover/foco, Escape, modal, contenção/retorno de foco, mudança de aba sem submit e ausência de botões aninhados; desktop e mobile.
- ESLint dos arquivos alterados comparado com o mesmo conjunto da base: 13 erros preexistentes contra 17 na base; nenhum erro novo; 302 avisos em ambas. Componentes centrais de ajuda e novos módulos sem erros.
- Typecheck completo: mesmo erro de fixture na base e na branch, em src/lib/account-insights.test.ts:11 (report_3_uploaded opcional em Job).
- Nenhuma sessão autenticada de produção foi usada para a validação visual.
