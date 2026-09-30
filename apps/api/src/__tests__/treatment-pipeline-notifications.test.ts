// Covers the staff operational notification hooks added around the
// existing, already-verified Treatment Pipeline transitions
// (apps/api/src/routes/pipeline.ts): notifyDoctorAssigned and
// notifyTreatmentNeedsScheduling are exported (like notifyStaffOfDeliveryFailure
// in whatsapp.routes.ts) specifically for direct unit testing rather than
// only through full HTTP route requests, since the hooks themselves — not
// the surrounding route plumbing already covered elsewhere — are what's new
// in this milestone. No new stage/status is introduced; these tests only
// assert who gets notified and that routing never crosses between doctors.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')
// clinical.ts constructs an OpenAI client at module load time — inert
// placeholder only, never used by notifyDoctorAssignedOnCreate itself.
process.env.OPENAI_API_KEY     ??= 'test-key-not-real'

const store = vi.hoisted(() => ({
  doctors:       new Map<string, any>(), // id -> { id, userId }
  users:         new Map<string, any>(),
  notifications: [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(async ({ where }: any) => store.doctors.get(where.id) ?? null),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ?? []
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive)
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, isRead: false, ...data }
        store.notifications.push(row)
        return row
      }),
    },
    // Untouched by these two hooks directly, but logAudit (imported
    // transitively elsewhere in pipeline.ts) swallows its own errors, so no
    // mock is required here for these tests to pass.
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../services/push.service', () => ({
  sendPushToUser: pushMock,
}))

beforeEach(() => {
  store.doctors.clear()
  store.users.clear()
  store.notifications.length = 0
  pushMock.mockClear()

  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  store.doctors.set('doctor_a', { id: 'doctor_a', userId: 'doctor_a_user' })
  store.doctors.set('doctor_b', { id: 'doctor_b', userId: 'doctor_b_user' })
})

describe('notifyDoctorAssigned — exact-user routing, never cross-doctor', () => {
  it('notifies only the assigned doctor\'s own user id, with a deep link to the patient', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_a', 'patient_1')

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('doctor_a_user')
    expect(store.notifications[0].href).toBe('/patients/patient_1')
  })

  it('Doctor A never receives a notification for a case assigned to Doctor B', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_b', 'patient_2')

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).toContain('doctor_b_user')
    expect(recipientIds).not.toContain('doctor_a_user')
  })

  it('never notifies Reception/Admin for a doctor-assignment event — this is the assigned doctor\'s own case only', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_a', 'patient_1')

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).not.toContain('reception_1')
    expect(recipientIds).not.toContain('admin_1')
  })

  it('is a safe no-op when the doctorId does not resolve to a real doctor record', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_nonexistent', 'patient_1')

    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('sends a lock-screen-safe push (no patient id/name in the push body) while the in-app record deep-links to the patient', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_a', 'patient_999')

    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushPayload = pushMock.mock.calls[0][1]
    expect(pushPayload.body).not.toContain('patient_999')
    expect(store.notifications[0].href).toBe('/patients/patient_999')
  })
})

describe('notifyTreatmentNeedsScheduling — Reception/Admin routing, not the treating doctor', () => {
  it('notifies every active Reception and Admin user, deep-linked to the patient', async () => {
    const { notifyTreatmentNeedsScheduling } = await import('../routes/pipeline')

    await notifyTreatmentNeedsScheduling('patient_5')

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'reception_1'])
    expect(store.notifications.every(n => n.href === '/patients/patient_5')).toBe(true)
  })

  it('never notifies a doctor user — this event belongs to front-desk/admin scheduling, not a clinician', async () => {
    const { notifyTreatmentNeedsScheduling } = await import('../routes/pipeline')

    await notifyTreatmentNeedsScheduling('patient_5')

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).not.toContain('doctor_a_user')
    expect(recipientIds).not.toContain('doctor_b_user')
  })

  it('skips an inactive Reception/Admin user', async () => {
    store.users.set('reception_inactive', { id: 'reception_inactive', role: 'RECEPTIONIST', isActive: false })
    const { notifyTreatmentNeedsScheduling } = await import('../routes/pipeline')

    await notifyTreatmentNeedsScheduling('patient_5')

    expect(store.notifications.map(n => n.userId)).not.toContain('reception_inactive')
  })
})

describe('notifyDoctorAssignedOnCreate (clinical.ts) — the second write path for doctorId, at treatment-plan creation', () => {
  it('notifies only the newly assigned doctor\'s own user id, matching pipeline.ts\'s routing exactly', async () => {
    const { notifyDoctorAssignedOnCreate } = await import('../routes/clinical')

    await notifyDoctorAssignedOnCreate('doctor_a', 'patient_7')

    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].userId).toBe('doctor_a_user')
    expect(store.notifications[0].href).toBe('/patients/patient_7')
  })

  it('Doctor A is never notified for a plan created and assigned to Doctor B', async () => {
    const { notifyDoctorAssignedOnCreate } = await import('../routes/clinical')

    await notifyDoctorAssignedOnCreate('doctor_b', 'patient_8')

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).toEqual(['doctor_b_user'])
  })
})

describe('Treatment pipeline notifications — multi-device is push.service\'s job, not this hook\'s', () => {
  it('calls sendPushToUser exactly once per recipient regardless of how many devices they have registered', async () => {
    const { notifyDoctorAssigned } = await import('../routes/pipeline')

    await notifyDoctorAssigned('doctor_a', 'patient_1')

    // One user, one call — push.service.ts owns per-device fan-out internally.
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
})
