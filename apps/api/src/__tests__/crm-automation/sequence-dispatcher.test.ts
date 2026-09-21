import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage, sendWhatsAppTemplate, getChannelConsentStatus, hasExplicitOptIn } = vi.hoisted(() => ({
  prismaMock: {
    scheduledTouch: { findMany: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    sequenceEnrollment: { update: vi.fn() },
    lead: { findUnique: vi.fn() },
    nurtureLog: { create: vi.fn() },
    automationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    leadConsentLog: { findFirst: vi.fn() },
    aiMessage: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
  sendWhatsAppTemplate: vi.fn().mockResolvedValue('wamid-template-1'),
  getChannelConsentStatus: vi.fn().mockResolvedValue(true),
  hasExplicitOptIn: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage, sendWhatsAppTemplate }))
vi.mock('../../ai-suite/sms/sms.service', () => ({ sendSMS: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../crm-automation/consent-log.service', () => ({ getChannelConsentStatus, hasExplicitOptIn }))

import { processDueScheduledTouches } from '../../crm-automation/sequence-dispatcher'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
  delete process.env.WA_TEMPLATE_RECALL_DUE_D0
  delete process.env.WA_TEMPLATE_RECALL_DUE_D5
  getChannelConsentStatus.mockResolvedValue(true)
  hasExplicitOptIn.mockResolvedValue(false)
  prismaMock.scheduledTouch.count.mockResolvedValue(0)
  prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
  prismaMock.aiMessage.findFirst.mockResolvedValue(null)
})

function leadTouch(overrides: Record<string, any> = {}) {
  return {
    id: 't-lead-1',
    enrollmentId: 'enr-lead-1',
    patientId: null,
    enrollment: { id: 'enr-lead-1', status: 'ACTIVE', leadId: 'lead-1' },
    touchTemplate: {
      channel: 'WHATSAPP',
      messageTemplate: 'Hi {firstName}, this is a reminder.',
      sequence: { isMarketing: false },
    },
    patient: null,
    ...overrides,
  }
}

function dueTouch(overrides: Record<string, any> = {}) {
  return {
    id: 't-1',
    enrollmentId: 'enr-1',
    patientId: 'p-1',
    enrollment: { id: 'enr-1', status: 'ACTIVE', leadId: null },
    touchTemplate: {
      channel: 'WHATSAPP',
      messageTemplate: 'Hi {firstName}, this is a reminder.',
      sequence: { isMarketing: false }, // operational by default in these tests — see the dedicated marketing-gate tests below
    },
    patient: { phone: '+256700000001', firstName: 'Jo', lastName: 'Doe' },
    ...overrides,
  }
}

describe('processDueScheduledTouches — dry-run enforcement (Part W)', () => {
  it('never calls the real WhatsApp send while dry-run (default/test) mode is active', async () => {
    prismaMock.scheduledTouch.findMany.mockResolvedValue([dueTouch()])
    const result = await processDueScheduledTouches()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.dryRun).toBe(1)
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'DRY_RUN', sentAt: expect.any(Date), dryRun: true, resultDetail: 'dry_run_no_real_send' },
    })
  })
})

describe('processDueScheduledTouches — exit conditions (Part D)', () => {
  it('cancels a touch instead of sending if the enrollment is no longer ACTIVE', async () => {
    prismaMock.scheduledTouch.findMany.mockResolvedValue([dueTouch({ enrollment: { id: 'enr-1', status: 'EXITED_REPLY', leadId: null } })])
    const result = await processDueScheduledTouches()
    expect(result.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'CANCELLED', resultDetail: 'enrollment_not_active' },
    })
  })

  it('skips sending when the patient has opted out of the channel (consent check)', async () => {
    getChannelConsentStatus.mockResolvedValueOnce(false)
    prismaMock.scheduledTouch.findMany.mockResolvedValue([dueTouch()])
    const result = await processDueScheduledTouches()
    expect(result.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('processDueScheduledTouches — marketing sequences require an EXPLICIT opt-in (consent audit fix)', () => {
  it('an operational sequence (isMarketing:false) uses the existing default-opt-in fallback', async () => {
    prismaMock.scheduledTouch.findMany.mockResolvedValue([dueTouch()]) // isMarketing:false by default
    await processDueScheduledTouches()
    expect(getChannelConsentStatus).toHaveBeenCalledWith('p-1', 'WHATSAPP')
    expect(hasExplicitOptIn).not.toHaveBeenCalled()
  })

  it('a marketing sequence (isMarketing:true) NEVER uses the default-opt-in fallback — even if it would return true', async () => {
    getChannelConsentStatus.mockResolvedValue(true) // fallback would say "opted in" — must not be consulted at all
    hasExplicitOptIn.mockResolvedValue(false)
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      dueTouch({ touchTemplate: { channel: 'WHATSAPP', messageTemplate: 'Hi!', sequence: { isMarketing: true } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(getChannelConsentStatus).not.toHaveBeenCalled()
    expect(hasExplicitOptIn).toHaveBeenCalledWith('p-1', 'WHATSAPP')
    expect(result.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'SKIPPED', resultDetail: 'no_explicit_opt_in' },
    })
  })

  it('a marketing sequence sends once a real OPT_IN has been explicitly logged', async () => {
    hasExplicitOptIn.mockResolvedValue(true)
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      dueTouch({ touchTemplate: { channel: 'WHATSAPP', messageTemplate: 'Hi!', sequence: { isMarketing: true } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1) // still dry-run gated per Part W — just no longer blocked on consent
  })
})

describe('processDueScheduledTouches — LEAD-targeted touches must never bypass consent gating (release-blocker fix)', () => {
  it('blocks an operational lead touch when there is no recorded contact-origin evidence', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-1', name: 'Jo Lead', phone: '+256700000099' })
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null) // no evidence at all
    prismaMock.scheduledTouch.findMany.mockResolvedValue([leadTouch()])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-lead-1' },
      data: { status: 'SKIPPED', resultDetail: 'no_contact_origin_evidence' },
    })
  })

  it('sends (dry-run) an operational lead touch once inbound contact-origin evidence exists', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-1', name: 'Jo Lead', phone: '+256700000099' })
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() })
    prismaMock.scheduledTouch.findMany.mockResolvedValue([leadTouch()])

    const result = await processDueScheduledTouches()

    expect(result.dryRun).toBe(1)
    expect(result.skipped).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled() // still dry-run gated
  })

  it('a marketing lead sequence is blocked without an explicit MARKETING opt-in — never falls back to operational evidence', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-1', name: 'Jo Lead', phone: '+256700000099' })
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce(null) // no marketing opt-in on record
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      leadTouch({ touchTemplate: { channel: 'WHATSAPP', messageTemplate: 'Hi!', sequence: { isMarketing: true } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-lead-1' },
      data: { status: 'SKIPPED', resultDetail: 'no_marketing_opt_in_this_channel' },
    })
  })

  it('a marketing lead sequence sends once an explicit MARKETING opt-in is on record', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead-1', name: 'Jo Lead', phone: '+256700000099' })
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'OPT_IN', recordedAt: new Date() })
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      leadTouch({ touchTemplate: { channel: 'WHATSAPP', messageTemplate: 'Hi!', sequence: { isMarketing: true } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })
})

describe('processDueScheduledTouches — completion', () => {
  it('marks the enrollment COMPLETED once no PENDING touches remain', async () => {
    prismaMock.scheduledTouch.findMany.mockResolvedValue([dueTouch()])
    prismaMock.scheduledTouch.count.mockResolvedValue(0)
    await processDueScheduledTouches()
    expect(prismaMock.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { status: 'COMPLETED', exitedAt: expect.any(Date) },
    })
  })
})

// ── Milestone: Meta WhatsApp template fail-closed gate (patient sequence
// content/activation pass) — scoped to the 3 sequences in
// sequence-meta-templates.ts. A touch mapped there must never attempt a
// free-text send once it's outside the 24h session window unless its
// approved-template env var is configured; every other sequence is
// completely unaffected by this gate.
describe('processDueScheduledTouches — Meta template fail-closed gate (recall/treatment sequences)', () => {
  function mappedTouch(overrides: Record<string, any> = {}) {
    return dueTouch({
      touchTemplate: {
        channel: 'WHATSAPP',
        order: 0,
        messageTemplate: 'Good morning {firstName} 😊',
        sequence: { key: 'recall_due_reminder', isMarketing: false },
      },
      ...overrides,
    })
  }

  it('blocks the touch (no send attempted on any path) when outside the 24h window and no template env var is configured', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue(null) // no inbound ever -> outside window
    prismaMock.scheduledTouch.findMany.mockResolvedValue([mappedTouch()])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(1)
    expect(result.dryRun).toBe(0)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(prismaMock.scheduledTouch.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { status: 'SKIPPED', resultDetail: 'blocked_template_required' },
    })
  })

  it('does not block when a recent inbound message puts the patient back inside the 24h session window', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }) // 1h ago
    prismaMock.scheduledTouch.findMany.mockResolvedValue([mappedTouch()])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1) // proceeds to the normal dry-run-gated send path, not blocked
  })

  it('does not block outside the window once the matching template env var is configured', async () => {
    process.env.WA_TEMPLATE_RECALL_DUE_D0 = 'cc_recall_due_d0'
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    prismaMock.scheduledTouch.findMany.mockResolvedValue([mappedTouch()])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1)
  })

  it('never applies the gate to a sequence not in the Meta template map — unaffected, unblocked, unrelated functionality untouched', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue(null) // outside window, but irrelevant here
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      dueTouch({ touchTemplate: { channel: 'WHATSAPP', order: 0, messageTemplate: 'Hi {firstName}!', sequence: { key: 'some_other_sequence', isMarketing: false } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1)
  })

  it('never applies the gate to a SMS touch, even for a mapped sequence key', async () => {
    prismaMock.aiMessage.findFirst.mockResolvedValue(null)
    prismaMock.scheduledTouch.findMany.mockResolvedValue([
      mappedTouch({ touchTemplate: { channel: 'SMS', order: 0, messageTemplate: 'Hi {firstName}!', sequence: { key: 'recall_due_reminder', isMarketing: false } } }),
    ])

    const result = await processDueScheduledTouches()

    expect(result.skipped).toBe(0)
    expect(result.dryRun).toBe(1)
    expect(prismaMock.aiMessage.findFirst).not.toHaveBeenCalled()
  })
})