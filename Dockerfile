FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY web/package*.json ./web/
RUN cd web && npm install

COPY . .
RUN npx prisma generate
RUN cd web && npm run build
RUN npx tsc

FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates gnupg wget lsb-release && \
    install -d /usr/share/postgresql-common/pgdg && \
    wget -qO /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

CMD ["sh", "entrypoint.sh"]
