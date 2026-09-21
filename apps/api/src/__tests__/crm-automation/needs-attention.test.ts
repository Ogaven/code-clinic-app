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

describe('buildNeedsAttentionQueue (Product Experience Closure — rescoped to LEADS)', () => {
  it('returns exactly the 8 lead/appointment categories — patient-tag categories moved to Patient Engagement', () => {
    return buildNeedsAttentionQueue().then(result => {
      expect(result.categories.map(c => c.key)).toEqual([
        'UNANSWERED_NEW', 'OVERDUE_FOLLOWUP', 'STALE_UNTOUCHED', 'QUALIFIED_UNBOOKED',
        'UNASSIGNED', 'NO_SHOW', 'CANCELLED_UNREBOOKED', 'TREATMENT_OPPORTUNITY',
      ])
      // None of the removed patient-lifecycle categories should reappear.
      for (const removedKey of ['RECALL_OVERDUE_90', 'RECALL_OVERDUE_180', 'TREATMENT_INCOMPLETE', 'COLLECTIONS_FOLLOWUP', 'REPEATED_NO_SHOW']) {
        expect(result.categories.find(c => c.key === removedKey)).toBeUndefined()
      }
    })
  })

  it('does not expose raw "SLA" jargon in any category label', async () => {
    const result = await buildNeedsAttentionQueue()
    for (const category of result.categories) {
      expect(category.label.toUpperCase()).not.toContain('SLA')
    }
  })

  it('exposes both distinctLeadCount and the back-compat totalItems alias, equal to each other', async () => {
    const result = await buildNeedsAttentionQueue()
    expect(result.distinctLeadCount).toBe(result.totalItems)
    expect(typeof result.distinctLeadCount).toBe('number')
  })

  it('the headline (distinctLeadCount) never exceeds the number of unique leads, even when categories overlap heavily', async () => {
    // Same lead appears in all 4 owner-scoped-with-data categories at once.
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
    expect(result.categories.find(c => c.key === 'UNASSIGNED')!.count).toBe(1)
    // A flat sum would be 4 (one lead counted once per overlapping category)
    // — the unique headline must be 1, the actual number of distinct leads.
    expect(result.distinctLeadCount).toBe(1)
  })

  it('the headline never includes CLINIC_WIDE (patient/appointment) items — it is a pure lead count', async () => {
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([{ id: 'appt-1', patientId: 'p1', startAt: new Date(), patient: {} }]) // NO_SHOW
      .mockResolvedValueOnce([{ id: 'appt-2', patientId: 'p2', startAt: new Date(), patient: {} }]) // CANCELLED
      .mockResolvedValueOnce([]) // rebooked check
    prismaMock.patient.findMany.mockResolvedValueOnce([{ id: 'p3', firstName: 'C', lastName: 'D', phone: '3', updatedAt: new Date() }]) // TREATMENT_OPPORTUNITY

    const result = await buildNeedsAttentionQueue()

    // Zero leads exist in this scenario — the headline must be 0 even though
    // 3 CLINIC_WIDE items exist. This is exactly the fix for the old
    // "377 Needs Attention vs 346 Total Leads" confusion: patients/
    // appointments no longer inflate a number labelled "leads".
    expect(result.distinctLeadCount).toBe(0)
    expect(result.categories.find(c => c.key === 'NO_SHOW')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'CANCELLED_UNREBOOKED')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'TREATMENT_OPPORTUNITY')!.count).toBe(1)
  })

  it('scopes lead-based categories to ownerId via Lead.assignedTo, and skips UNASSIGNED entirely when an owner is given', async () => {
    await buildNeedsAttentionQueue({ ownerId: 'user-1' })

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
    expect(prismaMock.appointment.findMany).toHaveBeenCalledTimes(2)
  })

  it('queries treatment opportunities by the real TreatmentPlanStatus enum value PROPOSED, not a guessed string', async () => {
    await buildNeedsAttentionQueue()
    expect(prismaMock.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { treatmentPlanStatus: 'PROPOSED' } })
    )
  })
})
