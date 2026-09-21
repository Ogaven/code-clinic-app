import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn(), count: vi.fn() },
    appointment: { findMany: vi.fn() },
    patient: { count: vi.fn() },
    treatmentPlan: { findMany: vi.fn() },
    invoice: { aggregate: vi.fn(), count: vi.fn() },
    payment: { aggregate: vi.fn() },
  },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { buildAcquisitionRevenueReport, acquisitionRevenueByDimension, unattributedRevenueSummary, clinicRevenueSummary } from '../../crm-automation/revenue-attribution.service'

function lead(overrides: Partial<{ id: string; convertedToPatientId: string | null; source: string; campaignId: string | null; assignedTo: string | null; createdAt: Date }>) {
  return { id: 'l', convertedToPatientId: null, source: 'WHATSAPP', campaignId: null, assignedTo: null, createdAt: new Date('2026-01-01'), ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.lead.findMany.mockResolvedValue([])
  prismaMock.lead.count.mockResolvedValue(0)
  prismaMock.appointment.findMany.mockResolvedValue([])
  prismaMock.patient.count.mockResolvedValue(0)
  prismaMock.treatmentPlan.findMany.mockResolvedValue([])
  prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { totalUGX: null } })
  prismaMock.invoice.count.mockResolvedValue(0)
  prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: null } })
})

describe('buildAcquisitionRevenueReport — single-linking-lead attribution', () => {
  it('attributes revenue for a patient linked from exactly one lead matching the filter', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1', source: 'FACEBOOK' }),
    ])
    prismaMock.lead.count.mockResolvedValue(1)
    prismaMock.appointment.findMany.mockResolvedValue([{ patientId: 'p1', status: 'COMPLETED' }])
    prismaMock.patient.count.mockResolvedValue(1)
    prismaMock.treatmentPlan.findMany.mockResolvedValue([{ costPerUnit: 100_000, quantity: 2, discount: 10_000 }])
    prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { totalUGX: 190_000 } })
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: 150_000 } })

    const report = await buildAcquisitionRevenueReport({ source: 'FACEBOOK' })

    expect(report.funnel.bookedCount).toBe(1)
    expect(report.funnel.attendedCount).toBe(1)
    expect(report.revenue.treatmentValueUGX).toBe(190_000) // 100000*2 - 10000
    expect(report.revenue.invoicedUGX).toBe(190_000)
    expect(report.revenue.collectedUGX).toBe(150_000)
    expect(report.ambiguousPatientCount).toBe(0)
  })

  it('excludes a patient linked from more than one lead from every revenue total, counting it as ambiguous instead', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1', source: 'FACEBOOK' }),
      lead({ id: 'l2', convertedToPatientId: 'p1', source: 'WEBSITE' }), // same patient, second lead
    ])

    const report = await buildAcquisitionRevenueReport({ source: 'FACEBOOK' })

    expect(report.ambiguousPatientCount).toBe(1)
    expect(report.revenue.invoicedUGX).toBe(0)
    expect(report.revenue.collectedUGX).toBe(0)
    // p1 was never in the "clean" patient set at all, so the revenue sums
    // short-circuit on an empty id list without even querying the database.
    expect(prismaMock.invoice.aggregate).not.toHaveBeenCalled()
  })

  it('never attributes a patient whose only linking lead does not match the filter', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1', source: 'WEBSITE' }),
    ])

    const report = await buildAcquisitionRevenueReport({ source: 'FACEBOOK' })
    expect(report.ambiguousPatientCount).toBe(0)
    expect(report.revenue.invoicedUGX).toBe(0)
    expect(prismaMock.invoice.aggregate).not.toHaveBeenCalled()
  })

  it('counts attendedCount using only ATTENDED_STATUSES, not every booked appointment status', async () => {
    prismaMock.lead.findMany.mockResolvedValue([lead({ id: 'l1', convertedToPatientId: 'p1' })])
    prismaMock.appointment.findMany.mockResolvedValue([
      { patientId: 'p1', status: 'PENDING' },   // booked, not attended
      { patientId: 'p1', status: 'CANCELLED' }, // booked, not attended
    ])

    const report = await buildAcquisitionRevenueReport()
    expect(report.funnel.bookedCount).toBe(1)
    expect(report.funnel.attendedCount).toBe(0)
  })

  it('always includes an explanatory methodology note', async () => {
    const report = await buildAcquisitionRevenueReport()
    expect(report.note).toContain('EXACTLY ONE')
    expect(report.note).toContain('Converted != revenue')
  })
})

describe('acquisitionRevenueByDimension', () => {
  it('groups clean (single-lead) patients by source and sorts buckets by collected revenue descending', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1', source: 'FACEBOOK' }),
      lead({ id: 'l2', convertedToPatientId: 'p2', source: 'WHATSAPP' }),
    ])
    prismaMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amountUGX: 50_000 } })  // p1 (first bucket processed)
      .mockResolvedValueOnce({ _sum: { amountUGX: 200_000 } }) // p2

    const result = await acquisitionRevenueByDimension('source')
    expect(result.buckets.map(b => b.key)).toEqual(['WHATSAPP', 'FACEBOOK'])
    expect(result.ambiguousPatientCount).toBe(0)
  })

  it('excludes ambiguous patients from every bucket', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1', source: 'FACEBOOK' }),
      lead({ id: 'l2', convertedToPatientId: 'p1', source: 'WHATSAPP' }),
    ])

    const result = await acquisitionRevenueByDimension('source')
    expect(result.buckets).toEqual([])
    expect(result.ambiguousPatientCount).toBe(1)
  })
})

describe('unattributedRevenueSummary', () => {
  it('splits total collected revenue into attributed, ambiguous, and unattributed', async () => {
    prismaMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amountUGX: 1_000_000 } }) // total
      .mockResolvedValueOnce({ _sum: { amountUGX: 300_000 } })   // clean-attributed
      .mockResolvedValueOnce({ _sum: { amountUGX: 100_000 } })   // ambiguous
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p1' }),               // clean
      lead({ id: 'l2', convertedToPatientId: 'p2' }),
      lead({ id: 'l3', convertedToPatientId: 'p2' }),               // ambiguous (p2 x2)
    ])

    const summary = await unattributedRevenueSummary()
    expect(summary.totalCollectedUGX).toBe(1_000_000)
    expect(summary.attributedToLeadUGX).toBe(300_000)
    expect(summary.ambiguousMultiLeadUGX).toBe(100_000)
    expect(summary.unattributedUGX).toBe(600_000)
  })

  it('never returns a negative unattributedUGX even if aggregates disagree', async () => {
    // Non-empty clean AND ambiguous patient sets so both follow-up
    // payment.aggregate calls actually fire (an empty id list short-circuits
    // to 0 without querying at all — see the sumCollectedUGX guard).
    prismaMock.lead.findMany.mockResolvedValue([
      lead({ id: 'l1', convertedToPatientId: 'p-clean' }),
      lead({ id: 'l2', convertedToPatientId: 'p-ambig' }),
      lead({ id: 'l3', convertedToPatientId: 'p-ambig' }),
    ])
    prismaMock.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amountUGX: 100 } }) // total
      .mockResolvedValueOnce({ _sum: { amountUGX: 80 } })  // attributed (clean)
      .mockResolvedValueOnce({ _sum: { amountUGX: 50 } })  // ambiguous
    const summary = await unattributedRevenueSummary()
    expect(summary.unattributedUGX).toBe(0)
  })
})

// Milestone: CRM Data/Role-Parity closure. Revenue previously only showed
// lead-attributed figures — patients with no Lead link at all (the large
// majority: walk-ins, referrals, historical/imported patients) never
// appeared anywhere on the page even though their real Invoice/Payment data
// exists. clinicRevenueSummary() is independent of lead attribution.
describe('clinicRevenueSummary', () => {
  it('reports real Invoiced/Collected/Outstanding, independent of any lead attribution', async () => {
    prismaMock.invoice.aggregate
      .mockResolvedValueOnce({ _sum: { totalUGX: 92_190_000 } }) // invoiced (status != CANCELLED)
      .mockResolvedValueOnce({ _sum: { totalUGX: 92_190_000 }, _count: 1663 }) // outstanding
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: 0 } })
    prismaMock.invoice.count
      .mockResolvedValueOnce(1663) // invoiceCount
      .mockResolvedValueOnce(1663) // unpaidInvoiceCount

    const result = await clinicRevenueSummary()

    expect(result.invoicedUGX).toBe(92_190_000)
    expect(result.collectedUGX).toBe(0)
    expect(result.outstandingUGX).toBe(92_190_000)
    expect(result.invoiceCount).toBe(1663)
    expect(result.unpaidInvoiceCount).toBe(1663)
  })

  it('excludes CANCELLED invoices from the invoiced total', async () => {
    prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { totalUGX: 0 } })
    await clinicRevenueSummary()
    expect(prismaMock.invoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'CANCELLED' } } })
    )
  })

  it('outstanding only counts real not-yet-paid statuses (UNPAID/SENT/PARTIAL/OVERDUE), never DRAFT or CANCELLED', async () => {
    prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { totalUGX: 0 } })
    await clinicRevenueSummary()
    expect(prismaMock.invoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['UNPAID', 'SENT', 'PARTIAL', 'OVERDUE'] } } })
    )
  })

  it('never fabricates a collected figure — reads only the real local Payment table', async () => {
    prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { totalUGX: 0 } })
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amountUGX: null } })
    const result = await clinicRevenueSummary()
    expect(result.collectedUGX).toBe(0)
  })
})
