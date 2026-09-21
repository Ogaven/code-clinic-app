import { describe, expect, it, vi, beforeEach } from 'vitest'

// Milestone: CRM Data/Role-Parity closure. Root cause: Patient.accountBalance
// (which balanceStatus is derived from) is never incremented anywhere in the
// codebase — only ever decremented on full payment — so balanceStatus can
// essentially never become OWING and CollectionsCase auto-open essentially
// never fires, no matter how much real unpaid Invoice debt exists.
// realOutstandingBalancePatients() bypasses that broken field entirely and
// queries real Invoice rows directly.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    collectionsCase: { findMany: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { realOutstandingBalancePatients } from '../../crm-automation/collections.service'

beforeEach(() => { vi.clearAllMocks() })

describe('realOutstandingBalancePatients', () => {
  it('returns an empty list, not an error, when no active patient has an unpaid invoice', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])
    const result = await realOutstandingBalancePatients()
    expect(result).toEqual([])
    expect(prismaMock.collectionsCase.findMany).not.toHaveBeenCalled()
  })

  it('computes real outstanding balances directly from Invoice rows, never from Patient.accountBalance', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '+256700000001', outstandingUGX: 150000n, unpaidInvoiceCount: 2n, oldestUnpaidAt: new Date('2026-08-01') },
    ])
    prismaMock.collectionsCase.findMany.mockResolvedValue([])
    const result = await realOutstandingBalancePatients()
    expect(result).toEqual([
      { id: 'p1', firstName: 'Jane', lastName: 'Doe', phone: '+256700000001', outstandingUGX: 150000, unpaidInvoiceCount: 2, oldestUnpaidAt: new Date('2026-08-01'), hasOpenCollectionsCase: false },
    ])
  })

  it('flags hasOpenCollectionsCase true when a non-CLOSED case already exists for that patient', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', outstandingUGX: 10000n, unpaidInvoiceCount: 1n, oldestUnpaidAt: new Date() },
      { id: 'p2', firstName: 'C', lastName: 'D', phone: '2', outstandingUGX: 20000n, unpaidInvoiceCount: 1n, oldestUnpaidAt: new Date() },
    ])
    prismaMock.collectionsCase.findMany.mockResolvedValue([{ patientId: 'p1' }])
    const result = await realOutstandingBalancePatients()
    expect(result.find(p => p.id === 'p1')!.hasOpenCollectionsCase).toBe(true)
    expect(result.find(p => p.id === 'p2')!.hasOpenCollectionsCase).toBe(false)
  })

  it('converts bigint aggregate results to plain numbers (Postgres SUM/COUNT return bigint)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'p1', firstName: 'A', lastName: 'B', phone: '1', outstandingUGX: 92190000n, unpaidInvoiceCount: 1663n, oldestUnpaidAt: new Date() },
    ])
    prismaMock.collectionsCase.findMany.mockResolvedValue([])
    const result = await realOutstandingBalancePatients()
    expect(typeof result[0].outstandingUGX).toBe('number')
    expect(typeof result[0].unpaidInvoiceCount).toBe('number')
    expect(result[0].outstandingUGX).toBe(92190000)
  })
})
