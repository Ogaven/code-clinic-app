import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  notification: { create: vi.fn() },
}))
const push = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/prisma', () => ({ prisma: db }))
vi.mock('../../push.service', () => ({ sendPushToUser: push }))
vi.mock('../../../ai-suite/sms/sms.service', () => ({ sendStaffSMS: vi.fn() }))
vi.mock('../../../config/escalation-config', () => ({
  getClinicEscalationWhatsAppNumber: vi.fn(() => null),
}))
import { notifyStaffInApp } from './escalation'

describe('staff alert push-hours policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.user.findMany.mockResolvedValue([
      { id: 'reception', role: 'RECEPTIONIST' },
      { id: 'admin', role: 'ADMIN' },
    ])
    db.notification.create.mockResolvedValue({ id: 'notification' })
    push.mockResolvedValue(undefined)
  })

  const alert = {
    title: 'Follow-up needs attention',
    body: 'Private patient details',
    pushBody: 'A follow-up needs review',
    href: (role: 'RECEPTIONIST' | 'ADMIN') =>
      role === 'RECEPTIONIST' ? '/receptionist/patients' : '/patients',
  }

  it('keeps in-app records but suppresses routine pushes when closed', async () => {
    await notifyStaffInApp({ ...alert, shouldPush: () => false })
    expect(db.notification.create).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
  })

  it('pushes generic content and correct role-specific routes during permitted hours', async () => {
    await notifyStaffInApp({ ...alert, shouldPush: () => true })
    expect(db.notification.create).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenCalledWith('reception', {
      title: alert.title, body: alert.pushBody, url: '/receptionist/patients',
    })
    expect(push).toHaveBeenCalledWith('admin', {
      title: alert.title, body: alert.pushBody, url: '/patients',
    })
  })

  it('preserves urgent escalation pushes when no routine restriction is provided', async () => {
    await notifyStaffInApp(alert)
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('does not push to a user if their in-app notification fails', async () => {
    db.notification.create.mockRejectedValueOnce(new Error('Database unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await notifyStaffInApp(alert)
      expect(push).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })
})
