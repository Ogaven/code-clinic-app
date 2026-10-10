import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
import { isConfirmedRecallDue } from '../../crm-automation/recall-eligibility.service'

describe('clinical recall outbound gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows only a confirmed qualifying hygiene recall', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ eligible: true }])
    expect(await isConfirmedRecallDue('patient-1')).toBe(true)
    const sql = prismaMock.$queryRaw.mock.calls[0][0].join(' ')
    expect(sql).toContain("a.status = 'COMPLETED'")
    expect(sql).toContain('p."isActive" = true')
    expect(sql).toContain('p."recallInterval" IN')
    expect(sql).toContain('MAX(a."startAt")')
    expect(sql).toContain('periodontal maintenance')
  })

  it('fails closed when no completed qualifying visit or interval exists', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ eligible: false }])
    expect(await isConfirmedRecallDue('patient-2')).toBe(false)
  })

  it('fails closed if no eligibility row is returned', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])
    expect(await isConfirmedRecallDue('patient-3')).toBe(false)
  })
})
