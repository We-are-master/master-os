# Como o Railway roda o Harvey.
#
# Procfile e não railway.toml: o `config migrate` do CLI limpou a referência ao
# railway.toml no serviço e o deploy seguinte voltou para o `npm start` padrão,
# que neste repo é `next start` — o worker subiu servindo um site em vez de
# rodar o agente. O Procfile é lido pelo Nixpacks direto, sem depender de uma
# configuração guardada do lado do Railway.
#
# O ritmo é o do launchd que ele tinha no Mac: um ciclo, cinco minutos, outro.
# `|| true` porque um ciclo que morre não pode levar o worker com ele.
web: while true; do npm run harvey || true; sleep 300; done
