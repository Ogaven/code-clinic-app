import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { findMany: vi.fn() },
  notification: { findFirst: vi.fn(), create: vi.fn() },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
import { checkDailyRecallStaffAlerts } from '../../crm-automation/recall-staff-alerts.service'

describe('staff-only recall digest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$queryRaw.mockResolvedValue([{ count: 2n }])
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }])
    prismaMock.notification.findFirst.mockResolvedValue(null)
    prismaMock.notification.create.mockResolvedValue({ id: 'notice-1' })
  })

  it('only counts confirmed interval patients and sends an internal notification', async () => {
    const result = await checkDailyRecallStaffAlerts(new Date('2026-10-09T06:00:00Z'))
    expect(result).toEqual({ confirmedDue: 2, notified: 1 })
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    const sql = prismaMock.$queryRaw.mock.calls[0][0].join(' ')
    expect(sql).toContain("a.status = 'COMPLETED'")
    expect(sql).toContain('periodontal maintenance')
    expect(sql).toContain('recall hygiene visit')
    expect(sql).toContain('MAX(a."startAt")')
    expect(sql).toContain('p."recallInterval"')
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
    prismaMock.$queryRaw.mockResolvedValue([{ count: 0n }])
    expect(await checkDailyRecallStaffAlerts()).toEqual({ confirmedDue: 0, notified: 0 })
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })
})
