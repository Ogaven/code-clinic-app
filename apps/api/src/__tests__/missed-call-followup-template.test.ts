// Covers the Workstream D fix to followup.service.ts: the live, APPROVED
// Meta template `cc_missed_call_followup` has a fixed body with ZERO
// {{1}}-style placeholders (confirmed read-only against the real Meta
// message_templates definition — see the code comments at both call
// sites), but both call sites were passing one parameter anyway
// ([addr]/[name]), which Meta rejects with #132000 "Number of parameters
// does not match the expected number of params" before the message ever
// reaches the patient.
//
// This file verifies that both standalone and queued unsolicited missed-call
// WhatsApp follow-ups remain disabled.

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

describe('checkAndSendMissedCallFollowups — unsolicited messages disabled', () => {
  it('does not query short calls or send any WhatsApp message', async () => {
    store.agentLogs.push({
      id: 'log-1', channel: 'VOICE', callSid: 'CA1', durationSec: 5, patientId: 'patient-1',
      createdAt: new Date(), patient: makePatient(),
    })
    const { checkAndSendMissedCallFollowups } = await import('../ai-suite/scheduler/followup.service')
    await checkAndSendMissedCallFollowups()
    const { prisma } = await import('../lib/prisma')
    expect(prisma.agentLog.findMany).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })
})

describe('processAfterHoursQueue — unsolicited queue disabled', () => {
  it.each(['MISSED_CALL_FOLLOWUP', 'MORNING_FOLLOWUP'])('never sends queued %s messages', async (agentMode) => {
    store.outboundQueue.push({
      id: 'q-1', agentMode, status: 'PENDING', scheduledFor: new Date(Date.now() - 1000),
      phoneNumber: '+256700000002', patient: makePatient({ id: 'patient-2', phone: '+256700000002' }),
    })
    const { processAfterHoursQueue } = await import('../ai-suite/scheduler/followup.service')
    await processAfterHoursQueue()
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })
})
