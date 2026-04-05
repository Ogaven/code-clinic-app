# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm globally before attempting to use it
RUN npm install -g pnpm@9

# Copy workspace manifests and lockfile so pnpm can resolve the full graph
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/database/package.json ./packages/database/package.json

# Install all dependencies (frozen to match the committed lockfile)
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

# Bring in installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy the full monorepo source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY packages/database ./packages/database

# Build the Next.js web app (output: standalone is set in next.config.mjs)
RUN pnpm --filter web build

# Copy public assets and static files into the standalone output so the
# server can serve them without a separate CDN step
RUN cp -r apps/web/public apps/web/.next/standalone/apps/web/public && \
    cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app/apps/web

ENV NODE_ENV=production

# Only copy the self-contained standalone bundle produced by Next.js
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/standalone/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/standalone/apps/web/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
