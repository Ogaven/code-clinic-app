import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, staleLeadsByOwnerMock } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    patient: { findMany: vi.fn() },
    aiConversation: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
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
  prismaMock.aiConversation.findMany.mockResolvedValue([])
  prismaMock.user.findMany.mockResolvedValue([])
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

// ── Milestone: CRM operational functionality closure — Needs Attention
// redesign into a real work queue (Open Chat / View Patient / unique-people
// count). These prove the backend enrichment the new UI depends on.
describe('buildNeedsAttentionQueue — enrichment for the work-queue redesign', () => {
  it('every category carries its entityKind (LEAD/APPOINTMENT/PATIENT) so the frontend never has to guess how to link an item', async () => {
    const result = await buildNeedsAttentionQueue()
    const byKey = new Map(result.categories.map(c => [c.key, c.entityKind]))
    expect(byKey.get('UNANSWERED_NEW')).toBe('LEAD')
    expect(byKey.get('UNASSIGNED')).toBe('LEAD')
    expect(byKey.get('NO_SHOW')).toBe('APPOINTMENT')
    expect(byKey.get('CANCELLED_UNREBOOKED')).toBe('APPOINTMENT')
    expect(byKey.get('TREATMENT_OPPORTUNITY')).toBe('PATIENT')
  })

  it('marks hasConversation true only when a real AiConversation exists for that phone (any historical format) — never fabricated', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-1', name: 'A', phone: '0700000001', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }]) // UNANSWERED_NEW
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]) // OVERDUE_FOLLOWUP, QUALIFIED_UNBOOKED, UNASSIGNED
    prismaMock.aiConversation.findMany.mockResolvedValueOnce([{ phoneNumber: '+256700000001' }]) // stored in a different historical format

    const result = await buildNeedsAttentionQueue()

    const item = result.categories.find(c => c.key === 'UNANSWERED_NEW')!.items[0] as any
    expect(item.hasConversation).toBe(true)
  })

  it('marks hasConversation false when no conversation exists for the phone — never pretends one exists', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-1', name: 'A', phone: '+256700000009', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    prismaMock.aiConversation.findMany.mockResolvedValueOnce([]) // no matching conversation at all

    const result = await buildNeedsAttentionQueue()

    const item = result.categories.find(c => c.key === 'UNANSWERED_NEW')!.items[0] as any
    expect(item.hasConversation).toBe(false)
  })

  it('resolves ownerName from Lead.assignedTo via a single batched User lookup', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-1', name: 'A', phone: '+256700000001', source: 'WHATSAPP', assignedTo: 'user-1', createdAt: new Date() }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'user-1', firstName: 'Jo', lastName: 'Doe' }])

    const result = await buildNeedsAttentionQueue()

    const item = result.categories.find(c => c.key === 'UNANSWERED_NEW')!.items[0] as any
    expect(item.ownerName).toBe('Jo Doe')
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['user-1'] } }, select: { id: true, firstName: true, lastName: true } })
  })

  it('gives APPOINTMENT items a patientId distinct from their own appointment id, for correct View Patient linking', async () => {
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([{ id: 'appt-1', patientId: 'patient-1', startAt: new Date(), patient: { firstName: 'A', lastName: 'B', phone: '+256700000001' } }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await buildNeedsAttentionQueue()

    const item = result.categories.find(c => c.key === 'NO_SHOW')!.items[0] as any
    expect(item.id).toBe('appt-1')
    expect(item.patientId).toBe('patient-1')
  })

  it('gives TREATMENT_OPPORTUNITY items a patientId equal to their own id (already a patient)', async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([{ id: 'patient-9', firstName: 'A', lastName: 'B', phone: '+256700000001', updatedAt: new Date() }])

    const result = await buildNeedsAttentionQueue()

    const item = result.categories.find(c => c.key === 'TREATMENT_OPPORTUNITY')!.items[0] as any
    expect(item.patientId).toBe('patient-9')
  })

  it('distinctPeopleCount counts a patient with both a no-show AND a proposed treatment only once', async () => {
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([{ id: 'appt-1', patientId: 'patient-1', startAt: new Date(), patient: { firstName: 'A', lastName: 'B', phone: '+256700000001' } }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
    prismaMock.patient.findMany.mockResolvedValueOnce([{ id: 'patient-1', firstName: 'A', lastName: 'B', phone: '+256700000001', updatedAt: new Date() }])

    const result = await buildNeedsAttentionQueue()

    expect(result.categories.find(c => c.key === 'NO_SHOW')!.count).toBe(1)
    expect(result.categories.find(c => c.key === 'TREATMENT_OPPORTUNITY')!.count).toBe(1)
    expect(result.distinctPeopleCount).toBe(1) // same patient, two categories -> one person
  })

  it('distinctPeopleCount includes leads too (not lead-only like distinctLeadCount, not patient-only)', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-1', name: 'A', phone: '+256700000001', source: 'WHATSAPP', assignedTo: null, createdAt: new Date() }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    prismaMock.patient.findMany.mockResolvedValueOnce([{ id: 'patient-1', firstName: 'A', lastName: 'B', phone: '+256700000002', updatedAt: new Date() }])

    const result = await buildNeedsAttentionQueue()

    expect(result.distinctLeadCount).toBe(1)
    expect(result.distinctPeopleCount).toBe(2) // 1 lead + 1 unrelated patient
  })
})
