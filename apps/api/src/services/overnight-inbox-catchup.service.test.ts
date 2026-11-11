import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  notification: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}))
const push = vi.hoisted(() => vi.fn())
vi.mock('../lib/prisma', () => ({ prisma: db }))
vi.mock('./push.service', () => ({ sendPushToUser: push }))
import { sendOvernightInboxCatchup } from './overnight-inbox-catchup.service'

describe('morning unread inbox catch-up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-11T04:05:00Z'))
    vi.clearAllMocks()
    db.user.findMany.mockResolvedValue([{ id: 'staff-1', role: 'RECEPTIONIST' }])
    db.notification.count.mockResolvedValue(2)
    db.notification.findFirst.mockResolvedValue(null)
    db.notification.create.mockResolvedValue({ id: 'digest-1' })
    push.mockResolvedValue(undefined)
  })

  afterEach(() => vi.useRealTimers())

  it('does not query or notify staff before 07:00 Kampala time', async () => {
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T03:59:59Z'))).toBe(0)
    expect(db.user.findMany).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not create or push a digest after 18:00 Kampala time', async () => {
    vi.setSystemTime(new Date('2026-11-11T15:00:00Z'))
    expect(await sendOvernightInboxCatchup(new Date())).toBe(0)
    expect(db.notification.create).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('sends one morning digest for overnight unread inbox notifications', async () => {
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:00:00Z'))).toBe(1)
    expect(db.notification.count).toHaveBeenCalledWith({
      where: {
        userId: 'staff-1', type: 'MESSAGE', isRead: false,
        href: { contains: '/ai-suite/inbox' },
        createdAt: {
          gte: new Date('2026-11-10T15:00:00Z'),
          lt: new Date('2026-11-11T04:00:00Z'),
        },
      },
    })
    expect(db.notification.create).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('stops a running sweep if the clinic closes while reading notifications', async () => {
    db.notification.count.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-11-11T15:00:00Z'))
      return 2
    })
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T14:59:59Z'))).toBe(0)
    expect(db.notification.create).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('uses the administrator inbox route for admin staff', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'admin-1', role: 'ADMIN' }])
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:05:00Z'))).toBe(1)
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1', href: '/ai-suite/inbox',
      }),
    })
    expect(push).toHaveBeenCalledWith('admin-1', expect.objectContaining({
      url: '/ai-suite/inbox',
    }))
  })

  it('does not count a rejected provider dispatch as an attempted success', async () => {
    push.mockRejectedValue(new Error('Provider unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:05:00Z'))).toBe(0)
      expect(db.notification.create).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('handles multiple staff independently and skips users with no unread messages', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'staff-1', role: 'RECEPTIONIST' },
      { id: 'admin-2', role: 'ADMIN' },
    ])
    db.notification.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:05:00Z'))).toBe(1)
    expect(db.notification.create).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('staff-1', expect.any(Object))
  })

  it('does not record a digest when closing time arrives before persistence', async () => {
    db.notification.findFirst.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-11-11T15:00:00Z'))
      return null
    })
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T14:59:59Z'))).toBe(0)
    expect(db.notification.create).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not duplicate a digest already recorded for the same day', async () => {
    db.notification.findFirst.mockResolvedValue({ id: 'existing' })
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:05:00Z'))).toBe(0)
    expect(db.notification.create).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not notify when all overnight messages were read', async () => {
    db.notification.count.mockResolvedValue(0)
    expect(await sendOvernightInboxCatchup(new Date('2026-11-11T04:05:00Z'))).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })
})
