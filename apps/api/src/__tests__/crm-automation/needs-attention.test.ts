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

  // Regression: totalItems used to be a flat sum of category.count, but the
  // LEAD_OWNER categories are not mutually exclusive — the same lead can
  // legitimately sit in UNANSWERED_NEW, OVERDUE_FOLLOWUP, STALE_UNTOUCHED,
  // and UNASSIGNED simultaneously, inflating the headline dashboard/panel
  // number well past how many distinct leads actually need action.
  it('the headline total counts a lead once even when it appears in all four overlapping LEAD_OWNER categories, while every per-category count stays unchanged', async () => {
    const overlapLead = { id: 'lead-x', name: 'Overlap Lead', phone: '+256700000000', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }
    prismaMock.lead.findMany
      .mockResolvedValueOnce([overlapLead]) // UNANSWERED_NEW
      .mockResolvedValueOnce([{ ...overlapLead, slaState: 'STALE_24H' }]) // OVERDUE_FOLLOWUP
      .mockResolvedValueOnce([]) // QUALIFIED_UNBOOKED
      .mockResolvedValueOnce([overlapLead]) // UNASSIGNED
    staleLeadsByOwnerMock.mockResolvedValue([{ ownerId: null, count: 1, leads: [overlapLead] }]) // STALE_UNTOUCHED

    const result = await buildNeedsAttentionQueue()

    expect(result.categories.find(c => c.key === 'UNANSWERED_NEW')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'OVERDUE_FOLLOWUP')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'STALE_UNTOUCHED')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'QUALIFIED_UNBOOKED')!.count).toBe(0)
    expect(result.categories.find(c => c.key === 'UNASSIGNED')!.count).toBe(1)
    // Flat sum of the above would be 4 (one lead counted once per category
    // it appears in) — the distinct headline total must be 1.
    expect(result.totalItems).toBe(1)
  })

  it('adds CLINIC_WIDE categories (no-shows, unrebooked cancellations, treatment opportunities) on top of the distinct lead count, without deduplicating them against leads or each other', async () => {
    const leadA = { id: 'lead-a', name: 'A', phone: '1', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }
    const leadB = { id: 'lead-b', name: 'B', phone: '2', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }
    prismaMock.lead.findMany
      .mockResolvedValueOnce([leadA]) // UNANSWERED_NEW
      .mockResolvedValueOnce([]) // OVERDUE_FOLLOWUP
      .mockResolvedValueOnce([]) // QUALIFIED_UNBOOKED
      .mockResolvedValueOnce([leadB]) // UNASSIGNED — distinct from leadA
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([{ id: 'appt-1', patientId: 'p1', startAt: new Date(), patient: {} }]) // NO_SHOW
      .mockResolvedValueOnce([{ id: 'appt-2', patientId: 'p2', startAt: new Date(), patient: {} }]) // CANCELLED
      .mockResolvedValueOnce([]) // rebooked check — p2 not rebooked
    prismaMock.patient.findMany.mockResolvedValueOnce([{ id: 'p3', firstName: 'C', lastName: 'D', phone: '3', updatedAt: new Date() }])

    const result = await buildNeedsAttentionQueue()

    // 2 distinct leads + 1 no-show + 1 unrebooked cancellation + 1 treatment opportunity
    expect(result.totalItems).toBe(5)
  })
})
