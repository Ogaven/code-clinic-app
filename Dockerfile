# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm globally before attempting to use it
RUN npm install -g pnpm@9

# Copy workspace manifests and lockfile first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm and openssl (required by Prisma)
RUN npm install -g pnpm@9 && \
    apk add --no-cache openssl

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

# Copy full source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api ./apps/api
COPY packages/database ./packages/database

# Generate Prisma client, then build the API
RUN pnpm --filter database generate && \
    pnpm --filter api build

# ─── Stage 3: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl

# Copy only what's needed to run the compiled API
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["node", "dist/main.js"]
