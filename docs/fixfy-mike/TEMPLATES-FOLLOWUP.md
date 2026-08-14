# Follow-up templates: para submeter à Meta

Quatro toques depois do preço: 23h, 48h, 72h, 90h. No último a conversa fecha.

**Categoria: Utility nos quatro.** Não é Marketing, porque cada um continua uma
conversa que o cliente começou pedindo orçamento. Utility custa cerca de $0,016
por mensagem no Reino Unido contra $0,055 do Marketing, e aprova mais rápido.
Para continuar Utility, nenhum pode oferecer desconto, promoção ou serviço novo.
Todos falam só do job que já está aberto.

**Idioma: English (UK).**

## As duas variáveis

| | |
|---|---|
| `{{1}}` | Primeiro nome do cliente |
| `{{2}}` | O trabalho, em minúscula, começando com "the" |

`{{2}}` é o que separa um follow-up que funciona de um que é ignorado. "the door
handles" faz a pessoa lembrar da conversa em meio segundo. "your job" não faz
nada, porque ela não lembra qual job era.

Bons valores para `{{2}}`: `the door handles`, `the shelves in the bedroom`,
`the bathroom reseal`, `the TV mounting`, `painting the bedroom`.

**`{{2}}` nunca pode ir vazio.** Uma mensagem que chega escrevendo "did that
price for look alright" queima o número e a confiança. Se não houver descrição,
não manda o follow-up.

---

## 1. `fixfy_followup_23h`

Utility · 23 horas depois do preço

```
Hi {{1}}, did that price for {{2}} look alright to you? Happy to go through anything on it, or get you a date in the book if you're ready.
```

Exemplo para a Meta: `Hi Sarah, did that price for the door handles look alright to you? Happy to go through anything on it, or get you a date in the book if you're ready.`

Pergunta direta e fácil de responder com uma palavra. "Look alright to you" abre
espaço para dizer que achou caro, que é uma objeção que se trabalha. Silêncio
não é.

---

## 2. `fixfy_followup_48h`

Utility · 48 horas, só se não respondeu

```
Hi {{1}}, I've still got {{2}} open on my side. There's space in the diary this week if you want it, otherwise just say and I'll leave you to it.
```

Exemplo: `Hi Sarah, I've still got the shelves in the bedroom open on my side. There's space in the diary this week if you want it, otherwise just say and I'll leave you to it.`

Escassez honesta: a agenda é real. E a saída ("just say and I'll leave you to
it") tira o peso, o que faz responder gente que estava evitando responder.

---

## 3. `fixfy_followup_72h`

Utility · 72 horas, só se não respondeu

```
Hi {{1}}, I won't keep chasing you about {{2}}. If you still want it done just say the word, and if you've already got it sorted that's absolutely fine, just let me know either way.
```

Exemplo: `Hi Sarah, I won't keep chasing you about the bathroom reseal. If you still want it done just say the word, and if you've already got it sorted that's absolutely fine, just let me know either way.`

"Não vou ficar te perseguindo" desarma. Dar permissão explícita para dizer que
já resolveu é o que traz resposta de quem não responderia a mais uma cobrança,
e um não limpa a fila tão bem quanto um sim.

---

## 4. `fixfy_followup_90h`

Utility · 90 horas · **fecha a conversa depois de enviar**

```
Hi {{1}}, closing this one off so it stops sitting in your messages. The price for {{2}} still stands whenever you want it, just reply here and I'll pick it straight back up.
```

Exemplo: `Hi Sarah, closing this one off so it stops sitting in your messages. The price for the TV mounting still stands whenever you want it, just reply here and I'll pick it straight back up.`

Fechar dizendo que está fechando é o que separa um lead morto de um que volta em
três semanas. "O preço continua de pé" remove o medo de que voltar signifique
começar tudo de novo. E a resposta a este reabre a conversa sozinha.

---

# Regras de operação

**Nenhum follow-up para quem já disse não.** Se a pessoa recusou, agradeceu e
saiu, ou pediu para não receber mais mensagem, a sequência para ali. Mandar
mesmo assim é o caminho mais rápido para o número perder quality rating.

**A sequência para no instante em que a pessoa responde qualquer coisa.** O Mike
retoma a conversa normalmente e nenhum dos outros três sai.

**Uma pessoa, uma sequência.** Se o mesmo cliente pediu dois orçamentos, ele
entra na sequência uma vez só.

---

# Regras da Meta que estes já respeitam

Se editar o texto, manter:

- **Não começar nem terminar com variável.** `{{1}}, tudo bem?` é rejeitado.
- **Sem duas variáveis coladas.** `{{1}} {{2}}` é rejeitado.
- **Tem que fazer sentido lido sozinho**, sem a conversa anterior.
- **Nada promocional em Utility.** Sem desconto, sem oferta, sem "aproveite".
- **Sem travessão.** Regra nossa, não da Meta.

# Onde submeter

Painel do respond.io, Workspace Settings, Message Templates, Add Template.
Escolher o canal do WhatsApp, categoria Utility, idioma English (UK).

Aprovação de Utility simples costuma sair em minutos, mas pode levar 24 horas.
Enquanto não aprovar, a sequência não roda: sem template aprovado o WhatsApp não
deixa mandar nada fora da janela de 24 horas.

# A janela de 24 horas, e por que o de 23h talvez não gaste nada

A janela conta a partir da **última mensagem do cliente**, não da sua. Se ele
respondeu alguma coisa e o preço saiu logo depois, às 23 horas a janela ainda
está aberta e a mensagem sai como texto normal, de graça.

O template de 23h existe para o outro caso: o cliente que parou de responder
antes do preço sair. Aí a janela já fechou e sem template não sai nada.

Na prática: texto livre se a janela estiver aberta, template se estiver fechada.
Os de 48h, 72h e 90h são sempre template, porque a dois dias a janela fechou em
qualquer cenário.
