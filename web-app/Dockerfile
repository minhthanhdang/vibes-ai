FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV VIBES_FONTS_DIR=/app/.fonts
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.fonts ./.fonts
COPY --from=build --chown=node:node /app/node_modules/@resvg ./node_modules/@resvg
COPY --from=build --chown=node:node /app/node_modules/sharp ./node_modules/sharp
COPY --from=build --chown=node:node /app/node_modules/@img ./node_modules/@img
RUN node -e "require('@resvg/resvg-js'); require('sharp')"
USER node
EXPOSE 8080
CMD ["node", "server.js"]
