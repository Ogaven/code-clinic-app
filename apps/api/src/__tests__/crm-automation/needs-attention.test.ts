import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, staleLeadsByOwnerMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    patient: { findMany: vi.fn() },
  },
  staleLeadsByOwnerMock: vi.fn(),
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../crm-automation/reporting.service', () => ({ staleLeadsByOwner: staleLeadsByOwnerMock }))

import { buildNeedsAttentionQueue } from '../../crm-automation/needs-attention.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.lead.findMany.mockResolvedValue([])
  prismaMock.appointment.findMany.mockResolvedValue([])
  prismaMock.patient.findMany.mockResolvedValue([])
  staleLeadsByOwnerMock.mockResolvedValue([])
})

describe('buildNeedsAttentionQueue', () => {
  it('returns every category, even when empty, with a correct total', async () => {
    const result = await buildNeedsAttentionQueue()
    expect(result.categories.map(c => c.key)).toEqual([
      'UNANSWERED_NEW', 'OVERDUE_FOLLOWUP', 'STALE_UNTOUCHED', 'QUALIFIED_UNBOOKED',
      'UNASSIGNED', 'NO_SHOW', 'CANCELLED_UNREBOOKED', 'TREATMENT_OPPORTUNITY',
    ])
    expect(result.totalItems).toBe(0)
    expect(result.ownerId).toBeNull()
  })

  it('scopes lead-based categories to ownerId via Lead.assignedTo, and skips UNASSIGNED entirely when an owner is given', async () => {
    await buildNeedsAttentionQueue({ ownerId: 'user-1' })

    // UNANSWERED_NEW (first call) must filter by assignedTo
    expect(prismaMock.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'NEW', assignedTo: 'user-1' }) })
    )
    // Only 3 lead.findMany calls when owner-scoped (UNASSIGNED is skipped, not queried)
    expect(prismaMock.lead.findMany).toHaveBeenCalledTimes(3)
  })

  it('filters STALE_UNTOUCHED to the requested owner using the shared staleLeadsByOwner grouping', async () => {
    staleLeadsByOwnerMock.mockResolvedValue([
      { ownerId: 'user-1', count: 2, leads: [{ id: 'l1' }, { id: 'l2' }] },
      { ownerId: 'user-2', count: 1, leads: [{ id: 'l3' }] },
    ])
    const all = await buildNeedsAttentionQueue()
    expect(all.categories.find(c => c.key === 'STALE_UNTOUCHED')!.count).toBe(3)

    const scoped = await buildNeedsAttentionQueue({ ownerId: 'user-1' })
    expect(scoped.categories.find(c => c.key === 'STALE_UNTOUCHED')!.count).toBe(2)
  })

  it('excludes a cancelled appointment from CANCELLED_UNREBOOKED when the patient already has a later active appointment', async () => {
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([]) // NO_SHOW
      .mockResolvedValueOnce([
        { id: 'appt-1', patientId: 'patient-1', startAt: new Date(), patient: { firstName: 'A', lastName: 'B', phone: '1' } },
        { id: 'appt-2', patientId: 'patient-2', startAt: new Date(), patient: { firstName: 'C', lastName: 'D', phone: '2' } },
      ]) // CANCELLED/CANCELLED_RESCHEDULED
      .mockResolvedValueOnce([{ patientId: 'patient-1' }]) // rebooked check — only patient-1 has a later active appointment

    const result = await buildNeedsAttentionQueue()
    const category = result.categories.find(c => c.key === 'CANCELLED_UNREBOOKED')!
    expect(category.count).toBe(1)
    expect((category.items[0] as any).patientId).toBe('patient-2')
  })

  it('never queries the rebooked-appointment check when there are no recent cancellations', async () => {
    prismaMock.appointment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await buildNeedsAttentionQueue()
    // Exactly 2 appointment.findMany calls (NO_SHOW, CANCELLED) — no third
    // "rebooked?" query fired for an empty cancellation list.
    expect(prismaMock.appointment.findMany).toHaveBeenCalledTimes(2)
  })

  it('queries treatment opportunities by the real TreatmentPlanStatus enum value PROPOSED, not a guessed string', async () => {
    await buildNeedsAttentionQueue()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { treatmentPlanStatus: 'PROPOSED' } })
    )
  })
})
