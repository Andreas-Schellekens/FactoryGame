# The web service: builds the game with Vite, then serves it with Caddy (web/Caddyfile),
# which also forwards /api/* to the api service. Build context: the repository root
# (Railway: config file web/railway.json). Node is only used to build.
FROM node:22-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src src
COPY public public
RUN npm run build

FROM caddy:2-alpine
COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
