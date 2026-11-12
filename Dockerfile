# Multi-stage build for DGT.LZ Gateway platform
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/provider/package.json packages/provider/
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build || echo "build deferred to runtime (dev images)"

# ---------- gateway ----------
FROM base AS gateway
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
CMD ["npx", "tsx", "apps/gateway/src/index.ts"]

# ---------- worker ----------
FROM base AS worker
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["npx", "tsx", "apps/gateway/src/worker.ts"]

# ---------- web ----------
FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@dgtlz/web"]
