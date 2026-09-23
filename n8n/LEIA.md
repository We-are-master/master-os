# n8n · campanha WEEK10

Três workflows, importar em http://localhost:5678 (Workflows → Import from File):

| Arquivo | O que faz | Ritmo |
|---|---|---|
| `week10-email.json` | Pede ao OS uma volta de e-mail (o OS manda pelo Resend, em lote) | 15 min |
| `week10-whatsapp.json` | Pede a próxima leva ao OS, manda cada template na Meta, devolve o resultado | 10 min |
| `week10-zendesk.json` | Pede ao OS a varredura do Zendesk: Stop bloqueia e fecha o ticket, resposta marca | 10 min |

As regras (quem recebe, teto de 24h, qualidade GREEN, janela, bloqueio) ficam TODAS no OS. O n8n só obedece: se o OS devolve a leva vazia, ele não manda nada.

## Credenciais (uma vez, em Credentials → New → Header Auth)
- **Fixfy OS · CRON_SECRET**: Name `Authorization`, Value `Bearer <CRON_SECRET do .env.local>`
- **WhatsApp Cloud · token**: Name `Authorization`, Value `Bearer <WHATSAPP_TOKEN>`

## Pré-requisitos
- OS do worktree rodando em :3200 (`host.docker.internal:3200` é o Mac visto de dentro do Docker).
- `MARKETING_CAMPANHA=on` no `.env.local`. Sem isso as rotas respondem "desligado" e nada sai.
- Fila montada: `npx tsx scripts/campanha.mts --montar --aplicar`.
