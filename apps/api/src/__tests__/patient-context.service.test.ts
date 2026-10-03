// Covers apps/api/src/ai-suite/agent/patient-context.service.ts — the
// structured Patient Context Summary Sarah gets before replying to a
// recognized patient, and the staff hand-back note she gets after a human
// takeover. Every query in the service is scoped by the patientId the
// caller already resolved, so the core safety property under test is
// identity isolation: Patient A's context must never leak into a summary
// built for Patient B, and no financial/clinical-note data is ever included.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const store = vi.hoisted(() => ({
  appointments:     [] as any[],
  treatmentPlans:   [] as any[],
  services:         new Map<string, any>(),
  patientActivity:  [] as any[],
  aiMessages:       [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    appointment: {
      count: vi.fn(async ({ where }: any) => {
        return store.appointments.filter(a =>
          a.patientId === where.patientId &&
          (!where.status?.in || where.status.in.includes(a.status))
        ).length
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = store.appointments.filter(a => a.patientId === where.patientId)
        if (where.status?.in) rows = rows.filter(a => where.status.in.includes(a.status))
        if (where.status?.notIn) rows = rows.filter(a => !where.status.notIn.includes(a.status))
        if (where.startAt?.gt) rows = rows.filter(a => a.startAt.getTime() > where.startAt.gt.getTime())
        const dir = orderBy?.startAt === 'asc' ? 1 : -1
        rows = [...rows].sort((a, b) => dir * (a.startAt.getTime() - b.startAt.getTime()))
        return rows[0] ?? null
      }),
    },
    treatmentPlan: {
      findMany: vi.fn(async ({ where }: any) => {
        let rows = store.treatmentPlans.filter(p => p.patientId === where.patientId)
        if (where.status?.in) rows = rows.filter(p => where.status.in.includes(p.status))
        return rows
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = store.treatmentPlans.filter(p => p.patientId === where.patientId && p.status === where.status)
        const dir = orderBy?.updatedAt === 'asc' ? 1 : -1
        rows = [...rows].sort((a, b) => dir * (a.updatedAt.getTime() - b.updatedAt.getTime()))
        return rows[0] ?? null
      }),
    },
    service: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where.id.in
        return ids.filter(id => store.services.has(id)).map(id => ({ id, name: store.services.get(id) }))
      }),
    },
    patientActivity: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.patientActivity.filter(a =>
          a.patientId === where.patientId &&
          a.createdAt.getTime() >= where.createdAt.gte.getTime() &&
          a.createdAt.getTime() <= where.createdAt.lte.getTime()
        )
      }),
    },
    aiMessage: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = store.aiMessages.filter(m => m.conversationId === where.conversationId && m.role === where.role)
        if (where.content?.startsWith) rows = rows.filter(m => m.content.startsWith(where.content.startsWith))
        if (where.createdAt?.lt) rows = rows.filter(m => m.createdAt.getTime() < where.createdAt.lt.getTime())
        const dir = orderBy?.createdAt === 'asc' ? 1 : -1
        rows = [...rows].sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()))
        return rows[0] ?? null
      }),
    },
  },
}))

beforeEach(() => {
  store.appointments.length = 0
  store.treatmentPlans.length = 0
  store.services.clear()
  store.patientActivity.length = 0
  store.aiMessages.length = 0
})

describe('buildPatientContextSummary — identity isolation', () => {
  it('never includes Patient B\'s appointments/treatments when building context for Patient A', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    store.services.set('svc_crown', 'Crown')
    store.services.set('svc_cleaning', 'Cleaning')
    store.treatmentPlans.push({
      patientId: 'patient_A', status: 'Planned', serviceId: 'svc_crown', toothNumber: '16',
      followUpAt: null, followUpReason: null, doctor: null, createdAt: new Date(),
    })
    store.treatmentPlans.push({
      patientId: 'patient_B', status: 'Planned', serviceId: 'svc_cleaning', toothNumber: '24',
      followUpAt: null, followUpReason: null, doctor: null, createdAt: new Date(),
    })

    const summaryA = await buildPatientContextSummary('patient_A')

    expect(summaryA).toContain('Crown')
    expect(summaryA).not.toContain('Cleaning')
  })

  it('a patient with no history at all produces a safe "new patient" summary, not an error', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')

    const summary = await buildPatientContextSummary('patient_unknown')

    expect(summary).toContain('New patient')
  })
})

describe('buildPatientContextSummary — content', () => {
  it('flags a returning patient once a completed appointment exists', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    store.appointments.push({ patientId: 'patient_1', status: 'COMPLETED', startAt: new Date('2026-01-01'), doctor: null, service: null })

    const summary = await buildPatientContextSummary('patient_1')

    expect(summary).toContain('Returning patient')
  })

  it('surfaces an upcoming appointment so Sarah does not treat an existing booking as a fresh lead', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    store.appointments.push({
      patientId: 'patient_1', status: 'CONFIRMED', startAt: future,
      doctor: { user: { firstName: 'Steven', lastName: 'K' } }, service: { name: 'Checkup' },
    })

    const summary = await buildPatientContextSummary('patient_1')

    expect(summary).toContain('UPCOMING APPOINTMENT: Already booked')
    expect(summary).toContain('Dr. Steven K')
    expect(summary).toContain('Checkup')
  })

  it('includes a patient-requested follow-up date on an active treatment plan', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    store.services.set('svc_1', 'Root Canal')
    const followUp = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    store.treatmentPlans.push({
      patientId: 'patient_1', status: 'On Hold', serviceId: 'svc_1', toothNumber: '11',
      followUpAt: followUp, followUpReason: 'Awaiting funds', doctor: null, createdAt: new Date(),
    })

    const summary = await buildPatientContextSummary('patient_1')

    expect(summary).toContain('Root Canal')
    expect(summary).toContain('asked to be followed up')
    expect(summary).toContain('Awaiting funds')
  })

  it('includes a relevant recently completed treatment', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    store.services.set('svc_2', 'Filling')
    store.treatmentPlans.push({ patientId: 'patient_1', status: 'Completed', serviceId: 'svc_2', updatedAt: new Date() })

    const summary = await buildPatientContextSummary('patient_1')

    expect(summary).toContain('RECENT COMPLETED TREATMENT')
    expect(summary).toContain('Filling')
  })

  it('never includes billing/financial figures (no cost, discount, or balance data is queried at all)', async () => {
    const { buildPatientContextSummary } = await import('../ai-suite/agent/patient-context.service')
    store.services.set('svc_3', 'Implant')
    store.treatmentPlans.push({
      patientId: 'patient_1', status: 'Planned', serviceId: 'svc_3', toothNumber: '26',
      followUpAt: null, followUpReason: null, doctor: null, createdAt: new Date(),
      // Even if a cost-shaped field were accidentally present on the row,
      // the service only selects serviceId/status/etc — this just documents
      // that no cost value appears in the string even when nearby.
      costPerUnit: 500000, discount: 0,
    })

    const summary = await buildPatientContextSummary('patient_1')

    expect(summary).not.toMatch(/UGX|500,?000/)
  })
})

describe('getPendingHandoffNote', () => {
  function systemMsg(overrides: Partial<any>) {
    store.aiMessages.push({ conversationId: 'conv_1', role: 'SYSTEM', content: '', metadata: null, createdAt: new Date(), ...overrides })
  }

  it('returns null when the conversation was never taken over', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')

    const note = await getPendingHandoffNote('conv_1', 'patient_1')

    expect(note).toBeNull()
  })

  it('surfaces the staff-typed summary the first time Sarah replies after hand-back', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')
    systemMsg({
      content: 'Agent resumed by staff. Handoff notes: Booked Tuesday 8am for a filling.',
      metadata: JSON.stringify({ staffId: 'staff_1', summary: 'Booked Tuesday 8am for a filling.' }),
      createdAt: new Date('2026-01-01T10:00:00Z'),
    })

    const note = await getPendingHandoffNote('conv_1', 'patient_1')

    expect(note).toContain('Booked Tuesday 8am for a filling.')
  })

  it('does NOT resurface the hand-back note once Sarah has already replied since', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')
    systemMsg({
      content: 'Agent resumed by staff. Handoff notes: Booked Tuesday 8am.',
      metadata: JSON.stringify({ staffId: 'staff_1', summary: 'Booked Tuesday 8am.' }),
      createdAt: new Date('2026-01-01T10:00:00Z'),
    })
    store.aiMessages.push({ conversationId: 'conv_1', role: 'AGENT', content: 'Great, see you Tuesday!', createdAt: new Date('2026-01-01T10:01:00Z') })

    const note = await getPendingHandoffNote('conv_1', 'patient_1')

    expect(note).toBeNull()
  })

  it('auto-enriches with PatientActivity rows logged during the takeover window, without fabricating anything', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')
    const takenOverAt = new Date('2026-01-01T09:00:00Z')
    const handedBackAt = new Date('2026-01-01T10:00:00Z')
    systemMsg({ content: 'Conversation taken over by staff member at ...', createdAt: takenOverAt })
    systemMsg({ content: 'Agent resumed by staff.', metadata: JSON.stringify({ staffId: 'staff_1', summary: null }), createdAt: handedBackAt })
    store.patientActivity.push({ patientId: 'patient_1', action: 'Appointment booked', userName: 'Julian', createdAt: new Date('2026-01-01T09:30:00Z') })
    // Outside the takeover window — must NOT appear.
    store.patientActivity.push({ patientId: 'patient_1', action: 'Unrelated earlier note', userName: 'Julian', createdAt: new Date('2025-12-01T00:00:00Z') })

    const note = await getPendingHandoffNote('conv_1', 'patient_1')

    expect(note).toContain('Appointment booked')
    expect(note).not.toContain('Unrelated earlier note')
  })

  it('returns null (not an empty-but-truthy string) when there is neither a staff summary nor any logged activity', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')
    systemMsg({ content: 'Agent resumed by staff.', metadata: JSON.stringify({ staffId: 'staff_1', summary: null }), createdAt: new Date() })

    const note = await getPendingHandoffNote('conv_1', 'patient_1')

    expect(note).toBeNull()
  })

  it('malformed metadata JSON is treated as "no summary" rather than throwing', async () => {
    const { getPendingHandoffNote } = await import('../ai-suite/agent/patient-context.service')
    systemMsg({ content: 'Agent resumed by staff.', metadata: '{not valid json', createdAt: new Date() })
    store.patientActivity.push({ patientId: 'patient_1', action: 'Follow-up date set', userName: 'Julian', createdAt: new Date() })
    store.aiMessages.push({ conversationId: 'conv_1', role: 'SYSTEM', content: 'Conversation taken over by staff member at ...', createdAt: new Date(Date.now() - 1000) })

    await expect(getPendingHandoffNote('conv_1', 'patient_1')).resolves.not.toThrow()
  })
})
