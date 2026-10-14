# fixfy-workers no Railway

Um serviço só, sempre de pé, que roda as rotinas que eram jobs do launchd do Mac.
O processo é `scripts/workers/agendador.mts`; a lista de rotinas e os horários
(sempre de Londres) estão em `scripts/workers/rotinas.mts`.

## Configuração do serviço

Mesmo repositório e mesmo branch (`main`) do serviço `harvey`. O `harvey` não muda:
continua no Railpack, com o start command vazio.

| Ajuste | Valor |
|---|---|
| Builder | Dockerfile |
| Dockerfile Path | `Dockerfile.workers` (ou a variável `RAILWAY_DOCKERFILE_PATH=Dockerfile.workers`) |
| Start Command | vazio (vale o `CMD` do Dockerfile: `node --import tsx scripts/workers/agendador.mts`) |
| Volume | montado em `/data` |
| Domínio público / healthcheck | nenhum (não é servidor HTTP) |
| Restart policy | On failure |
| Réplicas | **1**. Duas réplicas = toda mensagem em dobro |

## Variáveis

Variáveis do próprio agendador:

| Variável | Valor | Para quê |
|---|---|---|
| `FIXFY_STATE_DIR` | `/data/state` | trava de "já mandei hoje" dos e-mails de parceiro. Já vem no Dockerfile; repetir no painel não faz mal |
| `WORKERS_DESLIGAR` | `*` no primeiro deploy | desliga rotinas sem deploy. Nome desconhecido derruba o processo de propósito |
| `TZ` | `Europe/London` | já vem no Dockerfile. Os scripts usam o relógio de Londres explícito; isto só iguala o Mac |

Variáveis das rotinas: a tabela por rotina está na descrição do PR que criou este
serviço. Copiar as do `harvey` e completar as que faltam. **Não** copiar
`NEXT_PUBLIC_PARTNER_APP_URL` do `.env.local` do Mac: lá ela aponta para o
localhost. Aqui deve ser `https://partners.getfixfy.com` (ou ficar vazia, que dá no
mesmo). Nunca definir `VERCEL` neste serviço: com ela a Stefane só enfileira e
nunca envia.

## Desligar e ligar rotinas

`WORKERS_DESLIGAR` aceita o nome curto (`stefane`), o label do launchd
(`com.fixfy.stefane-worker`) ou o label sem o prefixo (`stefane-worker`),
separados por vírgula. `*` desliga todas.

Nomes: `lembrete-24h`, `aviso-job-confirmado`, `partner-tomorrow`,
`partner-missing-reports`, `harvey-leads-7h`, `daily-report`, `weekly-report`,
`stefane`.

Mudar a variável reinicia o serviço; a passada em andamento recebe SIGTERM e
tem 20 s para terminar.

## Virada, uma rotina por vez

Para cada rotina, nesta ordem:

1. Confirmar que ela está em `WORKERS_DESLIGAR` no Railway.
2. No Mac: `launchctl bootout gui/$(id -u)/com.fixfy.<label>` (e tirar o plist
   de `~/Library/LaunchAgents` para não voltar no próximo login).
3. No Railway: tirar o nome dela de `WORKERS_DESLIGAR`.
4. Acompanhar a primeira passada no log (`[<nome>] ...`, e o `fim · código 0`).

Os e-mails de parceiro têm trava por dia. Para não mandar de novo no dia da
virada, copiar `scripts/.tomorrow-sent.json` e `scripts/.missing-reports-sent.json`
do Mac para `/data/state/` antes de ligar essas duas, ou virar num dia em que o Mac
não mandou.

## Conferir sem rodar nada

```
node --import tsx scripts/workers/agendador.mts --ensaio
node --import tsx scripts/workers/agendador.mts --ensaio --proximas=3 --desde=2026-10-24T12:00:00Z
npx tsx --test scripts/workers/agenda.test.mts
```
