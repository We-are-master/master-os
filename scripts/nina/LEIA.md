# Fechar job no app da Fantastic

O app deles não tem API, então o caminho é a tela, pelo `adb`, no emulador que
vive em `~/fantastic-rpa` (ver `emulador.sh` lá). Estes scripts são a parte que
o Victor fazia à mão e que estava pendente desde o desenho do bot.

## Ordem de uso

```bash
# 1. uma vez por dia: a checklist que bloqueia o app
node scripts/fantastic/checklist-diaria.mjs --enviar

# 2. por job, com a tela do Summary aberta
node scripts/fantastic/fechar-job.mjs

# ou, com o job já aberto pelo menu History → dia
node scripts/fantastic/ciclo-job.mjs
```

## As regras do dono (16/09/2026)

| | |
|---|---|
| avaliação do cliente | sempre **5\*** |
| dinheiro | sempre **0** / "No cash payment collected" |
| campo de texto | **N/A** |
| foto | qualquer uma, 3 por bloco |
| endereço | **sempre** apertar "Confirm to see full address" antes de importar |

## As armadilhas, todas silenciosas

**Fotos antes do texto.** A lista é `RecyclerView`: adicionar foto recria as
linhas e os `EditText` perdem o que foi digitado. Preenchendo texto primeiro,
os 36 N/A do W6 9AN voltaram a ficar vazios e o SUBMIT ficou cinza sem dizer
por quê.

**O SUBMIT é rodapé fixo** (y≈2211..2337), fora da faixa "visível" que o resto
do script usa para não tocar em bloco meio cortado. Procurar sem esse filtro.

**A checklist diária só aceita câmera.** O diálogo dela não tem "Gallery", e o
AVD vinha com `hw.camera.front=none`. Selfie usa a frontal: o disparador não
capturava, o contador ficava em 0/20, sem erro na tela. Ligar
`hw.camera.front=emulated` no `config.ini` do AVD. Ao reiniciar, `adb emu kill`
deixa locks órfãos (`hardware-qemu.ini.lock`, `multiinstance.lock`): apagar,
senão o emulador recusa com "Running multiple emulators with the same AVD".

**O campo do valor em dinheiro fica `enabled=false`** quando "No cash payment
collected" está marcado. Ele aparecer vazio depois é o certo, não pendência.

## Como saber que fechou

A tela do job passa a mostrar **"The job is done"** com o círculo cinza.

O campo `Status` na tela de detalhe continua dizendo **"Booked"** mesmo em job
concluído — ele só diz que a reserva existe. Usá-lo como verificação faz
retrabalhar job que já estava pronto (quase aconteceu com o W2 1GN).

## Fotos de placeholder

```bash
ffmpeg -loglevel error -f lavfi -i color=c=black:s=1080x1440 -frames:v 1 preta.jpg
adb push preta.jpg /sdcard/Pictures/
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/preta.jpg
```

O `cmd media scan` não existe nessa imagem do Android; o broadcast indexa. O
picker do Google mostra as mais recentes primeiro.

Ver também: regra dos 65% e do +4h em `fantastic-services-regras` na memória.
