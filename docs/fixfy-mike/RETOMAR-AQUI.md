# Retomar daqui · 13 ago 2026

Cole isto num chat novo depois do `/clear`.

---

## Prompt de retomada

> Estou continuando o trabalho da Fixfy. Leia `docs/fixfy-mike/RETOMAR-AQUI.md`
> no repo `~/master-os` e siga a fila de pendências. Contexto rápido: opero
> sozinho, a meta é £1500/dia automatizado, e hoje estamos em £428/dia.

---

## O que está no ar agora

**Mike** (vendedor, respond.io): instruction e manual de preço novos, wait time
6s, uma única fonte de knowledge. Preços £72 hora · £179 meio dia · £290 dia,
depósito £72, só dentro da M25, nunca compramos peças.

**Alex** (`~/fixfy-sales/scripts/alex.mts`): pega o que o Mike marca como
**Converted** e cria job + ticket no OS. Roda 8h/10h/12h/14h/16h de Londres
(`com.fixfy.alex`). Converted é o único gatilho.

**RPA Checkatrade** (`~/checkatrade-rpa`): piso £75 nos dois baldes, janela 7h
às 20h. Agora versionado em git.

**Stefane** (`src/lib/stefane/`): sobe o relatório na Housekeep. PR #536,
mergeado. Migration 249 aplicada. Botão na aba Reports + selo no passo 3 do
modal. 16 testes verdes.

**Roteamento de parceiro** (`src/lib/partner-routing.ts`): certificados →
LandLord Certificate, limpezas → Fernando Correa, General Maintenance → TM
Handyman. Teto 5/dia. **Desligado**, falta `PARTNER_ROUTING_ENABLED=1` no
`.env.local`.

---

## Fila, em ordem

### 0. Quatro jobs órfãos · RESOLVIDO em 13 ago

A escalada rodou de verdade em cinco jobs (`.logs/escalate.log`) e o bug do
item 3 deixou quatro órfãos, todos com visita em 14 ago. **Parceiro devolvido**
copiando `partner_ids[0]` de volta para `partner_id`:

| Job | Trabalho | Parceiro devolvido |
|---|---|---|
| JOB-9404 | General Maintenance | TM Handyman |
| JOB-9406 | 2 Bed Domestic EICR | LandLord Certificate |
| JOB-9409 | General Maintenance | TM Handyman |
| JOB-9428 | General Maintenance | TM Handyman |

Varredura depois: **0 jobs órfãos** nos 414 vivos. Cada reparo tem linha em
`audit_logs` com `action: partner_restored`.

Nenhum email saiu: `partner_booked_email_sent_at` só é escrito no fluxo de
aceite, e o status não mudou, então o gatilho da 166 nem disparou.

**Ponto em aberto:** os quatro continuam com `partner_confirmed_at` nulo, que é
o critério da escalada. Se o launchd voltar a rodar antes da visita, eles
entram na fila de novo. Ou o parceiro confirma, ou a escalada fica desligada
até passar o dia 14.

### 0b. A Stefane nunca teria conseguido enviar. Corrigido em 14 ago

Abrindo o formulário real do JOB-9427 apareceram quatro bugs que, juntos,
significam que **o primeiro envio teria falhado, e falhado sem diagnóstico**:

1. **A conclusão mentia.** `could_not_complete` virava "Yes, no further work
   required" na Housekeep, porque a string contém "complete" e o casamento era
   por regex. Um job não feito era reportado como concluído, o que fecha o job
   do lado deles. `partially_complete` virava "materiais", porque contém "part".
2. **O formulário é uma sanfona de quatro seções** e só as duas primeiras vêm
   abertas. `page.fill` recusa campo invisível, então o preenchimento morria em
   "Finish time".
3. **`#9vzq8kmtvz6p` é seletor CSS inválido** — id não pode começar com dígito,
   e todos os ids da Housekeep começam. A descrição do trabalho nunca teria sido
   preenchida.
4. **As fotos não abriam.** O bucket `job-reports` é privado, mas o que fica
   gravado no report é o `getPublicUrl`, que responde 400. Agora são assinadas.

Também: jardinagem sempre reportava "more time needed" (o template `gardener`
não tem `completion_status`), e certificado nunca podia ser enviado (usa
`inspection_summary`, não `description`).

Verificado contra o formulário real em modo simulação: **fotos [4, 6], 0 campos
inválidos**. O `?simular=1` preenche e não aperta Submit — use sempre antes de
um envio real.

### 1. Testar a Stefane ponta a ponta
Job **JOB-9427** (`07af21bb-dffb-4489-b012-e3e902724ec0`): relatório do
parceiro **preenchido e aprovado** via Fill it myself (13 ago). O botão
**Approve Report** da Stefane destravou. Raine, da Housekeep, confirmou no
ticket 48647 que está esperando o report — era pra ser no mesmo dia da visita.

Antes de apertar: **as fotos**. Sem foto o envio agora é **recusado**, com o
motivo na tela ("no photos on the report: Housekeep requires before and after"),
porque a Housekeep exige before/after. As do Tony ainda estão no WhatsApp.

Fluxo: exportar do WhatsApp → **Edit report** → Add files → Save changes →
**Review & approve** → no passo 3, "Send to the client platform" → conferir o
preview campo a campo → **Confirm and send**.

A aba agora tem **um botão principal só**: "Upload report" quando não há
relatório, "Review & approve" quando há. O envio para a Housekeep mora dentro
da revisão, no passo 3, com o estado e o link ali mesmo.

Nunca foi apertado Submit de verdade na Housekeep. O primeiro envio real ainda
não aconteceu.

### 2. Modal de preencher relatório pelo OS
**Construído** (não commitado). Botão **Fill it myself** na aba Reports, ao
lado de Copy link / Preview. Abre o mesmo formulário do parceiro dentro do OS.

- `src/components/jobs/fill-report-modal.tsx` — o modal, campos vindos de
  `public-report-templates` (template escolhido pelo título do job).
- `src/app/api/jobs/[id]/office-report/route.ts` — rota autenticada
  (admin/manager/operator). Recusa se o relatório final já existe.
- `src/lib/report-submission.ts` — gravação compartilhada com o link público.
  `source: "office_manual"` fica no envelope, fora dos campos, então não
  aparece no PDF do cliente. 19 testes.

Além dos campos do report, o modal pede **hora de início e fim** (Londres).
Isso preenche `partner_timer_started_at/ended_at`, que é de onde a Stefane tira
Start time e Finish time no formulário da Housekeep. O link público só gravava
o fim; agora deriva o início pela duração digitada.

**Primeiro relatório real salvo por ele: JOB-9427** (13 ago, 23h). Montagem de
guarda-roupa, 13:00–15:00 Londres, completo sem extras. Salvo **sem fotos**:
elas ainda estão no WhatsApp do Tony.

Layout da aba (13 ago, noite): **Upload report** é a ação principal do painel;
o link do parceiro virou linha compacta com três ícones (copiar, enviar,
abrir). Job sem parceiro também tem o Upload report.

Também existe **Edit report**: com relatório final no job, o botão reabre o
modal preenchido. Campos são substituídos; fotos já salvas ficam e as novas são
adicionadas. `overwrite=1` na mesma rota. Start report sem `source` no envelope
veio do app do parceiro ao vivo e nunca é reescrito. Job que já passou de
final_check (completed etc.) não volta de status por causa de uma edição.

**Sabido, não corrigido:** em job de limpeza, foto posta num cômodo na seção de
chegada vai também para a de conclusão (mesma chave de slot). O formulário
público sempre fez isso; mexer nisso muda o contrato dos dois lados.

### 3. Bug da escalada
**Causa achada e corrigida** (não rodado ainda). A escalada limpava `partner_id`
e `partner_name`, mas deixava **`partner_ids`**, o plural, com o parceiro
antigo. A cadeia:

1. escalada grava `auto_assigning` + lista de convidados;
2. o gatilho da migração 166 dispara na mudança de status e chama
   `/api/internal/zendesk/sync-status`;
3. esse sync roda `stalePartnerBookedJobPatch` (`src/lib/job-partner-assign.ts:142`),
   que olha `partner_id` **ou** `partner_ids`;
4. vendo parceiro no plural, ele conclui "job agendado com parceiro", devolve
   `scheduled` e limpa a lista de convidados.

Resultado: JOB-9415 sem parceiro e sem leilão. A suspeita do gatilho estava
certa, mas quem reverte é o código do sync, não o trigger.

Correção: `partner_ids: []` junto com o singular, mais `?dry-run=1` na rota,
que lista quem seria escalado sem escrever nem mandar email. Array vazio e não
`null`: a coluna é `uuid[] NOT NULL DEFAULT '{}'` desde a migração 050, e
gravar null aí estoura violação e derruba a escalada inteira.

E a trava para não depender de ninguém lembrar: **migration 250**, trigger que
zera `partner_ids` sempre que `partner_id` fica nulo. **Falta aplicar** — não
há `DATABASE_URL` no `.env.local`, então é colar no SQL editor como a 249.

**Encerrado em 20/08/2026.** A escalada automática não existe mais: a rota
`/api/cron/escalate-unconfirmed-jobs` e o launchd `com.fixfy.escalate` foram
removidos depois que uma chamada manual ao vivo soltou o parceiro de 15 jobs de
uma vez. O dry-run não protegia de nada, porque bastava alguém chamar a rota sem
ele. Auto assign agora só sai do botão do job, ou de o job já nascer pedindo
(`auto_assign` na criação, `assignment_mode=auto` na macro). Job atribuído e não
confirmado é decisão de gente, não de cron.

### 4. Ligar o roteamento
`PARTNER_ROUTING_ENABLED=1` e reiniciar o Next. Primeiro job que passar manda
email real pedindo confirmação ao parceiro.

### 5. Madrugada no Checkatrade Express
Você não precisa ficar acordado. O bot já tem janela por env
(`~/checkatrade-rpa/src/config.ts`): `RUN_START_HOUR` (hoje 7) e `RUN_END_HOUR`
(hoje 20, exclusivo). O piso de £75 e a blocklist já decidem o que pegar, e a
madrugada é justamente quando ninguém está disputando.

Para cobrir a noite: `RUN_START_HOUR=0` e `RUN_END_HOUR=24`.

Cuidado, **até 3h não dá para expressar hoje**: `isWithinRunWindow`
(`src/time.ts:45`) é `hour >= start && hour < end`, sem dar a volta na
meia-noite. Janela 7h–3h precisa de mudança no código; 24h é só env.

Duas coisas antes: a sessão auth0 vive só na memória do processo (por isso a
pendência do `storageState`), então rodar a noite inteira significa não
derrubar o processo. E não tenho dado de horário de chegada de lead nos logs
para confirmar que job bom cai de madrugada. É a sua observação, e vale medir:
uma noite de 24h já responde.

### 6. Braço Checkatrade da Stefane
Report lá é só fotos e finalizar, mais simples. Mas exige login, e a sessão
auth0 só existe na memória do processo do RPA. Roda dentro dele, não no OS.

---

## Pendências fora de código

- **Rotacionar as senhas do Checkatrade.** `CREW_PASSWORD` e
  `CHECKATRADE_PASSWORD` estão no commit `75c81b3` do `~/checkatrade-rpa`, que
  já existia antes desta sessão. Local, sem remote, mas versionado.
- **Rotacionar o token do respond.io** e apagar a linha `<token novo>` do
  `.env.local` do OS.
- **48 mudanças não commitadas** na branch `feat/partner-resend-email`
  (billing, pulse, beacon). Soltas no disco desde antes desta sessão.
- **Salvar `storageState` a cada ciclo no RPA.** Hoje a sessão auth0 só vive na
  memória; o arquivo em disco não autentica mais. É pré-requisito para VPS.
- **Fantastic** não tem porta digital: 5 tickets em 4 meses, todos WhatsApp ou
  email solto. Pedir a eles um email por job, como a Housekeep já manda.

---

## Números que orientam decisão

- £428/dia (30 dias), 56 jobs, ticket £229. Para £1500/dia faltam **3,5x**.
- **268 de 279** jobs têm parceiro; **1** recebeu email automático.
- Relatório final em **16 de 198** concluídos; **2 de 18** nos últimos 30 dias.
- Matcher geográfico alcança **7 de 72** parceiros.
- B2B/imobiliária: ticket **£839**, margem 49%, 100% manual.
  Express: ticket £158, margem 34%, quase todo automatizado.
  **O canal mais automatizado é o de menor ticket.**
