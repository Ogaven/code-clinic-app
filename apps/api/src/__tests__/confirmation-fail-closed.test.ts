// Covers checkAndSendAppointmentConfirmations' fail-closed rule
// (followup.service.ts): outside WhatsApp's 24h session window, a send is
// only attempted via an APPROVED template — never a free-text fallback.
// With no template configured, no send is attempted at all
// (BLOCKED_TEMPLATE_REQUIRED), and the confirmation dashboard must reflect
// that rather than showing the appointment as falsely sendable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kampalaTomorrowRange } from '../utils/kampala-time'

const { sendWhatsAppMessage, sendWhatsAppTemplate, notifyReceptionistUnreachable } = vi.hoisted(() => ({
  sendWhatsAppMessage:  vi.fn().mockResolvedValue('wamid-freetext'),
  sendWhatsAppTemplate: vi.fn().mockResolvedValue('wamid-template'),
  notifyReceptionistUnreachable: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({ sendWhatsAppMessage, sendWhatsAppTemplate, notifyReceptionistUnreachable }))

const { resolveOutboundRecipient, alertStaffMinorNoGuardian, hasOutboundConsent } = vi.hoisted(() => ({
  resolveOutboundRecipient: vi.fn(async (patient: any) => ({ ok: true, recipient: { phone: patient.phone } })),
  alertStaffMinorNoGuardian: vi.fn().mockResolvedValue(undefined),
  hasOutboundConsent: vi.fn().mockResolvedValue(true),
}))
vi.mock('../ai-suite/scheduler/guardian-routing.service', () => ({
  resolveOutboundRecipient, alertStaffMinorNoGuardian, hasOutboundConsent,
}))

interface FakeAppt {
  id: string
  patientId: string
  startAt: Date
  status: string
  patient: { id: string; firstName: string; lastName: string; phone: string; dob: null; nextOfKinName: null; nextOfKinRelation: null; guardianId: null; familyAccountId: null; guardian: null }
  doctor: { user: { firstName: string } }
  service: { name: string }
}

const store = vi.hoisted(() => ({
  appointments: [] as FakeAppt[],
  scheduledMessages: [] as { patientId: string; templateType: string; sent: boolean; scheduledFor: Date; createdAt: Date }[],
  lastInboundByPhone: new Map<string, Date | null>(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async ({ where }: any) => {
        const { gte, lt } = where.startAt
        const statuses: string[] = where.status.in
        return store.appointments.filter(a => a.startAt >= gte && a.startAt < lt && statuses.includes(a.status))
      }),
    },
    aiScheduledMessage: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.scheduledMessages.find(m =>
          m.patientId === where.patientId &&
          m.templateType === where.templateType &&
          m.sent === where.sent &&
          m.scheduledFor >= where.scheduledFor.gte && m.scheduledFor < where.scheduledFor.lt,
        ) ?? null
      }),
      create: vi.fn(async ({ data }: any) => {
        store.scheduledMessages.push({ ...data, createdAt: new Date() })
        return data
      }),
    },
    aiMessage: {
      findFirst: vi.fn(async ({ where }: any) => {
        // Only call site in the send path is the lastInbound (role: USER) lookup by phone.
        const phone = where.conversation?.phoneNumber
        const last = store.lastInboundByPhone.get(phone)
        return last ? { createdAt: last } : null
      }),
      create: vi.fn(async () => ({})),
    },
    aiConversation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'conv-1', ...data })),
    },
  },
}))

let checkAndSendAppointmentConfirmations: typeof import('../ai-suite/scheduler/followup.service').checkAndSendAppointmentConfirmations

const NOW = new Date('2026-09-14T10:00:00.000Z')
const { start: tomorrowStart } = kampalaTomorrowRange(NOW)
const apptTime = new Date(tomorrowStart.getTime() + 9 * 60 * 60 * 1000) // 9am Kampala tomorrow

function makeAppt(overrides: Partial<FakeAppt> = {}): FakeAppt {
  const id = overrides.id ?? `appt_${store.appointments.length + 1}`
  return {
    id,
    patientId: `patient_${id}`,
    startAt: apptTime,
    status: 'PENDING',
    patient: {
      id: `patient_${id}`, firstName: 'Jane', lastName: 'Doe', phone: `+25670000${store.appointments.length}`,
      dob: null, nextOfKinName: null, nextOfKinRelation: null, guardianId: null, familyAccountId: null, guardian: null,
    },
    doctor: { user: { firstName: 'Lois' } },
    service: { name: 'Checkup' },
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  store.appointments = []
  store.scheduledMessages = []
  store.lastInboundByPhone = new Map()
  delete process.env.WA_TEMPLATE_CONFIRMATION_NAME
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  ;({ checkAndSendAppointmentConfirmations } = await import('../ai-suite/scheduler/followup.service'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkAndSendAppointmentConfirmations — fail-closed template gating', () => {
  it('inside the 24h session window -> allowed (free-text send)', async () => {
    const appt = makeAppt()
    store.appointments.push(appt)
    store.lastInboundByPhone.set(appt.patient.phone, new Date(NOW.getTime() - 60 * 60 * 1000)) // 1h ago

    const result = await checkAndSendAppointmentConfirmations(true)

    expect(result).toEqual({ sent: 1, skipped: 0, blockedTemplateRequired: 0 })
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('outside the window WITH an approved template configured -> allowed (template send, never free text)', async () => {
    process.env.WA_TEMPLATE_CONFIRMATION_NAME = 'cc_appointment_confirmation'
    const appt = makeAppt()
    store.appointments.push(appt)
    // No recent inbound message at all -> outside window.

    const result = await checkAndSendAppointmentConfirmations(true)

    expect(result).toEqual({ sent: 1, skipped: 0, blockedTemplateRequired: 0 })
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('outside the window with NO template configured -> BLOCKED_TEMPLATE_REQUIRED, no send attempted on any path', async () => {
    const appt = makeAppt()
    store.appointments.push(appt)
    // No recent inbound -> outside window; WA_TEMPLATE_CONFIRMATION_NAME unset.

    const result = await checkAndSendAppointmentConfirmations(true)

    expect(result).toEqual({ sent: 0, skipped: 0, blockedTemplateRequired: 1 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('a cancelled appointment is never even considered (excluded by the query, not a send attempt)', async () => {
    const cancelled = makeAppt({ status: 'CANCELLED' })
    store.appointments.push(cancelled)
    store.lastInboundByPhone.set(cancelled.patient.phone, new Date(NOW.getTime() - 60 * 60 * 1000))

    const result = await checkAndSendAppointmentConfirmations(true)

    expect(result).toEqual({ sent: 0, skipped: 0, blockedTemplateRequired: 0 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })

  it('already sent for this window -> idempotent skip, no duplicate send', async () => {
    const appt = makeAppt()
    store.appointments.push(appt)
    store.lastInboundByPhone.set(appt.patient.phone, new Date(NOW.getTime() - 60 * 60 * 1000))
    store.scheduledMessages.push({
      patientId: appt.patientId, templateType: 'APPOINTMENT_CONFIRMATION', sent: true,
      scheduledFor: apptTime, createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    })

    const result = await checkAndSendAppointmentConfirmations(true)

    expect(result).toEqual({ sent: 0, skipped: 1, blockedTemplateRequired: 0 })
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })
})
