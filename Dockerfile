# syntax=docker/dockerfile:1
# Kavannah API. Build context = repo root. Produces a small image that runs a single bundled
# ESM file with plain Node (no node_modules, no TypeScript loader at runtime).

FROM node:22-alpine AS build
WORKDIR /app
# Manifests first so the dependency layer is cached across source changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/extension/package.json apps/extension/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @kavannah/server --workspace @kavannah/shared --ignore-scripts
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run bundle -w @kavannah/server

FROM node:22-alpine
ENV NODE_ENV=production \
    KAVANNAH_HOST=0.0.0.0 \
    KAVANNAH_TRUST_PROXY=1 \
    PORT=8080
WORKDIR /app
RUN addgroup -S kavannah && adduser -S kavannah -G kavannah
COPY --from=build /app/apps/server/dist/ ./
USER kavannah
EXPOSE 8080
CMD ["node", "--enable-source-maps", "server.mjs"]
