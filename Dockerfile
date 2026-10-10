# syntax=docker/dockerfile:1

# -- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile=false
COPY tsconfig.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.json

# -- Runtime stage -----------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

LABEL org.opencontainers.image.title="fluxer-freegames" \
	org.opencontainers.image.description="Free-games bot for self-hosted Fluxer instances: announces giveaways (Epic, Steam, GOG, ...) in a channel and marks ended deals" \
	org.opencontainers.image.source=https://github.com/JoaoCostaIFG/fluxer-freegames \
	org.opencontainers.image.url=https://github.com/JoaoCostaIFG/fluxer-freegames \
	org.opencontainers.image.licenses=EUPL-1.2 \
	org.opencontainers.image.authors="JoaoCostaIFG"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile=false
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# The bot touches /tmp/bot-heartbeat while the gateway connection is alive
# (same pattern the Fluxer worker container uses). If the file goes stale
# the container is unhealthy and gets restarted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD node -e "const fs=require('fs');const age=Date.now()-fs.statSync('/tmp/bot-heartbeat').mtimeMs;if(age>60000){console.error('gateway heartbeat is '+Math.round(age/60)+' minutes old');process.exit(1)}"

CMD ["node", "dist/index.js"]
