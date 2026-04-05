# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9

# Copy workspace manifests and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all workspace source
COPY apps/ ./apps/
COPY packages/ ./packages/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client and build the API
RUN pnpm --filter database generate
RUN pnpm --filter api build

# ── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy root node_modules (hoisted deps)
COPY --from=builder /app/node_modules ./node_modules

# Copy API package and its compiled output
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Copy database package (Prisma client + schema needed at runtime)
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/packages/database/package.json ./packages/database/package.json

EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
