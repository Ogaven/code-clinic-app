// Covers notifyReceptionIfWaitlistUnfilled (crm-automation/waitlist.service.ts)
// — the new Reception operational alert fired when a cancellation opened a
// slot with real waitlist demand that automation could NOT auto-fill
// (consent declined / channel paused). Deliberately does NOT fire for the
// routine cases: no waitlist demand at all, or automation successfully
// notified someone — those aren't actionable for Reception.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NotifyWaitlistResult } from '../../crm-automation/waitlist.service'

vi.setConfig({ testTimeout: 20000 })

const store = vi.hoisted(() => ({
  notifications: [] as any[],
  users: new Map<string, any>(),
}))

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ?? []
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive)
      }),
    },
    notification: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.notifications.find(n =>
          n.userId === where.userId && n.href === where.href && n.title === where.title && n.isRead === where.isRead
        ) ?? null
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, isRead: false, ...data }
        store.notifications.push(row)
        return row
      }),
    },
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url?: string }) => {}))
vi.mock('../../services/push.service', () => ({ sendPushToUser: pushMock }))

function result(overrides: Partial<NotifyWaitlistResult> = {}): NotifyWaitlistResult {
  return {
    eligibleCount: 1,
    targetingMode: 'MATCHED',
    notified: [],
    skipped: [],
    ...overrides,
  }
}

beforeEach(() => {
  store.notifications.length = 0
  store.users.clear()
  pushMock.mockClear()
  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
})

describe('notifyReceptionIfWaitlistUnfilled', () => {
  it('alerts Reception + Admin when candidates existed but none could be auto-notified', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] }),
      'appt-1',
    )

    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'reception_1'])
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT alert when there was simply no waitlist demand for the cancelled service', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(result({ targetingMode: 'DISABLED_NO_MATCH' }), 'appt-1')

    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('does NOT alert when automation successfully notified at least one waitlisted patient', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ notified: [{ patientId: 'p1', waitlistEntryId: 'we1', channel: 'WHATSAPP', dryRun: false }] }),
      'appt-1',
    )

    expect(store.notifications).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('never includes a Doctor user as a recipient', async () => {
    store.users.set('doctor_1', { id: 'doctor_1', role: 'DOCTOR', isActive: true })
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] }),
      'appt-1',
    )

    expect(store.notifications.map(n => n.userId)).not.toContain('doctor_1')
  })

  it('the push body is generic — no patient id/phone, while the in-app body can carry operational detail', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] }),
      'appt-1',
    )

    const pushPayload = pushMock.mock.calls[0][1]
    expect(pushPayload.body).not.toContain('p1')
    expect(pushPayload.url).toContain('appt-1')
  })

  it('uses role-specific hrefs scoped to the cancelled appointment', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] }),
      'appt-42',
    )

    const byUser = Object.fromEntries(store.notifications.map(n => [n.userId, n.href]))
    expect(byUser['reception_1']).toBe('/receptionist/waitlist?apptId=appt-42')
    expect(byUser['admin_1']).toBe('/waitlist?apptId=appt-42')
  })

  it('does not create a duplicate alert when an unread one for this exact appointment is still open', async () => {
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')
    const r = result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] })

    await notifyReceptionIfWaitlistUnfilled(r, 'appt-1')
    expect(store.notifications).toHaveLength(2)

    pushMock.mockClear()
    await notifyReceptionIfWaitlistUnfilled(r, 'appt-1')

    expect(store.notifications).toHaveLength(2) // still just the original two
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('a push rejection never destroys the already-written persistent notification', async () => {
    pushMock.mockRejectedValueOnce(new Error('OneSignal rejected'))
    const { notifyReceptionIfWaitlistUnfilled } = await import('../../crm-automation/waitlist.service')

    await notifyReceptionIfWaitlistUnfilled(
      result({ skipped: [{ patientId: 'p1', waitlistEntryId: 'we1', reason: 'consent_declined' }] }),
      'appt-1',
    )

    expect(store.notifications.length).toBeGreaterThan(0)
  })
})
