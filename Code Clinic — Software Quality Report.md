# Code Clinic — Professional Software Quality Report
**Prepared by:** Engineering Review  
**Date:** 27 April 2026  
**Application:** Code Clinic Dental Clinic Management System  
**Stack:** Next.js 14 · Express 4 · PostgreSQL · Prisma 5 · pnpm monorepo · Railway PaaS  
**Scope:** Full codebase audit across 7 ISO/IEC 25010 quality characteristics

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Functionality and Correctness](#2-functionality-and-correctness)
3. [Reliability and Security](#3-reliability-and-security)
4. [Usability](#4-usability)
5. [Maintainability and Technical Quality](#5-maintainability-and-technical-quality)
6. [Performance Efficiency](#6-performance-efficiency)
7. [Portability and Adaptability](#7-portability-and-adaptability)
8. [Testability](#8-testability)
9. [Prioritised Action Plan](#9-prioritised-action-plan)
10. [Effort / Impact Matrix](#10-effort--impact-matrix)

---

## 1. Executive Summary

Code Clinic is a multi-tenant dental clinic management system providing appointment scheduling, patient records, billing, AI-powered WhatsApp and website chatbots, voice calls, and a full admin dashboard. The application demonstrates strong functional breadth and a well-conceived domain model. However, it currently does not meet the baseline professional engineering standards required for a production healthcare application.

**Critical findings in brief:**

| Severity | Count | Examples |
|----------|-------|---------|
| 🔴 Critical | 5 | Secrets committed to git, no TypeScript strict mode, no env validation, hardcoded token expiry, missing auth-z checks |
| 🟠 High | 8 | No error tracking, CORS over-permissive, audit logs silently drop, no CI/CD, dangling FK |
| 🟡 Medium | 12 | N+1 queries in agent, no API docs, no error boundaries, no test suite, medical data unencrypted |
| 🟢 Low / Enhancement | 14 | Accessibility gaps, code duplication, missing pagination, no skeleton screens, etc. |

**Overall readiness rating: 38 / 100** — Significant work required before this system should handle real patient data at scale.

---

## 2. Functionality and Correctness

### 2.1 Domain Coverage

The application covers the core dental clinic workflow comprehensively:

| Module | Status | Gaps |
|--------|--------|------|
| Appointment scheduling | ✅ Complete | No conflict detection across doctors |
| Patient records (CRUD) | ✅ Complete | Medical history stored as comma-separated string — fragile |
| Billing / invoicing | ✅ Present | No payment gateway integration visible |
| AI chatbot (WhatsApp, Website) | ✅ Functional | No human-escalation SLA timer |
| Voice calls (SIP) | ⚠️ Partial | SIP service no-ops if DRACHTIO_HOST absent — silent failure |
| Lead nurture / campaigns | ⚠️ Partial | Scheduler fires but no delivery receipt tracking |
| Role-based access | ⚠️ Partial | Roles defined but not enforced at route level (see §3) |
| Reporting / analytics | ✅ Present | Charts in dashboard — no export |
| Mobile app | ❌ Stub | `apps/mobile` exists but appears unused |

### 2.2 Data Model Issues

**File:** `packages/database/prisma/schema.prisma`

| Issue | Severity | Detail |
|-------|----------|--------|
| `TreatmentNote.authorId` has no `@relation` | 🔴 Critical | Field references no model — relation broken, will fail at runtime when included |
| `Patient.medicalHistory` stored as `String?` | 🟠 High | Comma-separated values are brittle — should be a normalised junction table or JSONB array |
| String used instead of Enums for status fields | 🟡 Medium | `Appointment.status`, `Invoice.status`, `User.role`, `Payment.method` all String — no DB-level constraint; invalid values can be persisted |
| Missing composite indexes | 🟡 Medium | `(appointmentId, status)`, `(patientId, createdAt)`, `(channel, phoneNumber)` on AiConversation needed for common query patterns |
| `isActive` not indexed | 🟡 Medium | Soft-delete pattern requires `@@index([isActive])` on Patient, Service, Doctor for efficient filtered queries |
| Single migration (SQLite name, Postgres target) | 🟠 High | Only 1 migration (`20260403104850_sqlite_init`) against a PostgreSQL database — migration history is not an accurate reflection of schema evolution; makes rollbacks impossible |
| Optional `AuditLog.resourceId` | 🟡 Medium | Cannot reliably trace which record was acted on |
| No soft-delete middleware | 🟡 Medium | `isActive=false` records still appear in direct `findMany` calls that omit the filter |

**Recommended fixes:**

```prisma
// Convert string fields to proper Prisma enums
enum AppointmentStatus {
  PENDING CONFIRMED COMPLETED CANCELLED RESCHEDULED NO_SHOW
}

// Add missing indexes
model Patient {
  @@index([isActive])
  @@index([phone])
}

model AiConversation {
  @@index([channel, phoneNumber, status])
}

// Normalise medical history
model PatientCondition {
  id        String  @id @default(cuid())
  patientId String
  condition String
  patient   Patient @relation(fields: [patientId], references: [id], onDelete: Cascade)
}
```

### 2.3 Business Logic Gaps

| Gap | Impact | Location |
|-----|--------|---------|
| No appointment conflict detection | Doctors can be double-booked | `routes/scheduling.ts` |
| No minimum appointment duration enforcement | Zero-duration appointments possible | Schema + API |
| No invoicing trigger on appointment completion | Revenue can be lost | No automation hook |
| AI booking bypasses business hours check | Patients can book outside hours | `agent.service.ts` booking flow |
| No patient consent recording | Legal/compliance risk | Patient model |
| `medicalNotesEncrypted` field exists but no encryption code | False sense of security | `routes/patients.ts` |

### 2.4 API Correctness

**File:** `apps/api/src/routes/patients.ts`

```typescript
// MISSING: Zod validation on POST /patients
// Current code — manual check only:
if (!firstName || !lastName || !phone) {
  return res.status(400).json({ error: 'Required fields missing' })
}

// SHOULD BE:
const schema = z.object({
  firstName:  z.string().min(1).max(100),
  lastName:   z.string().min(1).max(100),
  phone:      z.string().regex(/^\+?[0-9]{9,15}$/),
  email:      z.string().email().optional(),
  dateOfBirth: z.string().datetime().optional(),
  // ... all fields
})
```

**HTTP status code inconsistencies found:**
- Some 400s returned as 500
- 404s not returned when resource absent in some PATCH routes
- No 422 (Unprocessable Entity) for semantic validation failures

---

## 3. Reliability and Security

> Healthcare applications handling personal and medical data are subject to Uganda's Data Protection and Privacy Act 2019 and, where EU patients are involved, GDPR. The findings below represent significant legal and reputational risk.

### 3.1 🔴 CRITICAL — Secrets Committed to Git

**File:** `codeclinic/.env`

The actual `.env` file is present in the repository and contains live credentials:

```
ANTHROPIC_API_KEY=sk-ant-...       # Claude API — billing risk
OPENAI_API_KEY=sk-proj-...         # OpenAI — billing risk
AT_API_KEY=atsk_...                # Africa's Talking — SMS billing
CLOUDFLARE_R2_SECRET_ACCESS_KEY=cfat_... # Storage — data access
GOOGLE_CLIENT_SECRET=GOCSPX-...    # OAuth — account takeover risk
DATABASE_URL=postgresql://...       # Direct DB access
JWT_SECRET=...                      # Token forgery
```

**Immediate action required:**
1. Rotate ALL keys listed above — they are now compromised regardless of whether anyone has read them
2. Remove `.env` from git history: `git filter-branch` or BFG Repo Cleaner
3. Add `.env` to `.gitignore` (`.env.example` already exists — use that)
4. Move secrets to Railway environment variables (already partly done for production)

### 3.2 🔴 CRITICAL — Access Token Expiry Ignored

**File:** `apps/api/src/routes/auth.ts`, line 29

```typescript
// CURRENT — hardcoded, ignores JWT_EXPIRES_IN env var
const signAccess = (payload: object) =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' })

// .env.example has: JWT_EXPIRES_IN=15m  <-- never used

// FIX:
const signAccess = (payload: object) =>
  jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  })
```

A 7-day access token means a stolen token is valid for a week. Healthcare apps should use 15–60 minute access tokens with refresh token rotation.

### 3.3 🔴 CRITICAL — No Environment Variable Validation

**File:** `apps/api/src/main.ts` — no startup validation

```typescript
// ADD: validate env at startup using zod
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL:       z.string().url(),
  JWT_SECRET:         z.string().min(32),
  JWT_EXPIRES_IN:     z.string().default('15m'),
  ANTHROPIC_API_KEY:  z.string().startsWith('sk-ant-'),
  NODE_ENV:           z.enum(['development', 'production', 'test']),
  APP_URL:            z.string().url(),
})

const env = envSchema.safeParse(process.env)
if (!env.success) {
  console.error('Invalid environment variables:', env.error.format())
  process.exit(1)
}
```

### 3.4 🟠 HIGH — Missing Authorization Checks

**File:** `apps/api/src/routes/patients.ts`, lines ~145–170

```typescript
// CURRENT — any authenticated user can update any patient
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params  // no ownership check

// FIX — receptionist can only edit, doctor can only view clinical, admin can do all
router.patch('/:id', requireAuth, requireRole(['ADMIN', 'RECEPTIONIST']), async (req, res) => {
  // Additionally, a doctor should not be able to change billing fields
```

**Routes missing authorization checks:**
- `PATCH /patients/:id` — no role check
- `DELETE /patients/:id` — no role check
- `GET /scheduling/blocked-times` — returns all blocked times regardless of doctor
- `PATCH /employees/:id` — any authenticated user can change employee data
- `GET /accounts/transactions` — no org-level scoping found

### 3.5 🟠 HIGH — CORS Over-Permissive

**File:** `apps/api/src/main.ts`, line 77 (before fix applied in last commit)

The wildcard `origin.endsWith('.railway.app')` allowed any Railway-hosted app to call the API with credentials. The recent commit (`31b5ff1`) tightened this, but the remaining wildcard still applies:

```typescript
// REMAINING RISK — any .railway.app domain is allowed
// An attacker deploying to Railway can now call your API with credentials

// RECOMMENDED: remove the wildcard entirely
origin: (origin, cb) => {
  if (!origin) return cb(null, true)
  if (allowedOrigins.includes(origin)) return cb(null, true)
  cb(new Error(`CORS: ${origin} not allowed`))
}
// and maintain an explicit allowedOrigins list only
```

### 3.6 🟠 HIGH — No Error Tracking / Observability

**Current state:** All errors logged to `console.error()` only. In Railway, these appear in log drain but:
- No alerting on error spikes
- No stack trace aggregation
- No user impact tracking
- No performance anomaly detection

**Fix — add Sentry:**

```bash
pnpm add @sentry/node @sentry/nextjs
```

```typescript
// apps/api/src/main.ts
import * as Sentry from '@sentry/node'
Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV })

// Replace global error handler:
app.use(Sentry.expressErrorHandler())
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: 'Internal server error', id: Sentry.lastEventId() })
})
```

### 3.7 🟠 HIGH — Audit Logs Silently Drop

**File:** `apps/api/src/middleware/audit.ts`, line ~37

```typescript
// CURRENT — fire-and-forget, failures silently swallowed
auditLogger.log({ ... }).catch(console.error)

// FIX — await in non-critical path but log failures properly
try {
  await auditLogger.log({ ... })
} catch (err) {
  // Still serve the request, but capture the audit failure
  Sentry.captureException(err, { tags: { type: 'audit_failure' } })
}
```

### 3.8 🟡 MEDIUM — Medical Data Unencrypted

The Patient model has `medicalNotesEncrypted String?` suggesting encryption was intended, but no encryption logic is implemented in the patients routes. Patient data fields (allergies, medicalHistory, dateOfBirth) are stored as plain text.

**Fix — field-level encryption:**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function encryptField(value: string): string {
  const iv  = randomBytes(16)
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  // ... return iv + authTag + encrypted as base64
}
```

Apply to: `medicalHistory`, `allergies`, `medicalNotesEncrypted` before Prisma write; decrypt on read.

### 3.9 🟡 MEDIUM — No Session Invalidation / Token Blacklist

**File:** `apps/api/src/routes/auth.ts`

There is no logout endpoint that invalidates tokens. A user who logs out can still use their old token until it expires (7 days currently).

**Fix:**
```typescript
// Add a Redis-backed token blacklist
import { redis } from '../lib/redis'

// On logout:
router.post('/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]
  const decoded = jwt.decode(token!) as { exp: number }
  const ttl = decoded.exp - Math.floor(Date.now() / 1000)
  await redis.setex(`blacklist:${token}`, ttl, '1')
  res.json({ success: true })
})

// In auth middleware:
const blacklisted = await redis.get(`blacklist:${token}`)
if (blacklisted) return res.status(401).json({ error: 'Token revoked' })
```

### 3.10 🟡 MEDIUM — No HTTPS Enforcement

No middleware redirects HTTP to HTTPS. Currently relies entirely on Railway's reverse proxy. A direct connection to the API port would be unencrypted.

```typescript
// Add HSTS header and HTTP redirect
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.header('x-forwarded-proto') !== 'https') {
    return res.redirect(301, `https://${req.hostname}${req.url}`)
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})
```

### 3.11 Reliability Gaps

| Gap | Description | Fix |
|-----|-------------|-----|
| Dockerfile `|| true` on build | Compile errors silently ignored — broken container starts | Remove `|| true` from build commands |
| Dockerfile `|| true` on migrations | App starts with stale schema | Fail fast: remove `|| true` from migration entrypoint |
| Health check no DB check | `/health` returns OK even when DB is down | Add `prisma.$queryRaw('SELECT 1')` to health check |
| Scheduler error handling | Scheduler errors logged but not retried or alerted | Implement exponential backoff + Sentry alert |
| No circuit breaker | Claude API / WhatsApp API failures cascade | Wrap external calls with `opossum` circuit breaker |
| Single point of failure | No Redis fallback when Redis is down | Cache layer should degrade gracefully |

---

## 4. Usability

### 4.1 TypeScript Strict Mode

**File:** `apps/api/tsconfig.json`

```json
// CURRENT
{ "compilerOptions": { "strict": false } }

// FIX
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

This is the single highest-leverage code quality change. With `strict: false`, TypeScript provides almost no type safety — implicit `any`, unchecked nulls, and unsafe property access are all allowed silently.

### 4.2 Accessibility (WCAG 2.1 AA)

**Current state:** Only 2 ARIA attributes found across the entire frontend codebase.

A dental clinic management system is used by receptionists, doctors, and administrators — including users with disabilities. WCAG 2.1 AA compliance is a legal requirement in many jurisdictions and a professional expectation in healthcare software.

**Required changes:**

```tsx
// Every interactive element needs accessible labels
// CURRENT
<button onClick={handleBook}>📅</button>

// FIX
<button onClick={handleBook} aria-label="Book appointment">
  📅 <span>Book</span>
</button>

// Form inputs need labels
// CURRENT
<input placeholder="Patient name" />

// FIX
<label htmlFor="patientName">Patient name</label>
<input id="patientName" placeholder="Enter full name" aria-required="true" />
```

**Full accessibility audit checklist:**
- [ ] All images have `alt` text
- [ ] All form controls have associated `<label>` elements
- [ ] All interactive elements reachable by keyboard (`Tab`, `Enter`, `Space`)
- [ ] Focus order is logical
- [ ] Colour contrast ratio ≥ 4.5:1 for text
- [ ] Error messages programmatically associated with fields
- [ ] Modal dialogs trap focus and announce with `role="dialog"` + `aria-modal="true"`
- [ ] Data tables have `<th scope>` headers
- [ ] Status updates announced via `aria-live="polite"`
- [ ] Skip-to-main-content link

**Recommended tool:** Run `axe-core` via Playwright in CI and `eslint-plugin-jsx-a11y` in the editor.

### 4.3 Error Boundaries

**Current state:** No `error.tsx` files or React ErrorBoundary components anywhere in `apps/web`.

A single unhandled React error crashes the entire page. For a multi-module dashboard, errors in one widget should not take down the whole screen.

```tsx
// apps/web/app/error.tsx — Next.js App Router error boundary
'use client'
export default function Error({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

Add `error.tsx` at every route segment level (receptionist, admin, etc.).

### 4.4 Loading States

**Current state:** Some pages show spinners (`useState(true)` for loading), but no skeleton screens. On slow networks, users see blank panels before data loads.

```tsx
// Replace blank loading states with skeleton screens
import { Skeleton } from '@/components/ui/skeleton'

function PatientListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
```

### 4.5 Form UX Gaps

| Issue | Affected Form | Fix |
|-------|--------------|-----|
| No client-side validation feedback | New Patient, New Appointment | Add inline field errors with react-hook-form + zod resolver |
| No confirmation dialog on destructive actions | Delete patient, Cancel appointment | Add AlertDialog before irreversible actions |
| No optimistic updates | Appointment status change | Update UI immediately, revert on error |
| No autosave on long forms | Patient profile | Debounced PATCH or draft localStorage |
| No unsaved-changes warning | Patient edit page | `beforeunload` + router.beforePopState guard |

### 4.6 Internationalisation

The app serves a Ugandan market. While English is appropriate, consider:
- Date/time formatting: EAT (UTC+3) — currently handled server-side with `Africa/Kampala` timezone
- Currency: UGX amounts stored as `Float` — should be `Int` (UGX has no cents). Also no formatting as `UGX 50,000`
- Phone number format: +256 prefix assumed but not enforced or normalised

---

## 5. Maintainability and Technical Quality

### 5.1 TypeScript Strict Mode (Repeated — Highest Priority)

See §4.1. Enabling `strict: true` on the API will surface dozens of latent type errors that are currently silent bugs. This must be the first code-quality change made.

### 5.2 Code Organisation

**File:** `apps/api/src/ai-suite/agent/agent.service.ts` — **679 lines**

This file contains the entire AI agent logic including: the system prompt, context builder, 6 booking state handlers, slot parsing utilities, and the Claude API call. It violates the Single Responsibility Principle and will become unmaintainable.

**Proposed structure:**

```
ai-suite/agent/
  agent.service.ts          # getAgentReply() only — thin orchestrator
  agent.system-prompt.ts    # SARAH_SYSTEM_PROMPT constant
  agent.context.ts          # buildContext() — DB fetches
  booking/
    booking.state.ts        # state machine (already extracted)
    booking.service.ts      # availability/create (already extracted)
    booking.handlers.ts     # handleAwaiting* functions
    booking.parsers.ts      # parseSlotChoice, parsePreferredDay, etc.
    booking.intent.ts       # detectIntent()
```

**File:** `apps/api/src/routes/auth.ts` — **342 lines**

Should be split into `auth.login.ts`, `auth.register.ts`, `auth.2fa.ts`, `auth.google.ts`, `auth.refresh.ts`.

### 5.3 Linting and Formatting

**Current state:** No ESLint config, no Prettier config.

```bash
# Install
pnpm add -Dw eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm add -Dw eslint-plugin-import eslint-plugin-unicorn prettier

# Root .eslintrc.json
{
  "root": true,
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}

# .prettierrc
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "es5"
}
```

Add to `package.json` scripts:
```json
"lint": "eslint apps/api/src --ext .ts",
"format": "prettier --write apps/api/src apps/web",
"type-check": "tsc --noEmit"
```

### 5.4 Code Duplication

**File:** `apps/api/src/ai-suite/agent/agent.service.ts`, lines 325–559

The booking state machine has 6 nearly-identical handler functions each following the same pattern: parse intent → lookup DB → construct response → set/clear state. This should be a data-driven state machine:

```typescript
// Instead of 6 separate handler functions, use a state config object
const STATE_HANDLERS: Record<BookingStateKey, StateHandler> = {
  AWAITING_SERVICE:           { parse: parseService,     next: 'AWAITING_DOCTOR_PREFERENCE' },
  AWAITING_DOCTOR_PREFERENCE: { parse: parseDoctorPref,  next: 'AWAITING_DOCTOR_NAME' },
  AWAITING_DOCTOR_NAME:       { parse: parseDoctorName,  next: 'AWAITING_SLOT_CONFIRMATION' },
  AWAITING_SLOT_CONFIRMATION: { parse: parseSlotChoice,  next: 'IDLE' },
  AWAITING_RESCHEDULE_SLOT:   { parse: parseSlotChoice,  next: 'IDLE' },
  AWAITING_CANCEL_CONFIRMATION: { parse: parseYesNo,     next: 'IDLE' },
}
```

### 5.5 API Documentation

**Current state:** Zero API documentation. No OpenAPI spec, no Swagger, no README per-route.

```typescript
// Install swagger-jsdoc + swagger-ui-express
// Then annotate routes:

/**
 * @openapi
 * /patients:
 *   post:
 *     summary: Create a new patient
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePatient'
 *     responses:
 *       '201':
 *         description: Patient created
 *       '409':
 *         description: Phone number already registered
 */
```

Alternatively, use `@asteasolutions/zod-to-openapi` to auto-generate from existing Zod schemas.

### 5.6 Database Migration Hygiene

**Current state:** 1 migration named `sqlite_init` targeting PostgreSQL.

```bash
# Create a proper baseline migration
cd packages/database
npx prisma migrate resolve --applied 20260403104850_sqlite_init
npx prisma migrate dev --name add_missing_indexes
npx prisma migrate dev --name convert_string_to_enums
npx prisma migrate dev --name add_patient_conditions_table
```

Maintain a `CHANGELOG.md` in the database package documenting each schema change and the reason.

### 5.7 Dependency Management

| Issue | Detail | Fix |
|-------|--------|-----|
| `@anthropic-ai/sdk@^0.26.0` | Current SDK is 0.53+ — missing prompt caching, computer use, files API | Upgrade to `^0.53` |
| `next@^14.2.4` | Next.js 15 released — React 19 support, improved caching | Plan upgrade |
| `jsonwebtoken@^9.0.2` | Stable — OK | — |
| `bcryptjs` vs `bcrypt` | `bcryptjs` is pure JS, slower than native `bcrypt` | Switch to `bcrypt` for faster hashing |
| `openai@^6.34.0` | Present but no visible usage paths in core routes | Audit: is this actually used? Remove if not |
| `drachtio-srf@^5.0.22` | Voice SIP — only active if DRACHTIO_HOST set | Document this optional dependency clearly |

### 5.8 Structured Logging

**Current state:** `console.log/error` throughout.

```typescript
// Install pino
pnpm add pino pino-http
pnpm add -D pino-pretty

// apps/api/src/lib/logger.ts
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
  base: { service: 'codeclinic-api' },
})

// In routes:
logger.info({ patientId, action: 'patient.created' }, 'Patient created')
logger.error({ err, patientId }, 'Failed to create patient')
```

This makes logs searchable in Railway's log drain and compatible with log aggregation services (Logtail, Datadog, etc.).

---

## 6. Performance Efficiency

### 6.1 Database N+1 in Agent Context Builder

**File:** `apps/api/src/ai-suite/agent/agent.service.ts`, `buildContext()`, lines 79–158

Every inbound message triggers 5–6 sequential database queries:

```typescript
// CURRENT — sequential queries on every message
const patient       = await prisma.patient.findUnique(...)      // query 1
const messages      = await prisma.aiMessage.findMany(...)       // query 2
const appointments  = await prisma.appointment.findMany(...)     // query 3
const knowledgeDocs = await prisma.aiKnowledgeBase.findMany(...) // query 4
const services      = await prisma.service.findMany(...)         // query 5
const doctors       = await prisma.doctor.findMany(...)          // query 6

// FIX — parallelise independent queries
const [patient, messages, appointments, knowledgeDocs, services, doctors] =
  await Promise.all([
    prisma.patient.findUnique(...),
    prisma.aiMessage.findMany(...),
    prisma.appointment.findMany(...),
    prisma.aiKnowledgeBase.findMany(...),
    prisma.service.findMany({ where: { isActive: true } }),
    prisma.doctor.findMany({ where: { isActive: true } }),
  ])
```

Additionally, services and doctors change rarely — cache them:

```typescript
// In-memory cache with 5-minute TTL (acceptable staleness for a menu)
let cachedServices: Service[] | null = null
let servicesExpiresAt = 0

async function getActiveServices(): Promise<Service[]> {
  if (cachedServices && Date.now() < servicesExpiresAt) return cachedServices
  cachedServices = await prisma.service.findMany({ where: { isActive: true } })
  servicesExpiresAt = Date.now() + 5 * 60 * 1000
  return cachedServices
}
```

### 6.2 Claude API Token Usage

**File:** `apps/api/src/ai-suite/agent/agent.service.ts`, line 660

```typescript
max_tokens: 150  // This is the maximum output length
```

The system prompt is ~150 tokens. Services and doctors context can be 300–500 tokens. The full system message is likely 800–1200 tokens on each call, with no caching.

**Fix — enable Anthropic prompt caching:**

```typescript
const response = await client.messages.create({
  model:      'claude-sonnet-4-6',
  max_tokens: 200,
  system: [
    {
      type: 'text',
      text: activeSystemPrompt,
      cache_control: { type: 'ephemeral' }  // Cache static prompt — saves ~70% on tokens
    },
    {
      type: 'text',
      text: [clinicInfo, services, doctors].join('\n')
      // This also rarely changes — could be cached
    }
  ],
  messages,
})
```

With 1000 conversations/day × 150 system tokens × $3/MTok = ~$0.45/day saved from caching alone.

### 6.3 Missing Redis Integration

**Current state:** Redis is declared as a dependency in `docker-compose.yml` and `.env.example` has `REDIS_URL`, but Redis is not used anywhere in the codebase. The `packages` directory has no Redis client setup.

**Uses Redis should serve:**
- Session/booking state (currently in-memory Map — lost on restart)
- Token blacklist (see §3.9)
- Rate limit counter storage (express-rate-limit memory store is not distributed)
- Service/doctor context cache

```typescript
// packages/cache/src/redis.ts
import { createClient } from 'redis'

export const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

// Booking state — currently in-memory Map, lost on API restart
// Maps are fine for single-instance dev but fail in multi-instance prod
export async function setBookingState(from: string, state: BookingState) {
  await redis.setEx(`booking:${from}`, 3600, JSON.stringify(state))
}
```

### 6.4 Prisma Connection Pool Configuration

Prisma defaults to 10 connections. For a Railway instance with significant concurrent load:

```
// In DATABASE_URL:
postgresql://user:pass@host/db?connection_limit=20&pool_timeout=10
```

Also add a graceful shutdown to release connections:

```typescript
process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  server.close()
})
```

### 6.5 Next.js Frontend Performance

| Issue | Detail | Fix |
|-------|--------|-----|
| `<img>` tags instead of `<Image>` | Images not lazy-loaded, not optimised | Replace with `next/image` throughout |
| No dynamic imports | Large components (charts, calendars) loaded eagerly | `const Calendar = dynamic(() => import('./Calendar'), { ssr: false })` |
| No `React.memo` on expensive list items | Patient list re-renders on every parent state change | Wrap row components with `React.memo` |
| No SWR/React Query | Each page fetches fresh data on every mount | Use `swr` or `@tanstack/react-query` for caching + revalidation |
| Large bundle — no bundle analysis | Unknown bundle size | Add `@next/bundle-analyzer` to `next.config.js` |

### 6.6 Database Index Audit

**Missing indexes for common query patterns:**

```prisma
model Appointment {
  @@index([doctorId, scheduledAt])      // Calendar view
  @@index([patientId, scheduledAt])     // Patient history
  @@index([status, scheduledAt])        // Today's appointments dashboard
  @@index([clinicId, status])           // Admin dashboard
}

model AiMessage {
  @@index([conversationId, createdAt])  // Chat history load
}

model Invoice {
  @@index([patientId, status])          // Billing view
  @@index([status, dueDate])            // Overdue invoice report
}

model Patient {
  @@index([lastName, firstName])        // Search by name
  @@index([isActive, createdAt])        // Patient list
}
```

---

## 7. Portability and Adaptability

### 7.1 Environment Configuration

**Current state:** Good `.env.example` with 94 variables. Gaps:

| Gap | Issue |
|-----|-------|
| `ENCRYPTION_KEY` defined but unused | No encryption implementation |
| `REDIS_URL` defined but Redis not used | Dead configuration |
| Google OAuth redirect hardcoded to production URL | Cannot run OAuth locally |
| `APP_URL` must be set correctly — no validation | Startup failure if missed |
| No documented minimum required variables | New developer doesn't know which vars are mandatory |

**Fix — document required vs optional:**

```bash
# .env.example — mark required vs optional
# ─── REQUIRED — app will not start without these ──────────────────────────
DATABASE_URL=postgresql://...
JWT_SECRET=your-32-char-minimum-secret
ANTHROPIC_API_KEY=sk-ant-...
APP_URL=http://localhost:3000

# ─── OPTIONAL — features degrade gracefully if absent ─────────────────────
REDIS_URL=redis://localhost:6379         # Required for multi-instance
AT_API_KEY=...                            # Required for SMS
TWILIO_ACCOUNT_SID=...                   # Required for WhatsApp
GOOGLE_CLIENT_ID=...                     # Required for Google login
```

### 7.2 Docker / Containerisation

**Dockerfile.api issues:**

```dockerfile
# CURRENT — silently ignores compile and migration errors
RUN pnpm build || true
ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy || true && node dist/main.js"]

# FIX — fail fast on errors
RUN pnpm build
ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

**Missing in Docker setup:**
- No health check `HEALTHCHECK` directive in Dockerfile
- No non-root user (app runs as root — security risk)
- No `.dockerignore` verification (`.env` might be copied into image)

```dockerfile
# Add non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:${PORT}/health || exit 1
```

### 7.3 Multi-Tenancy Readiness

The application appears to be designed for a single clinic but has a `clinicId` field on some models. If multi-tenancy is planned:

| Requirement | Status | Gap |
|-------------|--------|-----|
| `clinicId` on all entities | ⚠️ Partial | Not on all models |
| Row-level security (RLS) | ❌ Missing | Prisma queries don't filter by clinicId automatically |
| Tenant isolation | ❌ Missing | No middleware to inject clinicId from JWT |
| Shared vs dedicated DB | Not decided | Shared schema currently |

### 7.4 Third-Party Service Coupling

The application is tightly coupled to specific vendors:

| Vendor | Integration Point | Abstraction Layer? |
|--------|-------------------|-------------------|
| Anthropic Claude | `agent.service.ts` — direct SDK calls | ❌ No interface |
| Africa's Talking | SMS and WhatsApp direct | ❌ No interface |
| Cloudflare R2 | AWS S3-compatible SDK | ✅ Abstracted via S3 client |
| Railway | Hard-coded railway.app URLs | ⚠️ Some hardcoding |
| Twilio | WhatsApp alternative | ❌ If used |

**Fix — create provider interfaces:**

```typescript
// ai-suite/providers/llm.provider.ts
export interface LLMProvider {
  complete(systemPrompt: string, messages: Message[]): Promise<string>
}

// ai-suite/providers/anthropic.provider.ts
export class AnthropicProvider implements LLMProvider {
  async complete(system, messages) { /* Anthropic SDK */ }
}

// Easily swap to OpenAI, Gemini, or local model
```

### 7.5 Node.js Version Pin

**File:** Root `package.json`

```json
"engines": { "node": ">=20.0.0" }  // CURRENT — too broad

// FIX — pin to LTS minor
"engines": { "node": "^20.12.0" }

// Add .nvmrc
echo "20.12.0" > .nvmrc
```

### 7.6 Database Portability

Prisma supports multiple databases. The schema currently has `provider = "postgresql"`. The sqlite_init migration name suggests the project originated as SQLite. Ensure no SQLite-specific constructs remain (e.g., auto-increment vs sequence, BLOB vs bytea).

---

## 8. Testability

> **Current state: 0 tests. No CI. No coverage.**

This is the most significant professional engineering gap in the codebase. A healthcare application with zero automated tests cannot safely evolve — every change carries unknown risk.

### 8.1 Testing Strategy

**Recommended pyramid:**

```
        [E2E — 5%]           Playwright: critical user journeys
      [Integration — 35%]    Supertest: API routes + DB
    [Unit — 60%]             Vitest: services, utils, parsers
```

### 8.2 Unit Tests — Agent Service Parsers

The booking state machine parsers (`parseSlotChoice`, `parsePreferredDay`, `parseTimeOfDay`) are pure functions with clear inputs/outputs — ideal first test targets.

```typescript
// apps/api/src/ai-suite/agent/__tests__/booking.parsers.test.ts
import { describe, it, expect } from 'vitest'
import { parseSlotChoice } from '../booking/booking.parsers'

describe('parseSlotChoice', () => {
  it('returns 1 for "option 1"', () => {
    expect(parseSlotChoice('I\'ll take option 1 please')).toBe(1)
  })
  it('returns null for non-numeric input', () => {
    expect(parseSlotChoice('sounds good')).toBeNull()
  })
  it('handles "first" as 1', () => {
    expect(parseSlotChoice('the first one')).toBe(1)
  })
})
```

### 8.3 Integration Tests — API Routes

```typescript
// apps/api/src/__tests__/patients.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import app from '../main'
import { prisma } from '../lib/prisma'

describe('POST /patients', () => {
  let authToken: string

  beforeAll(async () => {
    const res = await supertest(app)
      .post('/auth/login')
      .send({ email: 'test@clinic.com', password: 'TestPass123!' })
    authToken = res.body.accessToken
  })

  it('creates a patient with valid data', async () => {
    const res = await supertest(app)
      .post('/patients')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ firstName: 'Test', lastName: 'Patient', phone: '+256700000001' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
  })

  it('rejects duplicate phone number', async () => {
    const payload = { firstName: 'Dup', lastName: 'Patient', phone: '+256700000002' }
    await supertest(app).post('/patients').set('Authorization', `Bearer ${authToken}`).send(payload)
    const res = await supertest(app).post('/patients').set('Authorization', `Bearer ${authToken}`).send(payload)
    expect(res.status).toBe(409)
  })

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { phone: { startsWith: '+25670000000' } } })
  })
})
```

### 8.4 E2E Tests — Critical User Journeys

```typescript
// apps/web/e2e/booking.spec.ts
import { test, expect } from '@playwright/test'

test('receptionist can book an appointment', async ({ page }) => {
  await page.goto('/receptionist')
  await page.getByRole('link', { name: 'Schedule' }).click()
  await page.getByRole('button', { name: 'New appointment' }).click()
  await page.getByLabel('Patient').fill('Nakato')
  await page.getByRole('option', { name: 'Nakato Sarah' }).click()
  await page.getByLabel('Service').selectOption('Dental Checkup')
  await page.getByLabel('Date').fill('2026-05-01')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByText('Appointment booked')).toBeVisible()
})
```

### 8.5 Test Setup

```bash
# Install test dependencies
pnpm add -Dw vitest @vitest/coverage-v8 supertest @types/supertest
pnpm add -Dw @playwright/test
pnpm add -Dw @testcontainers/postgresql  # Spin up real PG for integration tests
```

```json
// vitest.config.ts
export default {
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { lines: 70, functions: 70, branches: 60 }
    }
  }
}
```

### 8.6 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_PASSWORD: testpass
        ports: ['5432:5432']

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm type-check
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm test:integration
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -f Dockerfile.api -t codeclinic-api .
      - run: docker build -f Dockerfile.web -t codeclinic-web .
```

### 8.7 Testability Design Improvements

For code to be testable, it must be written with dependency injection in mind. The current codebase instantiates `new PrismaClient()` inside service files:

```typescript
// CURRENT — impossible to mock
const prisma = new PrismaClient()

// FIX — inject via constructor or module parameter
export async function buildContext(
  conversationId: string,
  from: string,
  message: string,
  prismaClient = prisma  // injectable, defaults to real client
): Promise<ContextPackage>
```

Similarly, the Claude API client should be injectable for unit testing without network calls.

---

## 9. Prioritised Action Plan

### Phase 1 — Security & Stability (Week 1–2)
*Must be done before any patient data is live in production*

| # | Action | File(s) | Effort | Owner |
|---|--------|---------|--------|-------|
| 1 | Rotate all secrets + remove .env from git | `.env`, `.gitignore` | 2h | DevOps |
| 2 | Enable TypeScript strict mode on API | `apps/api/tsconfig.json` + fix errors | 8h | Backend |
| 3 | Add environment variable validation at startup | `apps/api/src/main.ts` | 2h | Backend |
| 4 | Fix JWT expiry to use env var (15m) | `apps/api/src/routes/auth.ts:29` | 30min | Backend |
| 5 | Add role-based authorization checks to all routes | `routes/*.ts` | 6h | Backend |
| 6 | Implement token blacklist on logout | `routes/auth.ts` + Redis | 3h | Backend |
| 7 | Fix Dockerfile — remove `|| true` silencers | `Dockerfile.api` | 30min | DevOps |
| 8 | Fix `TreatmentNote.authorId` dangling relation | `schema.prisma` | 1h | Backend |
| 9 | Add Sentry for error tracking | `apps/api`, `apps/web` | 3h | Backend |
| 10 | Add `/health` database connectivity check | `main.ts` | 1h | Backend |

### Phase 2 — Code Quality (Sprint 1–2, Weeks 3–6)

| # | Action | File(s) | Effort |
|---|--------|---------|--------|
| 11 | Add ESLint + Prettier configs | Root `/.eslintrc.json`, `/.prettierrc` | 4h |
| 12 | Add Zod schemas to all POST/PATCH routes | `routes/*.ts` | 12h |
| 13 | Convert string fields to Prisma enums | `schema.prisma` + migration | 4h |
| 14 | Add missing DB indexes | `schema.prisma` + migration | 2h |
| 15 | Parallelise `buildContext` queries | `agent.service.ts:79-158` | 2h |
| 16 | Split `agent.service.ts` into modules | See §5.2 proposed structure | 8h |
| 17 | Enable Redis (booking state + cache) | New `packages/cache` | 6h |
| 18 | Add structured logging (pino) | All routes | 4h |
| 19 | Fix audit log awaiting | `middleware/audit.ts` | 1h |
| 20 | Add React ErrorBoundary at each route | `apps/web/app/**/error.tsx` | 3h |

### Phase 3 — Testing & CI (Sprint 3–4, Weeks 7–10)

| # | Action | Effort |
|---|--------|--------|
| 21 | Set up Vitest + test infra | 4h |
| 22 | Unit tests — booking parsers (80%+ coverage) | 8h |
| 23 | Integration tests — auth routes | 6h |
| 24 | Integration tests — patient CRUD | 6h |
| 25 | Integration tests — scheduling | 6h |
| 26 | GitHub Actions CI pipeline | 4h |
| 27 | Playwright E2E — booking flow | 6h |
| 28 | Playwright E2E — admin dashboard | 4h |

### Phase 4 — Performance & Polish (Sprint 5–6, Weeks 11–14)

| # | Action | Effort |
|---|--------|--------|
| 29 | Enable Anthropic prompt caching | 2h |
| 30 | Add skeleton screens for data tables | 6h |
| 31 | WCAG 2.1 AA accessibility audit + fixes | 16h |
| 32 | Implement field-level encryption (medical data) | 8h |
| 33 | Add OpenAPI documentation | 12h |
| 34 | Normalise medicalHistory to junction table | 6h |
| 35 | Bundle analysis + code splitting | 4h |
| 36 | Database backup strategy documentation | 2h |

---

## 10. Effort / Impact Matrix

```
                        HIGH IMPACT
                            |
 5  [2] Strict TS    [1] Secrets   [9] Sentry
                            |
 4  [12] Zod valid.  [5] Auth-z    [26] CI/CD
    [17] Redis                      [22-25] Tests
                            |
 3  [15] DB parallel [13] Enums    [29] Prompt cache
    [11] ESLint       [20] Errors   [31] A11y
                            |
 2  [18] Logging     [14] Indexes  [30] Skeletons
    [19] Audit fix    [16] Refactor [34] Medical encrypt
                            |
 1  [4] JWT expiry   [7] Dockerfile [10] Healthcheck
    [3] Env validate  [8] FK fix
                            |
LOW  ←————————— EFFORT ————————————→  HIGH
     1hr          4hr          8hr      16hr+
```

**Quick wins (high impact, low effort):**
- Fix JWT expiry hardcode — `30 minutes`
- Enable TypeScript strict mode — `1 day`
- Add Sentry — `half day`
- Fix Dockerfile `|| true` — `5 minutes`
- Rotate secrets — `1 hour`

---

## Appendix A — Quality Score Card

| Quality Characteristic | Current Score | Target | Gap |
|------------------------|--------------|--------|-----|
| **Functionality & Correctness** | 55 / 100 | 85 | 30pts — data model issues, missing validation, business logic gaps |
| **Reliability & Security** | 25 / 100 | 90 | 65pts — secrets exposed, no monitoring, auth weaknesses |
| **Usability** | 40 / 100 | 80 | 40pts — strict TS off, no a11y, no error boundaries |
| **Maintainability & Quality** | 35 / 100 | 85 | 50pts — no linting, no docs, long files, duplication |
| **Performance Efficiency** | 50 / 100 | 80 | 30pts — sequential queries, no caching, no bundle analysis |
| **Portability & Adaptability** | 55 / 100 | 80 | 25pts — env hardcoding, Docker issues, vendor coupling |
| **Testability** | 5 / 100 | 85 | 80pts — zero tests, no CI, no DI pattern |
| **OVERALL** | **38 / 100** | **84** | **46pts** |

---

## Appendix B — File Reference Index

| File | Sections |
|------|---------|
| `apps/api/src/main.ts` | §3.3, §3.5, §3.11, §7.2 |
| `apps/api/src/routes/auth.ts` | §3.2, §3.9, §5.2 |
| `apps/api/src/routes/patients.ts` | §2.4, §3.4, §8.3 |
| `apps/api/src/routes/services.ts` | §2.4 |
| `apps/api/src/ai-suite/agent/agent.service.ts` | §5.2, §5.4, §6.1, §6.2, §8.7 |
| `apps/api/src/middleware/audit.ts` | §3.7 |
| `apps/api/tsconfig.json` | §4.1, §5.1 |
| `packages/database/prisma/schema.prisma` | §2.2, §2.3, §6.6 |
| `Dockerfile.api` | §7.2 |
| `docker-compose.yml` | §6.3 |
| `.env` (should not exist in repo) | §3.1 |
| `apps/web/app/layout.tsx` | §4.3 |
| `apps/web/public/chatbot-widget.js` | §2.1 |

---

*End of report. Total estimated remediation effort: ~170 engineering hours across 14 weeks for a team of 2.*