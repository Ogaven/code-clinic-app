import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const { prismaMock, sendWhatsAppMessage, sendPushToUser } = vi.hoisted(() => ({
  prismaMock: {
    lead: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    task: { create: vi.fn() },
    notification: { create: vi.fn() },
    routingRule: { findFirst: vi.fn().mockResolvedValue(null) },
    automationEvent: { create: vi.fn().mockResolvedValue({ id: 'evt' }), update: vi.fn() },
    sequenceDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    leadConsentLog: { findFirst: vi.fn(), create: vi.fn() },
  },
  sendWhatsAppMessage: vi.fn().mockResolvedValue('wamid-1'),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage }))
vi.mock('../../services/push.service', () => ({ sendPushToUser }))

import { findOrCreateLeadForChannel, handleNewLeadCreated } from '../../crm-automation/lead-intake.service'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'test'
  delete process.env.CRM_AUTOMATION_LIVE
  prismaMock.routingRule.findFirst.mockResolvedValue(null)
  prismaMock.sequenceDefinition.findMany.mockResolvedValue([])
  // Default: no consent evidence at all (opt-out check + operational-evidence
  // check both miss) — matches a lead with no recorded contact origin.
  prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
})

describe('handleNewLeadCreated — Part K new-lead intake', () => {
  const baseLead = { id: 'lead-1', name: 'Jo Doe', phone: '+256700000001', email: null, source: 'QUIZ', assignedTo: null } as any

  it('creates a task, an in-app owner notification, and a dry-run acknowledgement when operational contact evidence exists', async () => {
    // Mirrors real usage: findOrCreateLeadForChannel records OPERATIONAL
    // OPT_IN evidence for this channel BEFORE calling handleNewLeadCreated,
    // so a fresh quiz/website/whatsapp lead always has evidence by this point.
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null) // opt-out check
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() })
    const result = await handleNewLeadCreated(baseLead)
    expect(prismaMock.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'LEAD', entityId: 'lead-1' }),
    }))
    expect(sendWhatsAppMessage).not.toHaveBeenCalled() // dry-run — never a real send
    expect(result.acknowledgement).toEqual({ dryRun: true })
  })

  it('blocks the acknowledgement (but still creates the task) when there is no recorded contact-origin evidence — e.g. a manual/walk-in lead created without going through findOrCreateLeadForChannel', async () => {
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null) // no evidence at all
    const result = await handleNewLeadCreated(baseLead)
    expect(prismaMock.task.create).toHaveBeenCalled() // task/owner/SLA still happen
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.acknowledgement).toEqual({ blocked: 'no_contact_origin_evidence' })
  })

  it('skips the acknowledgement entirely when skipAcknowledgement is set (channels with a real-time AI reply)', async () => {
    const result = await handleNewLeadCreated(baseLead, { skipAcknowledgement: true })
    expect(result.acknowledgement).toBeNull()
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('never sends a real push to the owner in dry-run mode, even when an owner is assigned', async () => {
    await handleNewLeadCreated({ ...baseLead, assignedTo: 'owner-1' })
    expect(prismaMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'owner-1' }) }))
    expect(sendPushToUser).not.toHaveBeenCalled()
  })
})

describe('handleNewLeadCreated — CRM_OPERATIONAL_AUTOMATION_LIVE feature flag (release-blocker fix — per-feature gating)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  beforeEach(() => { process.env.NODE_ENV = 'production' })
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    delete process.env.CRM_AUTOMATION_LIVE
    delete process.env.CRM_OPERATIONAL_AUTOMATION_LIVE
  })

  it('master ON but OPERATIONAL feature flag OFF -> still dry-run even with operational evidence', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true' // OPERATIONAL flag deliberately not set
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() })
    const baseLead = { id: 'lead-1', name: 'Jo Doe', phone: '+256700000001', email: null, source: 'QUIZ', assignedTo: null } as any

    const result = await handleNewLeadCreated(baseLead)

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.acknowledgement).toEqual({ dryRun: true })
  })

  it('master+OPERATIONAL feature ON with operational evidence -> a real acknowledgement send is attempted', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    prismaMock.leadConsentLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ channel: 'WHATSAPP', purpose: 'OPERATIONAL', status: 'OPT_IN', recordedAt: new Date() })
    const baseLead = { id: 'lead-1', name: 'Jo Doe', phone: '+256700000001', email: null, source: 'QUIZ', assignedTo: null } as any

    const result = await handleNewLeadCreated(baseLead)

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(result.acknowledgement).toEqual({ dryRun: false })
  })

  it('master+OPERATIONAL feature ON but NO consent evidence -> still blocked, no message', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    prismaMock.leadConsentLog.findFirst.mockResolvedValue(null)
    const baseLead = { id: 'lead-1', name: 'Jo Doe', phone: '+256700000001', email: null, source: 'QUIZ', assignedTo: null } as any

    const result = await handleNewLeadCreated(baseLead)

    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(result.acknowledgement).toEqual({ blocked: 'no_contact_origin_evidence' })
  })
})

describe('findOrCreateLeadForChannel — single lead-creation orchestration entry point (Part K)', () => {
  it('creates a new lead and runs new-lead intake exactly once when none exists', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce(null)
    prismaMock.lead.create.mockResolvedValueOnce({ id: 'lead-1', name: null, phone: '+256700000001', source: 'WHATSAPP', assignedTo: null })

    const { lead, isNew } = await findOrCreateLeadForChannel({
      where: { phone: '+256700000001', status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: { phone: '+256700000001', source: 'WHATSAPP', status: 'NEW', stage: 'NEW', lastMessage: 'hi' },
      intakeOptions: { skipAcknowledgement: true },
    })

    expect(isNew).toBe(true)
    expect(lead.id).toBe('lead-1')
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1) // new-lead intake ran
  })

  it('does NOT double-create a lead — updates the existing one and logs an inbound reply instead', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', name: null, phone: '+256700000001' })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', name: null, phone: '+256700000001', lastMessage: 'follow-up' })

    const { isNew } = await findOrCreateLeadForChannel({
      where: { phone: '+256700000001', status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: { phone: '+256700000001', source: 'WHATSAPP', status: 'NEW', stage: 'NEW', lastMessage: 'follow-up' },
      onExistingMessage: 'follow-up',
    })

    expect(isNew).toBe(false)
    expect(prismaMock.lead.create).not.toHaveBeenCalled()
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { lastMessage: 'follow-up' } })
    expect(prismaMock.task.create).not.toHaveBeenCalled() // new-lead intake must NOT re-run
  })

  it('fills in a missing name on an existing lead without overwriting one that is already set', async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', name: null, phone: '+256700000001' })
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-1', name: 'Jo', phone: '+256700000001' })

    await findOrCreateLeadForChannel({
      where: { phone: '+256700000001', status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: { phone: '+256700000001', source: 'WEBSITE', status: 'NEW', stage: 'NEW' },
      onExistingNameIfMissing: 'Jo',
    })

    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { name: 'Jo' } })
  })
})
