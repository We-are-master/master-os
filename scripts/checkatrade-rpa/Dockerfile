FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY tsconfig.json config.json ./
COPY src ./src

CMD ["npm", "run", "start"]
