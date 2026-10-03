// Covers the Workstream D fix to followup.service.ts: the live, APPROVED
// Meta template `cc_missed_call_followup` has a fixed body with ZERO
// {{1}}-style placeholders (confirmed read-only against the real Meta
// message_templates definition — see the code comments at both call
// sites), but both call sites were passing one parameter anyway
// ([addr]/[name]), which Meta rejects with #132000 "Number of parameters
// does not match the expected number of params" before the message ever
// reaches the patient.
//
// This file proves:
//  1. checkAndSendMissedCallFollowups now calls sendWhatsAppTemplate with
//     an EMPTY parameter array for cc_missed_call_followup.
//  2. processAfterHoursQueue's MISSED_CALL_FOLLOWUP branch does the same.
//  3. processAfterHoursQueue's OTHER branch (MORNING_FOLLOWUP, a different,
//     unverified template) is UNCHANGED — still passes [name] — proving
//     this fix stayed scoped to cc_missed_call_followup only.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')
process.env.OPENAI_API_KEY     ??= 'test-key-not-real'

const store = vi.hoisted(() => ({
  agentLogs: [] as any[],
  outboundQueue: [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    agentLog: {
      findMany: vi.fn(async () => store.agentLogs),
    },
    aiScheduledMessage: {
      findFirst: vi.fn(async () => null), // not already sent
      create: vi.fn(async () => ({})),
    },
    appointment: {
      findFirst: vi.fn(async () => null), // no recent booking
    },
    outboundQueue: {
      findMany: vi.fn(async () => store.outboundQueue),
      update: vi.fn(async () => ({})),
    },
  },
}))

const sendWhatsAppTemplateMock = vi.hoisted(() => vi.fn().mockResolvedValue('wamid.template'))
const sendWhatsAppMessageMock  = vi.hoisted(() => vi.fn().mockResolvedValue('wamid.freeform'))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppTemplate: sendWhatsAppTemplateMock,
  sendWhatsAppMessage:  sendWhatsAppMessageMock,
  notifyReceptionistUnreachable: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../ai-suite/scheduler/guardian-routing.service', () => ({
  hasOutboundConsent: vi.fn().mockResolvedValue(true),
  resolveOutboundRecipient: vi.fn(async (patient: any, displayName: string) => ({
    ok: true,
    recipient: { phone: patient.phone, name: displayName, isGuardian: false },
  })),
  alertStaffMinorNoGuardian: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  store.agentLogs.length = 0
  store.outboundQueue.length = 0
  delete process.env.WA_TEMPLATE_MISSED_CALL_NAME
  delete process.env.WA_TEMPLATE_AFTER_HOURS_NAME
})

function makePatient(overrides: Partial<any> = {}) {
  return {
    id: 'patient-1', firstName: 'Jane', lastName: 'Doe', phone: '+256700000001',
    dob: new Date('1990-01-01'), nextOfKinName: null, nextOfKinRelation: null,
    guardianId: null, familyAccountId: null, guardian: null,
    ...overrides,
  }
}

describe('checkAndSendMissedCallFollowups — cc_missed_call_followup param mismatch', () => {
  it('sends the template with an EMPTY parameter array (the approved body has no placeholders)', async () => {
    store.agentLogs.push({
      id: 'log-1', channel: 'VOICE', callSid: 'CA1', durationSec: 5, patientId: 'patient-1',
      createdAt: new Date(), patient: makePatient(),
    })
    const { checkAndSendMissedCallFollowups } = await import('../ai-suite/scheduler/followup.service')

    await checkAndSendMissedCallFollowups()

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    const [, templateName, params] = sendWhatsAppTemplateMock.mock.calls[0]
    expect(templateName).toBe('cc_missed_call_followup')
    expect(params).toEqual([])
  })

  it('respects WA_TEMPLATE_MISSED_CALL_NAME override for the template NAME, but still sends zero params', async () => {
    process.env.WA_TEMPLATE_MISSED_CALL_NAME = 'cc_missed_call_followup_v2'
    store.agentLogs.push({
      id: 'log-2', channel: 'VOICE', callSid: 'CA2', durationSec: 3, patientId: 'patient-1',
      createdAt: new Date(), patient: makePatient(),
    })
    const { checkAndSendMissedCallFollowups } = await import('../ai-suite/scheduler/followup.service')

    await checkAndSendMissedCallFollowups()

    const [, templateName, params] = sendWhatsAppTemplateMock.mock.calls[0]
    expect(templateName).toBe('cc_missed_call_followup_v2')
    expect(params).toEqual([])
  })
})

describe('processAfterHoursQueue — MISSED_CALL_FOLLOWUP branch uses cc_missed_call_followup correctly', () => {
  it('sends cc_missed_call_followup with zero params for a MISSED_CALL_FOLLOWUP entry', async () => {
    store.outboundQueue.push({
      id: 'q-1', agentMode: 'MISSED_CALL_FOLLOWUP', status: 'PENDING', scheduledFor: new Date(Date.now() - 1000),
      phoneNumber: '+256700000002', patient: makePatient({ id: 'patient-2', phone: '+256700000002' }),
    })
    const { processAfterHoursQueue } = await import('../ai-suite/scheduler/followup.service')

    await processAfterHoursQueue()

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    const [, templateName, params] = sendWhatsAppTemplateMock.mock.calls[0]
    expect(templateName).toBe('cc_missed_call_followup')
    expect(params).toEqual([])
  })

  it('leaves the UNRELATED MORNING_FOLLOWUP branch unchanged — still passes [name] to its own (different, unverified) template', async () => {
    process.env.WA_TEMPLATE_AFTER_HOURS_NAME = 'cc_after_hours_morning'
    store.outboundQueue.push({
      id: 'q-2', agentMode: 'MORNING_FOLLOWUP', status: 'PENDING', scheduledFor: new Date(Date.now() - 1000),
      phoneNumber: '+256700000003', patient: makePatient({ id: 'patient-3', phone: '+256700000003', firstName: 'Mike' }),
    })
    const { processAfterHoursQueue } = await import('../ai-suite/scheduler/followup.service')

    await processAfterHoursQueue()

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    const [, templateName, params] = sendWhatsAppTemplateMock.mock.calls[0]
    expect(templateName).toBe('cc_after_hours_morning')
    expect(params).toEqual(['Mike']) // unchanged — this fix never touched this branch
  })
})
