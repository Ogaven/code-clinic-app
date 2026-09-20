// Regression coverage for the "escalations must not depend on staff opening
// the app, and staff WhatsApp alerts must not blindly attempt a free-form
// send outside Meta's 24h customer-service window" investigation.
//
// Root cause found: notifyJulian() (the shared staff-alert sender used by 5
// call sites) fell back to a free-form WhatsApp send unconditionally whenever
// no template was configured, or whenever a configured template's send
// itself failed for ANY reason -- exactly the shape of send Meta rejects with
// #131047 "re-engagement message" outside the 24h window (real production
// logs showed this against the actual clinic escalation number). It also had
// no fallback at all if BOTH WhatsApp and SMS failed -- the alert simply
// vanished except for a server log line. Fixed: free-form is only attempted
// when the staff number has messaged in within 24h (mirrors the same
// fail-closed pattern followup.service.ts already uses for patient
// confirmations); when neither WhatsApp nor SMS succeeds, an in-app
// Notification + push is created as a last-resort channel that doesn't
// depend on any external provider's account health.

import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const store = vi.hoisted(() => ({
  messages:      [] as any[], // { phoneNumber, role, createdAt }
  patients:      new Map<string, any>(),
  users:         new Map<string, any>(),
  notifications: [] as any[],
}))

vi.mock('../lib/prisma', () => ({
  prisma: {
    aiMessage: {
      findFirst: vi.fn(async ({ where }: any) => {
        const phones: string[] = where?.conversation?.phoneNumber?.in ?? []
        const matches = store.messages
          .filter(m => phones.includes(m.phoneNumber) && m.role === where.role)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return matches[0] ?? null
      }),
    },
    patient: {
      findFirst: vi.fn(async ({ where }: any) => {
        const phones: string[] = where?.phone?.in ?? []
        return [...store.patients.values()].find(p => phones.includes(p.phone)) ?? null
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        const roles: string[] = where?.role?.in ?? []
        return [...store.users.values()].filter(u => roles.includes(u.role) && u.isActive)
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `notif_${store.notifications.length + 1}`, ...data }
        store.notifications.push(row)
        return row
      }),
    },
    escalation: {
      create: vi.fn(async ({ data }: any) => ({ id: 'esc_1', ...data })),
    },
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url: string }) => {}))
vi.mock('../services/push.service', () => ({ sendPushToUser: pushMock }))

const { sendWhatsAppMessageMock, sendWhatsAppTemplateMock } = vi.hoisted(() => ({
  sendWhatsAppMessageMock:  vi.fn().mockResolvedValue('wamid.freeform'),
  sendWhatsAppTemplateMock: vi.fn().mockResolvedValue('wamid.template'),
}))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage:  sendWhatsAppMessageMock,
  sendWhatsAppTemplate: sendWhatsAppTemplateMock,
}))

const sendStaffSMSMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../ai-suite/sms/sms.service', () => ({ sendStaffSMS: sendStaffSMSMock }))

import { createEscalation, notifyJulian, isWithinStaffSessionWindow } from '../services/agent/guards/escalation'

const STAFF_PHONE = '+256394836298'
const ORIGINAL_ENV = { ...process.env }

function setStaffLastInbound(hoursAgo: number | null) {
  store.messages.length = 0
  if (hoursAgo === null) return
  store.messages.push({
    phoneNumber: STAFF_PHONE,
    role: 'USER',
    createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.messages.length = 0
  store.patients.clear()
  store.notifications.length = 0
  store.users.clear()
  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  process.env = { ...ORIGINAL_ENV, STAFF_WHATSAPP_NUMBER: STAFF_PHONE }
  delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME
})

describe('isWithinStaffSessionWindow', () => {
  it('is true when the staff number messaged in within the last 24h', async () => {
    setStaffLastInbound(2)
    expect(await isWithinStaffSessionWindow(STAFF_PHONE)).toBe(true)
  })

  it('is false when the last inbound from staff was over 24h ago', async () => {
    setStaffLastInbound(30)
    expect(await isWithinStaffSessionWindow(STAFF_PHONE)).toBe(false)
  })

  it('is false when staff has never messaged the business number', async () => {
    setStaffLastInbound(null)
    expect(await isWithinStaffSessionWindow(STAFF_PHONE)).toBe(false)
  })
})

describe('notifyJulian — fail-closed WhatsApp window gating + guaranteed delivery', () => {
  it('sends via the approved template when configured, regardless of window state', async () => {
    process.env.WA_TEMPLATE_STAFF_ALERT_NAME = 'cc_staff_concern'
    setStaffLastInbound(30) // outside window -- template must not care
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    expect(store.notifications).toHaveLength(0) // WhatsApp succeeded, no fallback needed
  })

  it('within the session window, falls back to freeform when the template fails', async () => {
    process.env.WA_TEMPLATE_STAFF_ALERT_NAME = 'cc_staff_concern'
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('#132001 Template not approved'))
    setStaffLastInbound(2) // within window
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('outside the session window with no template configured, does NOT attempt a freeform send (the #131047 fix)', async () => {
    setStaffLastInbound(48) // outside window, no template
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('outside the session window, a template failure does NOT fall back to freeform either (would just produce another #131047)', async () => {
    process.env.WA_TEMPLATE_STAFF_ALERT_NAME = 'cc_staff_concern'
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('template down'))
    setStaffLastInbound(48)
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('within the session window with no template configured, sends freeform directly (unchanged legitimate behavior)', async () => {
    setStaffLastInbound(1)
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('always attempts SMS as an independent channel regardless of the WhatsApp outcome', async () => {
    setStaffLastInbound(1)
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(sendStaffSMSMock).toHaveBeenCalledTimes(1)
  })

  it('creates an in-app notification + push fallback for every RECEPTIONIST/ADMIN user when BOTH WhatsApp and SMS fail, and never a DOCTOR', async () => {
    store.users.set('doctor_1', { id: 'doctor_1', role: 'DOCTOR', isActive: true })
    setStaffLastInbound(48) // WhatsApp blocked by the window gate
    sendStaffSMSMock.mockRejectedValueOnce(new Error("Africa's Talking not configured"))
    await notifyJulian('+256700111222', 'my tooth hurts')

    expect(store.notifications).toHaveLength(2)
    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).not.toContain('doctor_1')
    expect(recipientIds.sort()).toEqual(['admin_1', 'reception_1'])
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT create an in-app fallback notification when WhatsApp or SMS actually succeeded', async () => {
    setStaffLastInbound(1) // WhatsApp succeeds
    await notifyJulian('+256700111222', 'my tooth hurts')
    expect(store.notifications).toHaveLength(0)
  })

  it('sends the RECEPTIONIST fallback notification to the receptionist-prefixed route and ADMIN to the bare route', async () => {
    setStaffLastInbound(48)
    sendStaffSMSMock.mockRejectedValueOnce(new Error('down'))
    await notifyJulian('+256700111222', 'my tooth hurts')

    const receptionNotif = store.notifications.find(n => n.userId === 'reception_1')
    const adminNotif     = store.notifications.find(n => n.userId === 'admin_1')
    expect(receptionNotif.href).toMatch(/^\/receptionist\/ai-suite\/inbox/)
    expect(adminNotif.href).toMatch(/^\/ai-suite\/inbox/)
    expect(adminNotif.href).not.toMatch(/^\/receptionist/)
  })

  it('never throws out of the caller even if WhatsApp, SMS, and the in-app fallback all fail', async () => {
    setStaffLastInbound(1)
    sendWhatsAppMessageMock.mockRejectedValueOnce(new Error('wa down'))
    sendStaffSMSMock.mockRejectedValueOnce(new Error('sms down'))
    await expect(notifyJulian('+256700111222', 'my tooth hurts')).resolves.toBeUndefined()
  })
})

describe('createEscalation — persists independent of WhatsApp, and redacts the push body', () => {
  it('creates an in-app Notification and push for every RECEPTIONIST/ADMIN user with no WhatsApp/SMS involved', async () => {
    await createEscalation({ phoneNumber: '+256700111222', channel: 'WHATSAPP', reason: 'Patient is furious about a billing error' })

    expect(store.notifications).toHaveLength(2)
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    expect(sendStaffSMSMock).not.toHaveBeenCalled()
  })

  // Role-targeting matrix: AI escalations (a patient WhatsApp/voice
  // conversation needing human follow-up -- booking, complaints, distress)
  // are an operational front-desk triage function, not a clinical one --
  // reception/admin make first contact and decide whether a doctor needs to
  // be looped in separately; createEscalation has no doctorId/patient-doctor
  // concept in its params at all, unlike treatment-followup-alerts.service.ts
  // (which explicitly adds the assigned doctor -- see its own test "notifies
  // the assigned doctor in addition to reception/admin when the plan has a
  // doctor"). Structurally confirmed elsewhere in the app: there is no
  // /doctor/.../escalations page, no Escalations destination in DOCTOR_NAV
  // (mobileNav.ts), and no doctor entry in middleware.ts's escalations route
  // guard -- this is a deliberate, existing product decision, not something
  // invented for this fix. A DOCTOR user present in the staff table must
  // never receive a general AI escalation.
  it('never notifies a DOCTOR user for a general AI escalation, even when one exists and is active', async () => {
    store.users.set('doctor_1', { id: 'doctor_1', role: 'DOCTOR', isActive: true })

    await createEscalation({ phoneNumber: '+256700111222', channel: 'WHATSAPP', reason: 'Patient wants to reschedule' })

    const recipientIds = store.notifications.map(n => n.userId)
    expect(recipientIds).not.toContain('doctor_1')
    expect(recipientIds.sort()).toEqual(['admin_1', 'reception_1'])
  })

  it('keeps the full escalation reason in the in-app notification body but never in the push body (no clinical/complaint detail on a locked screen)', async () => {
    await createEscalation({ phoneNumber: '+256700111222', channel: 'WHATSAPP', reason: 'Patient is furious about a billing error' })

    const notif = store.notifications[0]
    expect(notif.body).toContain('furious about a billing error')

    const pushCall = pushMock.mock.calls.find(c => c[0] === notif.userId)
    expect(pushCall![1].body).not.toContain('furious')
    expect(pushCall![1].body).not.toContain('billing error')
  })

  it('routes RECEPTIONIST and ADMIN to their own role-prefixed escalations screen', async () => {
    await createEscalation({ phoneNumber: '+256700111222', channel: 'WHATSAPP', reason: 'test' })
    const receptionNotif = store.notifications.find(n => n.userId === 'reception_1')
    const adminNotif     = store.notifications.find(n => n.userId === 'admin_1')
    expect(receptionNotif.href).toMatch(/^\/receptionist\/ai-suite\/escalations/)
    expect(adminNotif.href).toMatch(/^\/ai-suite\/escalations/)
    expect(adminNotif.href).not.toMatch(/^\/receptionist/)
  })
})
