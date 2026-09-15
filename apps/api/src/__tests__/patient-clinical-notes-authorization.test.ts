import { describe, expect, it, vi, beforeAll } from 'vitest'

// Regression coverage for the GDPR fix to GET /patients/:id: medicalNotesEncrypted
// (deeper clinical content than allergies/medicalHistory, which front-desk
// legitimately needs) was previously returned to every authenticated role —
// no UI for Receptionist ever displayed it, but the raw API response did.
// These tests prove the server-side boundary now matches the UI's own intent,
// without touching a real database or any real patient record — the patient
// row below is entirely synthetic, built only to exercise the redaction logic.
//
// patients.ts transitively imports ../lib/env (via requireAuth / rbac), which
// process.exit(1)s if DATABASE_URL/JWT_SECRET/JWT_REFRESH_SECRET are unset in
// this worktree (no .env here) — same stubbing pattern as staff-ui-closure.test.ts.
// The module graph (router, requireAuth, mocks) is loaded ONCE in beforeAll —
// resetModules per-test was correct but expensive (each reload re-runs the
// whole import chain, including startup logging), pushing individual tests
// past the default 5s timeout; nothing here needs isolation between tests
// since the mock always returns the same static fixture regardless of role.
function routerLevelMiddlewares(router: any): Function[] {
  return router.stack.filter((l: any) => !l.route).map((l: any) => l.handle)
}

// Entirely fake — not a real patient, real phone number, or real clinical
// content. Only exists to prove the field is/isn't present in the response.
const FAKE_PATIENT = {
  id: 'fake-patient-id',
  patientNumber: 1,
  firstName: 'Test',
  lastName: 'Patient',
  phone: '+256700000000',
  medicalNotesEncrypted: 'FAKE-NOT-REAL-CLINICAL-CONTENT',
  avatarR2Key: null,
  accountBalance: 0,
  allergies: 'None recorded (test fixture)',
  appointments: [],
  invoices: [],
  feedback: [],
  guardian: null,
  dependents: [],
}

let patientsRouter: any
let requireAuth: any
let handler: (req: any, res: any) => Promise<void>

beforeAll(async () => {
  process.env.DATABASE_URL       ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.JWT_SECRET         ??= 'x'.repeat(32)
  process.env.JWT_REFRESH_SECRET ??= 'y'.repeat(32)

  vi.doMock('../lib/prisma', () => ({
    prisma: { patient: { findUnique: vi.fn().mockResolvedValue(FAKE_PATIENT) } },
  }))
  vi.doMock('../services/storage/r2', () => ({
    getPublicUrl: vi.fn(() => 'https://example.invalid/fake-avatar.png'),
    uploadAvatar: vi.fn(),
    deleteFile:   vi.fn(),
  }))

  patientsRouter = (await import('../routes/patients')).default
  requireAuth    = (await import('../middleware/auth')).requireAuth
  const layer = (patientsRouter as any).stack.find((l: any) => l.route?.path === '/:id' && l.route.methods.get)
  handler = layer.route.stack[layer.route.stack.length - 1].handle
}, 30000)

async function callWithRole(role: string) {
  const req: any = { params: { id: FAKE_PATIENT.id }, user: { id: 'staff-1', role } }
  const json = vi.fn()
  const res: any = { json, status: vi.fn().mockReturnThis() }
  await handler(req, res)
  return json.mock.calls[0]?.[0]
}

describe('GET /patients/:id — medicalNotesEncrypted authorization', () => {
  it('requireAuth is wired at the router level, so unauthenticated requests to /:id are blocked before any handler runs', () => {
    expect(routerLevelMiddlewares(patientsRouter)).toContain(requireAuth)
  })

  it('ADMIN receives the real medicalNotesEncrypted value', async () => {
    const body = await callWithRole('ADMIN')
    expect(body.medicalNotesEncrypted).toBe(FAKE_PATIENT.medicalNotesEncrypted)
  })

  it('DOCTOR receives the real medicalNotesEncrypted value', async () => {
    const body = await callWithRole('DOCTOR')
    expect(body.medicalNotesEncrypted).toBe(FAKE_PATIENT.medicalNotesEncrypted)
  })

  it('RECEPTIONIST does NOT receive the medicalNotesEncrypted value — redacted to null', async () => {
    const body = await callWithRole('RECEPTIONIST')
    expect(body.medicalNotesEncrypted).toBeNull()
    expect(body.medicalNotesEncrypted).not.toBe(FAKE_PATIENT.medicalNotesEncrypted)
  })

  it('ACCOUNTS (non-clinical role) does NOT receive the medicalNotesEncrypted value — redacted to null', async () => {
    const body = await callWithRole('ACCOUNTS')
    expect(body.medicalNotesEncrypted).toBeNull()
  })

  it('redaction never touches front-desk-safe fields like allergies — those pass through unchanged for every role', async () => {
    const admin = await callWithRole('ADMIN')
    const receptionist = await callWithRole('RECEPTIONIST')
    expect(admin.allergies).toBe(FAKE_PATIENT.allergies)
    expect(receptionist.allergies).toBe(FAKE_PATIENT.allergies)
  })
})
