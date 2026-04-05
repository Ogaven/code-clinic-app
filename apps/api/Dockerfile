# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

RUN npm install -g pnpm@9

# Copy workspace manifests from the repo root (one level up from apps/api).
# Railway sets the build context to apps/api, so these files are at ../
COPY ../package.json ../pnpm-lock.yaml ../pnpm-workspace.yaml ./

# Copy package manifests for every workspace member the API depends on
COPY package.json ./apps/api/package.json
COPY ../../packages/database/package.json ./packages/database/package.json

# Install all workspace dependencies (respects the lockfile exactly)
RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

# Bring in the fully-installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

# Copy workspace config and the packages the API depends on
COPY ../package.json ../pnpm-lock.yaml ../pnpm-workspace.yaml ./
COPY ../../packages/database ./packages/database
COPY . ./apps/api

# Generate the Prisma client, then compile the API TypeScript source
RUN pnpm --filter database generate
RUN pnpm --filter api build

# ── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy only the production node_modules and compiled output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules

# Prisma schema is needed at runtime for query-engine resolution
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma

# Compiled API bundle
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
