# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22.18-alpine3.22

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1 APP_VERSION=${APP_VERSION}
RUN npm run build

# Krok migracji: osobny obraz i osobne konto bazy (MIGRATION_DATABASE_URL).
FROM ${NODE_IMAGE} AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/db ./src/db
COPY src/cli ./src/cli
COPY src/lib/tokens.ts ./src/lib/tokens.ts
USER node
CMD ["npx", "tsx", "src/db/migrate.ts"]

FROM ${NODE_IMAGE} AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
