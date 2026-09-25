# A tela de oferta, mapeada

Capturada em 16/09/2026, e era a lacuna do bot da Fantastic desde o desenho
dele ("o bot ainda não viu a tela de OFERTA, então não sabe onde fica o botão
de aceitar").

São **duas** telas em sequência, não uma:

## 1. `FOSInfoAnimatedActivity` — o aviso

```
titleTextView        New job received
descriptionTextView  New job received - EOT - Move out cleaning at EC2A 2FJ
                     starting 17.09.2026 12:00.
ctaButton            Go to jobs
okButton             OK
```

É só aviso, não dá para aceitar nem recusar. **E é a melhor fonte de horário
do app**: escreve data e hora reais, sem a conversão de fuso que a tela de
detalhe exige. No mesmo job, esta disse `17.09.2026 12:00` e o detalhe disse
"Tomorrow 08:00 AM" — os 4h da regra, confirmados de novo.

## 2. `OnDemandActivity` — a oferta

```
button_minimize      Minimize
heading_txt          Someone else has already taken the job!
chronometer          -4:-30                  ← contagem; negativa = expirou
tv_service_name      EOT - Move out cleaning
tv_start_at          Price £370
tv_text              Address · EC2A 2FJ
tv_text              Starts · Tomorrow 08:00 AM
tv_text              Payment method · Cash
tv_text              Status · Booked
ok_fbtn              OK
```

O `heading_txt` é o que diz o desfecho. Nesta captura a oferta **já tinha sido
tomada por outro**, então o botão de aceitar não estava na tela: para mapeá-lo
falta pegar uma oferta VIVA, com o cronômetro correndo positivo.

`ok_fbtn` é a saída que não aceita nada, e é por ela que a Nina sai hoje.

## O que isso já ensina

Oferta é **corrida contra cronômetro**. Perder para outro é o padrão quando
ninguém está olhando o telefone, e é o argumento para treinar a Nina a aceitar
mais adiante. Até lá ela só **relata**: serviço, endereço, preço, horário e o
desfecho, no brief.

Aceitar job não é dela (dono, 16/09/2026: "a Nina não vai aceitar, depois
treino ela pra isso").
