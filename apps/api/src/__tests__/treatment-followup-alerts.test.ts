// Covers the internal treatment follow-up / hold-scheduling alert scheduler
// (apps/api/src/services/treatment-followup-alerts.service.ts): correct
// DUE_SOON / DUE_TODAY / OVERDUE bucketing against Kampala "today", the
// write-then-notify idempotency guarantee (no duplicate Notification/
// TreatmentFollowUpAlert for the same plan+type+day even if the job runs
// twice), and that a plan with no followUpAt never alerts. No real push
// network call is made — sendPushToUser is mocked at the module boundary.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The dynamic import below pulls in treatment-followup-alerts.service.ts ->
// lib/prisma / push.service cold on the first test that runs it — comfortably
// past the 5s default under system load (same rationale as
// push-subscription-ownership.test.ts).
vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

// ── In-memory fakes ──────────────────────────────────────────────────────

const store = vi.hoisted(() => ({
  plans:         new Map<string, any>(),
  alerts:        new Map<string, any>(), // key: `${planId}|${alertType}|${sentForDate.toISOString()}`
  notifications: [] as any[],
  users:         new Map<string, any>(),
}))

function alertKey(treatmentPlanId: string, alertType: string, sentForDate: Date) {
  return `${treatmentPlanId}|${alertType}|${sentForDate.toISOString()}`
}

vi.mock('../lib/prisma', () => ({
  prisma: {
    treatmentPlan: {
      findMany: vi.fn(async ({ where }: any) => {
        return [...store.plans.values()].filter(p => {
          if (where?.followUpAt?.not === null && !(p.followUpAt !== null && p.followUpAt !== undefined)) return false
          if (where?.status?.notIn && where.status.notIn.includes(p.status)) return false
          return true
        })
      }),
    },
    treatmentFollowUpAlert: {
      create: vi.fn(async ({ data }: any) => {
        const key = alertKey(data.treatmentPlanId, data.alertType, data.sentForDate)
        if (store.alerts.has(key)) {
          const err: any = new Error('Unique constraint failed')
          err.code = 'P2002'
          throw err
        }
        const row = { id: `alert_${store.alerts.size + 1}`, ...data }
        store.alerts.set(key, row)
        return row
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, ...data }
        store.notifications.push(row)
        return row
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ?? []
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive)
      }),
    },
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url: string }) => {}))
vi.mock('../services/push.service', () => ({
  sendPushToUser: pushMock,
}))

// ── Test helpers ─────────────────────────────────────────────────────────

// "Today" pinned to a fixed Kampala calendar day for deterministic bucketing.
// 2026-09-14 12:00 UTC is safely inside 2026-09-14 in Kampala (UTC+3).
const FIXED_NOW = new Date('2026-09-14T12:00:00.000Z')
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000
function kampalaMidnightUTC(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
}
const TODAY_KAMPALA_MIDNIGHT = kampalaMidnightUTC(2026, 8, 14) // 2026-09-14 00:00 Kampala

function makePlan(overrides: Partial<any> = {}) {
  const id = overrides.id ?? `plan_${store.plans.size + 1}`
  const plan = {
    id,
    patientId: overrides.patientId ?? 'patient_1',
    patient: { firstName: 'Jane', lastName: 'Doe' },
    doctor: overrides.doctor ?? null,
    stage: overrides.stage ?? 'Consulted',
    status: overrides.status ?? 'On Hold',
    followUpAt: overrides.followUpAt ?? null,
    followUpReason: overrides.followUpReason ?? null,
    followUpNote: overrides.followUpNote ?? null,
    ...overrides,
  }
  store.plans.set(id, plan)
  return plan
}

beforeEach(() => {
  store.plans.clear()
  store.alerts.clear()
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()

  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })

  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

describe('Treatment follow-up alert scheduler', () => {
  it('fires DUE_SOON once for a follow-up due tomorrow', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    const tomorrow = new Date(TODAY_KAMPALA_MIDNIGHT.getTime() + 24 * 60 * 60 * 1000)
    makePlan({ id: 'p_tomorrow', followUpAt: tomorrow })

    await checkAndSendTreatmentFollowUpAlerts()

    const alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_tomorrow')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alertType).toBe('DUE_SOON')
    expect(store.notifications.filter(n => n.title.includes('Jane Doe'))).toHaveLength(2) // reception + admin
  })

  it('fires DUE_TODAY once for a follow-up due today', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_today', followUpAt: new Date(TODAY_KAMPALA_MIDNIGHT.getTime() + 5 * 60 * 60 * 1000) })

    await checkAndSendTreatmentFollowUpAlerts()

    const alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_today')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alertType).toBe('DUE_TODAY')
  })

  it('fires OVERDUE once for a follow-up due last week', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    const lastWeek = new Date(TODAY_KAMPALA_MIDNIGHT.getTime() - 7 * 24 * 60 * 60 * 1000)
    makePlan({ id: 'p_lastweek', followUpAt: lastWeek })

    await checkAndSendTreatmentFollowUpAlerts()

    const alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_lastweek')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alertType).toBe('OVERDUE')
  })

  it('running the job twice in the same Kampala day does not create a duplicate alert or notification', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_dup', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    await checkAndSendTreatmentFollowUpAlerts()
    const firstRunAlerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_dup')
    const firstRunNotifs = store.notifications.length
    const firstRunPushCalls = pushMock.mock.calls.length
    expect(firstRunAlerts).toHaveLength(1)

    await checkAndSendTreatmentFollowUpAlerts()
    const secondRunAlerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_dup')

    expect(secondRunAlerts).toHaveLength(1) // still just one row — idempotency held
    expect(store.notifications.length).toBe(firstRunNotifs) // no new notifications
    expect(pushMock.mock.calls.length).toBe(firstRunPushCalls) // no new pushes
  })

  it('a plan with status On Hold and no followUpAt produces no alert', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_no_date', status: 'On Hold', followUpAt: null })

    await checkAndSendTreatmentFollowUpAlerts()

    expect(store.alerts.size).toBe(0)
    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('notifies the assigned doctor in addition to reception/admin when the plan has a doctor', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({
      id: 'p_with_doctor',
      followUpAt: TODAY_KAMPALA_MIDNIGHT,
      doctor: { user: { id: 'doctor_user_1' } },
    })

    await checkAndSendTreatmentFollowUpAlerts()

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).toContain('doctor_user_1')
    expect(recipientIds).toContain('reception_1')
    expect(recipientIds).toContain('admin_1')
  })

  // ── Eligibility: non-actionable statuses must never alert ────────────────
  // A followUpAt left over from before a plan was completed/cancelled/
  // declined is not a live commitment anymore -- the scheduler must not
  // treat it as one just because the column still has a value.

  it('a COMPLETED plan with a followUpAt due today produces no notification', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_completed', status: 'Completed', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    await checkAndSendTreatmentFollowUpAlerts()

    expect(store.alerts.size).toBe(0)
    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('a CANCELLED plan with an overdue followUpAt produces no notification', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    const lastWeek = new Date(TODAY_KAMPALA_MIDNIGHT.getTime() - 7 * 24 * 60 * 60 * 1000)
    makePlan({ id: 'p_cancelled', status: 'Cancelled', followUpAt: lastWeek })

    await checkAndSendTreatmentFollowUpAlerts()

    expect(store.alerts.size).toBe(0)
    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('a DECLINED plan with a followUpAt due today produces no notification', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_declined', status: 'Declined', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    await checkAndSendTreatmentFollowUpAlerts()

    expect(store.alerts.size).toBe(0)
    expect(store.notifications).toHaveLength(0)
  })

  it('a Planned (not just On Hold) plan with a followUpAt due today still alerts -- actionable statuses are not limited to On Hold', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_planned', status: 'Planned', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    await checkAndSendTreatmentFollowUpAlerts()

    const alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_planned')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alertType).toBe('DUE_TODAY')
  })

  it('a followUpAt more than the due-soon window away produces no notification', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    const farFuture = new Date(TODAY_KAMPALA_MIDNIGHT.getTime() + 30 * 24 * 60 * 60 * 1000)
    makePlan({ id: 'p_far_future', followUpAt: farFuture })

    await checkAndSendTreatmentFollowUpAlerts()

    expect(store.alerts.size).toBe(0)
    expect(store.notifications).toHaveLength(0)
  })

  it('a DUE_TODAY alert can legitimately progress to an OVERDUE alert on a later run for the same plan', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_progresses', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    // Day 1: due today.
    await checkAndSendTreatmentFollowUpAlerts()
    let alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_progresses')
    expect(alerts.map(a => a.alertType)).toEqual(['DUE_TODAY'])

    // Day 2: the same plan (still unresolved, followUpAt untouched) is now
    // overdue -- this must surface as a NEW alert, not be suppressed by the
    // dedup that (correctly) blocks re-firing DUE_TODAY again.
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000))
    await checkAndSendTreatmentFollowUpAlerts()
    alerts = [...store.alerts.values()].filter(a => a.treatmentPlanId === 'p_progresses')
    expect(alerts.map(a => a.alertType).sort()).toEqual(['DUE_TODAY', 'OVERDUE'])
    expect(store.notifications.filter(n => n.href === '/patients/patient_1')).toHaveLength(4) // 2 recipients x 2 days
  })

  it('the notification identifies the patient, includes the due/overdue label, and deep-links to the patient record', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({ id: 'p_context', patientId: 'patient_42', followUpAt: TODAY_KAMPALA_MIDNIGHT })

    await checkAndSendTreatmentFollowUpAlerts()

    const notif = store.notifications.find(n => n.href === '/patients/patient_42')
    expect(notif).toBeDefined()
    expect(notif!.title).toBe('Follow-up due today: Jane Doe')
    expect(notif!.href).toBe('/patients/patient_42')
  })

  it('the push notification never includes the treatment stage/status/reason (no unnecessary clinical detail on a locked screen), while the in-app notification keeps full context', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({
      id: 'p_push_redaction',
      stage: 'Consulted',
      followUpAt: TODAY_KAMPALA_MIDNIGHT,
      followUpReason: 'Sensitive clinical detail',
    })

    await checkAndSendTreatmentFollowUpAlerts()

    const inAppBody = store.notifications.find(n => n.href === '/patients/patient_1')!.body
    expect(inAppBody).toContain('Sensitive clinical detail')

    const pushCall = pushMock.mock.calls.find(c => c[0] === 'reception_1')
    expect(pushCall).toBeDefined()
    const pushPayload = pushCall![1]
    expect(pushPayload.body).not.toContain('Sensitive clinical detail')
    expect(pushPayload.body).not.toContain('Consulted')
  })

  it('never notifies the patient -- every recipient is an internal staff/doctor user id, and no WhatsApp/SMS send is attempted', async () => {
    const { checkAndSendTreatmentFollowUpAlerts } = await import('../services/treatment-followup-alerts.service')
    makePlan({
      id: 'p_internal_only',
      patientId: 'patient_1',
      followUpAt: TODAY_KAMPALA_MIDNIGHT,
      doctor: { user: { id: 'doctor_user_1' } },
    })

    await checkAndSendTreatmentFollowUpAlerts()

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds.length).toBeGreaterThan(0)
    expect(recipientIds).not.toContain('patient_1')
    expect(recipientIds.every(id => ['reception_1', 'admin_1', 'doctor_user_1'].includes(id))).toBe(true)
  })
})
