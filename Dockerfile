# A imagem do Harvey.
#
# Dockerfile e não Nixpacks porque o comando de start precisa ser inegociável.
# Passamos por três mecanismos que o Railway aceita e depois desfaz:
#
#   railway.toml   o `railway config migrate` do CLI limpou a referência a ele
#                  quando eu mudei uma variável, e o deploy seguinte caiu no
#                  `npm start` — que neste repo é `next start`;
#   Procfile       funcionou no deploy forçado e NÃO funcionou no deploy que o
#                  webhook disparou com o mesmo commit: o Nixpacks resolve o
#                  start no build, e o build reusou camada em cache com o
#                  comando antigo dentro;
#   Dockerfile     o CMD mora na imagem. Não há configuração do lado do Railway
#                  para limpar, nem plano de build para cachear errado.
#
# O sintoma de todos foi o mesmo e é o que o torna perigoso: deploy verde,
# processo vivo, agente parado.
FROM node:22-slim

# `tini` para o PID 1 repassar sinal: sem ele o `sleep` do laço ignora o
# SIGTERM do deploy e o Railway espera o timeout antes de matar o container.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# As dependências primeiro, em camada própria: mexer no código do Harvey não
# reinstala 777 pacotes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# A cadência é variável e não número aqui dentro, seguindo o padrão do
# checkatrade-bot: mudar o ritmo não deve exigir build. Padrão de 300s, que é o
# mesmo do launchd que ele tinha no Mac.
#
# `|| true` porque um ciclo que morre não pode levar o worker com ele.
ENV POLL_INTERVAL=300
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "while true; do npm run harvey || true; sleep \"${POLL_INTERVAL:-300}\"; done"]
