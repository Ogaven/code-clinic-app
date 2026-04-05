# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm@9

# Copy workspace manifests and lockfile from the monorepo root so pnpm can
# resolve the full dependency graph across all packages.
COPY ../package.json ./
COPY ../pnpm-lock.yaml ./
COPY ../pnpm-workspace.yaml ./

# Copy only the web package manifest first to leverage layer caching —
# dependencies are reinstalled only when these files change.
COPY package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

# Bring in installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy workspace manifests so pnpm/Next.js can resolve the workspace layout
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy the full apps/web source (build context root = apps/web)
COPY . ./apps/web

# Build the Next.js app — next.config.mjs sets output: 'standalone'
RUN pnpm --filter web build

# Copy public assets and static files into the standalone bundle so the
# Node.js server can serve them without a separate CDN step.
RUN cp -r apps/web/public apps/web/.next/standalone/apps/web/public && \
    cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy only the self-contained standalone bundle produced by Next.js.
# The monorepo path (apps/web) is preserved inside the standalone output.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/standalone/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next/standalone/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000

# next.config.mjs output: 'standalone' places the server entry point at
# apps/web/server.js inside the standalone directory.
CMD ["node", "apps/web/server.js"]
