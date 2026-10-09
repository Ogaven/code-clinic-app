import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  patient: { count: vi.fn() },
  user: { findMany: vi.fn() },
  notification: { findFirst: vi.fn(), create: vi.fn() },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
import { checkDailyRecallStaffAlerts } from '../../crm-automation/recall-staff-alerts.service'

describe('staff-only recall digest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.patient.count.mockResolvedValue(2)
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }])
    prismaMock.notification.findFirst.mockResolvedValue(null)
    prismaMock.notification.create.mockResolvedValue({ id: 'notice-1' })
  })

  it('only counts confirmed interval patients and sends an internal notification', async () => {
    const result = await checkDailyRecallStaffAlerts(new Date('2026-10-09T06:00:00Z'))
    expect(result).toEqual({ confirmedDue: 2, notified: 1 })
    expect(prismaMock.patient.count).toHaveBeenCalledWith({
      where: { isActive: true, recallInterval: { not: null }, recallStatus: { in: ['DUE', 'OVERDUE_30', 'OVERDUE_90', 'OVERDUE_180_PLUS'] } },
    })
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { isActive: true, role: { in: ['ADMIN', 'RECEPTIONIST'] } },
      select: { id: true },
    })
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'admin-1', type: 'SYSTEM', href: '/crm/recall' }),
    })
  })

  it('does not duplicate a previously created daily notice', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'existing' })
    expect(await checkDailyRecallStaffAlerts()).toEqual({ confirmedDue: 2, notified: 0 })
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })

  it('does not notify anyone when there are no confirmed due recalls', async () => {
    prismaMock.patient.count.mockResolvedValue(0)
    expect(await checkDailyRecallStaffAlerts()).toEqual({ confirmedDue: 0, notified: 0 })
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })
})
