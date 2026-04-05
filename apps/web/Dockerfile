# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm@9

# Copy workspace manifests and lockfile from the monorepo root so pnpm can
# resolve the full dependency graph across all packages.
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Copy only the web package manifest first to leverage layer caching —
# dependencies are reinstalled only when these files change.
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

# Bring in installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy workspace manifests so pnpm/Next.js can resolve the workspace layout
COPY package.json ./package.json
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy the apps/web source (build context root = repo root)
COPY apps/web ./apps/web

# Build the Next.js app — next.config.mjs sets output: 'standalone'
RUN pnpm --filter web build

# Copy public assets and static files into the standalone bundle so the
# Node.js server can serve them without a separate CDN step.
RUN cp -r public .next/standalone/public && \
    cp -r .next/static .next/standalone/.next/static

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy only the self-contained standalone bundle produced by Next.js.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/standalone/public ./public
COPY --from=builder /app/.next/standalone/.next/static ./.next/static

EXPOSE 3000

# next.config.mjs output: 'standalone' places the server entry point at
# server.js inside the standalone directory.
CMD ["node", "server.js"]
