// Covers the fixes made to GET /reports/clinical (apps/api/src/routes/reports.ts):
//  (a) the appointment-status breakdown always reconciles exactly to
//      Scheduled — Seen + Confirmed + Pending + Cancelled + No-shows +
//      Rescheduled === Total Scheduled — now that it's computed via the
//      canonical getAppointmentStatusBreakdown (patient-analytics.service.ts)
//      instead of a locally-duplicated, incomplete status set (the old code
//      silently dropped IMPORTED-status appointments from every bucket).
//  (b) New + Returning === Patients Seen for the same range, via the shared
//      getPatientActivitySummary.
//  (c) day boundaries are anchored to the Kampala calendar day (UTC+3, no
//      DST), not the API host's system timezone or bare UTC midnight — the
//      classic "20:59 UTC is still today in Kampala, 21:01 UTC is already
//      tomorrow" edge case.
//
// The route handler is invoked directly (pulled off the router's own stack,
// bypassing requireAuth) against an in-memory fake of the two Prisma models
// it touches (appointment, patient) plus the no-op patientActivity lookup —
// no real database involved.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── In-memory fake Prisma ───────────────────────────────────────────────

interface FakeAppt {
  id: string
  patientId: string
  startAt: Date
  status: string
  followUpSent: boolean
  followUpSentAt: Date | null
  patient: { id: string; firstName: string; lastName: string; phone: string }
  doctor: null
  service: null
}

const store = vi.hoisted(() => ({
  appointments: [] as FakeAppt[],
  patients: [] as { id: string; firstName: string; lastName: string; phone: string; importSource: string | null }[],
}))

function inRange(d: Date, where: any): boolean {
  if (!where?.startAt) return true
  const { gte, lt, lte, gt } = where.startAt
  if (gte && d < gte) return false
  if (lt && !(d < lt)) return false
  if (lte && !(d <= lte)) return false
  if (gt && !(d > gt)) return false
  return true
}

function matchStatus(status: string, where: any): boolean {
  if (!where?.status) return true
  if (where.status.in) return where.status.in.includes(status)
  if (where.status.notIn) return !where.status.notIn.includes(status)
  return status === where.status
}

function matchPatientId(patientId: string, where: any): boolean {
  if (!where?.patientId) return true
  if (where.patientId.in) return where.patientId.in.includes(patientId)
  return patientId === where.patientId
}

function matchAppt(a: FakeAppt, where: any): boolean {
  return inRange(a.startAt, where) && matchStatus(a.status, where) && matchPatientId(a.patientId, where)
}

vi.mock('../lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async (args: any = {}) => {
        let rows = store.appointments.filter(a => matchAppt(a, args.where))
        if (args.orderBy?.startAt === 'asc') rows = [...rows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        if (args.distinct?.includes('patientId')) {
          const seen = new Set<string>()
          rows = rows.filter(a => (seen.has(a.patientId) ? false : (seen.add(a.patientId), true)))
        }
        return rows.map(a => ({ ...a }))
      }),
      groupBy: vi.fn(async (args: any = {}) => {
        const rows = store.appointments.filter(a => matchAppt(a, args.where))
        const counts = new Map<string, number>()
        for (const a of rows) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
        return [...counts.entries()].map(([status, count]) => ({ status, _count: { _all: count } }))
      }),
    },
    patient: {
      count: vi.fn(async () => store.patients.length),
      findMany: vi.fn(async (args: any = {}) => {
        // Only real caller is splitNewAndReturning's importedPatients lookup,
        // which always filters importSource: { not: null } — mirror that
        // directly rather than generically interpreting the where clause.
        const ids: string[] = args.where?.id?.in ?? []
        return store.patients
          .filter(p => ids.includes(p.id) && p.importSource !== null)
          .map(p => ({ id: p.id }))
      }),
    },
    patientActivity: {
      findMany: vi.fn(async () => []),
    },
  },
}))

// ── Route handler extraction ────────────────────────────────────────────

function mockRes() {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

async function callClinicalReport(query: Record<string, string>) {
  const { default: router } = await import('../routes/reports')
  const stack = (router as any).stack as any[]
  const layer = stack.find(l => l.route?.path === '/clinical' && l.route.methods.get)
  const handler = layer.route.stack[layer.route.stack.length - 1].handle
  const req: any = { query }
  const res = mockRes()
  await handler(req, res)
  expect(res.status).not.toHaveBeenCalledWith(500)
  return res.json.mock.calls[0][0]
}

// ── Fixtures ─────────────────────────────────────────────────────────────

let apptSeq = 0
function makePatient(overrides: Partial<(typeof store.patients)[number]> = {}) {
  const id = overrides.id ?? `patient_${store.patients.length + 1}`
  const patient = { id, firstName: 'Test', lastName: 'Patient', phone: '+256700000000', importSource: null, ...overrides }
  store.patients.push(patient)
  return patient
}
function makeAppt(patientId: string, startAt: Date, status: string): FakeAppt {
  const patient = store.patients.find(p => p.id === patientId)!
  const appt: FakeAppt = {
    id: `appt_${++apptSeq}`,
    patientId,
    startAt,
    status,
    followUpSent: false,
    followUpSentAt: null,
    patient: { id: patient.id, firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone },
    doctor: null,
    service: null,
  }
  store.appointments.push(appt)
  return appt
}

beforeEach(() => {
  store.appointments.length = 0
  store.patients.length = 0
  apptSeq = 0
})

// 2026-09-14 12:00 UTC (= 15:00 Kampala) is safely inside 2026-09-14 in
// Kampala (UTC+3, no DST) — a convenient noon anchor for "somewhere in the
// middle of the day" fixtures.
const DAY_ANCHOR = new Date('2026-09-14T12:00:00.000Z')

describe('GET /reports/clinical — status reconciliation', () => {
  it('status buckets sum exactly to Scheduled total for a seeded date range', async () => {
    const p1 = makePatient()
    const p2 = makePatient()
    const p3 = makePatient()
    const p4 = makePatient()
    const p5 = makePatient()
    const p6 = makePatient()
    const p7 = makePatient()

    makeAppt(p1.id, DAY_ANCHOR, 'COMPLETED')              // seen
    makeAppt(p2.id, DAY_ANCHOR, 'IMPORTED')               // seen (the old code silently dropped this)
    makeAppt(p3.id, DAY_ANCHOR, 'CONFIRMED')              // confirmed
    makeAppt(p4.id, DAY_ANCHOR, 'PENDING')                // pending
    makeAppt(p5.id, DAY_ANCHOR, 'CANCELLED')              // cancelled
    makeAppt(p6.id, DAY_ANCHOR, 'NO_SHOW')                // no-show
    makeAppt(p7.id, DAY_ANCHOR, 'RESCHEDULED')            // rescheduled

    const report = await callClinicalReport({ view: 'daily', date: '2026-09-14' })
    const m = report.metrics

    expect(m.totalScheduled).toBe(7)
    expect(m.totalSeen + m.confirmed + m.pending + m.cancelled + m.noShows + m.rescheduled).toBe(m.totalScheduled)
    // Explicit check that the previously-separate "Cancelled & Not
    // Rescheduled" bucket is gone — Cancelled is just Cancelled now.
    expect(m).not.toHaveProperty('cancelledNotRescheduled')
    expect(m.cancelled).toBe(1)
  })

  it('New + Returning equals Patients Seen for the same range', async () => {
    const newPatient = makePatient()
    const returningPatient = makePatient()

    // returningPatient has an attended visit well before the report range.
    makeAppt(returningPatient.id, new Date('2026-01-10T12:00:00.000Z'), 'COMPLETED')

    // Both patients are seen inside the reported range.
    makeAppt(newPatient.id, DAY_ANCHOR, 'COMPLETED')
    makeAppt(returningPatient.id, DAY_ANCHOR, 'COMPLETED')

    const report = await callClinicalReport({ view: 'daily', date: '2026-09-14' })
    const m = report.metrics

    expect(m.totalSeen).toBe(2)
    expect(m.newPatients).toBe(1)
    expect(m.returningPatients).toBe(1)
    expect(m.newPatients + m.returningPatients).toBe(m.totalSeen)
  })
})

describe('GET /reports/clinical — Kampala day-boundary attribution', () => {
  it('20:59 UTC on day N belongs to Kampala day N, and 21:01 UTC on day N belongs to Kampala day N+1', async () => {
    const pLate  = makePatient() // 23:59 Kampala on the 13th
    const pEarly = makePatient() // 00:01 Kampala on the 14th

    makeAppt(pLate.id,  new Date('2026-09-13T20:59:00.000Z'), 'CONFIRMED')
    makeAppt(pEarly.id, new Date('2026-09-13T21:01:00.000Z'), 'CONFIRMED')

    const day13 = await callClinicalReport({ view: 'daily', date: '2026-09-13' })
    expect(day13.metrics.totalScheduled).toBe(1)
    expect(day13.metrics.confirmed).toBe(1)

    const day14 = await callClinicalReport({ view: 'daily', date: '2026-09-14' })
    expect(day14.metrics.totalScheduled).toBe(1)
    expect(day14.metrics.confirmed).toBe(1)
  })
})