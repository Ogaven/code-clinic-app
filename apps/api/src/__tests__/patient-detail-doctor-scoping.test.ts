import { describe, expect, it, vi, beforeAll } from 'vitest'

// Full end-to-end coverage for GET /patients/:id and GET /patients authorization,
// driving the ACTUAL Express pipeline (router.param + route handler together) —
// not just the final handler in isolation. This matters because the doctor
// cross-patient guard (requireDoctorPatientAccess, lib/doctor-access.ts) is
// wired via router.param('id', ...) in patients.ts, not inside the /:id
// handler itself; a test that only grabs the handler's last stack entry
// (the pattern used by patient-clinical-notes-authorization.test.ts) never
// exercises that guard at all. This file closes that gap and proves, for the
// same synthetic fixtures, that:
//   - ADMIN and RECEPTIONIST are unaffected by the doctor guard (pass through)
//   - a DOCTOR who has an appointment with the patient is allowed (200)
//   - a DOCTOR who has never seen the patient is denied (404, no data leaked)
//   - RECEPTIONIST still gets medicalNotesEncrypted redacted to null
//   - the patient LIST endpoint scopes results to a DOCTOR's own patients
//     via the same appointment relationship, so list and detail can't drift
//     independently
//
// No real database, no real patient. patients.ts transitively imports
// ../lib/env (via requireAuth/rbac), which process.exit(1)s if
// DATABASE_URL/JWT_SECRET/JWT_REFRESH_SECRET are unset in this worktree —
// same stubbing pattern as staff-ui-closure.test.ts /
// patient-clinical-notes-authorization.test.ts.

const RELATED_PATIENT = {
  id: 'patient-related',
  patientNumber: 1,
  firstName: 'Related',
  lastName: 'Patient',
  phone: '+256700000001',
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

const UNRELATED_PATIENT = {
  ...RELATED_PATIENT,
  id: 'patient-unrelated',
  firstName: 'Unrelated',
  lastName: 'Patient',
  phone: '+256700000002',
}

const NO_NOTES_PATIENT = {
  ...RELATED_PATIENT,
  id: 'patient-no-notes',
  firstName: 'NoNotes',
  lastName: 'Patient',
  phone: '+256700000003',
  medicalNotesEncrypted: null,
}

let patientsRouter: any
let detailHandler: (req: any, res: any) => Promise<void>
let detailParamGuard: (req: any, res: any, next: any, id: string) => Promise<void>
let listHandler: (req: any, res: any) => Promise<void>
let findManyMock: ReturnType<typeof vi.fn>
let auditLogCreateMock: ReturnType<typeof vi.fn>

beforeAll(async () => {
  process.env.DATABASE_URL       ??= 'postgresql://user:pass@localhost:5432/test'
  process.env.JWT_SECRET         ??= 'x'.repeat(32)
  process.env.JWT_REFRESH_SECRET ??= 'y'.repeat(32)

  findManyMock = vi.fn().mockResolvedValue([])
  auditLogCreateMock = vi.fn().mockResolvedValue({})

  vi.doMock('../lib/prisma', () => ({
    prisma: {
      patient: {
        findUnique: vi.fn(async ({ where: { id } }: any) =>
          id === RELATED_PATIENT.id ? RELATED_PATIENT
          : id === UNRELATED_PATIENT.id ? UNRELATED_PATIENT
          : id === NO_NOTES_PATIENT.id ? NO_NOTES_PATIENT
          : null),
        findMany: findManyMock,
        count: vi.fn().mockResolvedValue(0),
      },
      appointment: {
        // Only the RELATED patient has ever had an appointment with the
        // authenticated doctor (doctorId 'doctor-a') — this is the sole
        // signal requireDoctorPatientAccess / the list where-clause use.
        findFirst: vi.fn(async ({ where }: any) =>
          where.doctorId === 'doctor-a' && where.patientId === RELATED_PATIENT.id
            ? { id: 'appt-1' }
            : null),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: auditLogCreateMock,
      },
    },
  }))
  vi.doMock('../services/storage/r2', () => ({
    getPublicUrl: vi.fn(() => 'https://example.invalid/fake-avatar.png'),
    uploadAvatar: vi.fn(),
    deleteFile:   vi.fn(),
  }))

  patientsRouter = (await import('../routes/patients')).default

  const detailLayer = (patientsRouter as any).stack.find((l: any) => l.route?.path === '/:id' && l.route.methods.get)
  detailHandler = detailLayer.route.stack[detailLayer.route.stack.length - 1].handle
  detailParamGuard = (patientsRouter as any).params.id[0]

  const listLayer = (patientsRouter as any).stack.find((l: any) => l.route?.path === '/' && l.route.methods.get)
  listHandler = listLayer.route.stack[listLayer.route.stack.length - 1].handle
}, 30000)

// Chains the param guard and the route handler exactly as Express would:
// the handler only runs if the guard calls next() with no error.
async function requestDetail(patientId: string, role: string, doctorId?: string) {
  const req: any = { params: { id: patientId }, user: { id: 'staff-1', role, doctorId }, headers: {}, ip: '127.0.0.1' }
  const json = vi.fn()
  const res: any = { json, status: vi.fn().mockReturnThis() }
  let nextErr: any = 'not-called'
  await detailParamGuard(req, res, (err?: any) => { nextErr = err ?? null }, patientId)
  if (nextErr === null) await detailHandler(req, res)
  return { body: json.mock.calls[0]?.[0], status: res.status.mock.calls[0]?.[0], guardBlocked: nextErr === 'not-called' }
}

describe('GET /patients/:id — doctor cross-patient access is denied server-side', () => {
  it('ADMIN is allowed and unaffected by the doctor guard', async () => {
    const { body, guardBlocked } = await requestDetail(RELATED_PATIENT.id, 'ADMIN')
    expect(guardBlocked).toBe(false)
    expect(body.id).toBe(RELATED_PATIENT.id)
    expect(body.medicalNotesEncrypted).toBe(RELATED_PATIENT.medicalNotesEncrypted)
  })

  it('a DOCTOR with an appointment relationship to the patient is allowed and sees clinical notes', async () => {
    const { body, guardBlocked } = await requestDetail(RELATED_PATIENT.id, 'DOCTOR', 'doctor-a')
    expect(guardBlocked).toBe(false)
    expect(body.medicalNotesEncrypted).toBe(RELATED_PATIENT.medicalNotesEncrypted)
  })

  it('a DOCTOR with NO appointment relationship to the patient is denied with 404 and no data leaked', async () => {
    const { body, status, guardBlocked } = await requestDetail(UNRELATED_PATIENT.id, 'DOCTOR', 'doctor-a')
    expect(guardBlocked).toBe(true)
    expect(status).toBe(404)
    expect(body).not.toHaveProperty('medicalNotesEncrypted')
    expect(JSON.stringify(body)).not.toContain(UNRELATED_PATIENT.firstName)
  })

  it('RECEPTIONIST is allowed (existing access model) but medicalNotesEncrypted stays redacted', async () => {
    const { body, guardBlocked } = await requestDetail(RELATED_PATIENT.id, 'RECEPTIONIST')
    expect(guardBlocked).toBe(false)
    expect(body.medicalNotesEncrypted).toBeNull()
    expect(body.allergies).toBe(RELATED_PATIENT.allergies)
  })
})

describe('GET /patients — list is scoped the same way, so list and detail cannot drift', () => {
  it('a DOCTOR only sees patients scoped by their own appointments in the where-clause', async () => {
    findManyMock.mockClear()
    const req: any = { query: {}, user: { id: 'staff-1', role: 'DOCTOR', doctorId: 'doctor-a' } }
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() }
    await listHandler(req, res)
    const { where } = findManyMock.mock.calls[0][0]
    expect(JSON.stringify(where.AND)).toContain('doctor-a')
  })

  it('ADMIN sees the unscoped list — no doctorId filter added', async () => {
    findManyMock.mockClear()
    const req: any = { query: {}, user: { id: 'staff-2', role: 'ADMIN' } }
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() }
    await listHandler(req, res)
    const { where } = findManyMock.mock.calls[0][0]
    expect(JSON.stringify(where.AND)).not.toContain('appointments')
  })
})

describe('GET /patients/:id — sensitive-view audit trail', () => {
  it('logs a VIEW_SENSITIVE audit entry when a clinical role actually receives real clinical notes, without recording the note content itself', async () => {
    auditLogCreateMock.mockClear()
    await requestDetail(RELATED_PATIENT.id, 'ADMIN')
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1)
    const entry = auditLogCreateMock.mock.calls[0][0].data
    expect(entry.actionType).toBe('VIEW_SENSITIVE')
    expect(entry.entityType).toBe('PATIENT')
    expect(entry.entityId).toBe(RELATED_PATIENT.id)
    expect(JSON.stringify(entry)).not.toContain(RELATED_PATIENT.medicalNotesEncrypted)
  })

  it('does NOT log an audit entry when Reception views the same profile (field is redacted, nothing sensitive was actually disclosed)', async () => {
    auditLogCreateMock.mockClear()
    await requestDetail(RELATED_PATIENT.id, 'RECEPTIONIST')
    expect(auditLogCreateMock).not.toHaveBeenCalled()
  })

  it('does NOT log an audit entry for a patient with no clinical notes on file, even for a clinical role (nothing sensitive to disclose)', async () => {
    auditLogCreateMock.mockClear()
    const { body } = await requestDetail(NO_NOTES_PATIENT.id, 'ADMIN')
    expect(body.medicalNotesEncrypted).toBeNull()
    expect(auditLogCreateMock).not.toHaveBeenCalled()
  })
})
