import { describe, expect, it, vi, beforeEach } from 'vitest'

// Regression coverage for the 2026-09-16 investigation (template-first,
// freeform-only-as-fallback) PLUS the follow-up 2026-09-20 fix: the freeform
// fallback used to fire unconditionally whenever no template was configured,
// or whenever a configured template's send itself failed for ANY reason --
// exactly the shape of send Meta rejects with #131047 outside the 24h
// customer-service window. alertStaffMinorNoGuardian fires every time a
// scheduled job hits the same still-unfixed patient (by design), making it
// the single highest-volume source of those real production failures against
// the staff number. Freeform is now only ever attempted when the staff
// number has messaged the business within the last 24h (mirrors
// escalation.ts's notifyJulian() and followup.service.ts's patient-
// confirmation gating); outside the window with no working WhatsApp send, an
// in-app Notification + push is a guaranteed fallback so the alert is never
// silently lost.

process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')

const { sendWhatsAppMessageMock, sendWhatsAppTemplateMock } = vi.hoisted(() => ({
  sendWhatsAppMessageMock:  vi.fn().mockResolvedValue('wamid.freeform'),
  sendWhatsAppTemplateMock: vi.fn().mockResolvedValue('wamid.template'),
}))
vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage:  sendWhatsAppMessageMock,
  sendWhatsAppTemplate: sendWhatsAppTemplateMock,
}))

const store = vi.hoisted(() => ({
  messages:      [] as any[], // { phoneNumber, role, createdAt }
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
      findFirst: vi.fn(async () => null),
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
  },
}))

const pushMock = vi.hoisted(() => vi.fn(async (_userId: string, _payload: { title: string; body: string; url: string }) => {}))
vi.mock('../services/push.service', () => ({ sendPushToUser: pushMock }))

import { alertStaffMinorNoGuardian } from '../ai-suite/scheduler/guardian-routing.service'

const STAFF_PHONE = '+256394836298'
const ORIGINAL_ENV = { ...process.env }

function setStaffLastInbound(hoursAgo: number | null) {
  store.messages.length = 0
  if (hoursAgo === null) return
  store.messages.push({ phoneNumber: STAFF_PHONE, role: 'USER', createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.messages.length = 0
  store.notifications.length = 0
  store.users.clear()
  store.users.set('reception_1', { id: 'reception_1', role: 'RECEPTIONIST', isActive: true })
  store.users.set('admin_1', { id: 'admin_1', role: 'ADMIN', isActive: true })
  process.env = { ...ORIGINAL_ENV, STAFF_WHATSAPP_NUMBER: STAFF_PHONE, WA_TEMPLATE_STAFF_ALERT_NAME: 'cc_staff_concern' }
  // Default to inside the session window so the pre-existing template/
  // freeform-fallback tests below don't need to know about window gating at
  // all -- only the tests explicitly about the window override this.
  setStaffLastInbound(2)
})

describe('alertStaffMinorNoGuardian — template-first, freeform only as a fallback', () => {
  it('sends via the approved template when one is configured, and never touches the freeform path on success', async () => {
    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(
      '+256394836298',
      'cc_staff_concern',
      expect.arrayContaining(['Okullo Amara'])
    )
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
    expect(store.notifications).toHaveLength(0) // WhatsApp succeeded, no fallback needed
  })

  it('falls back to freeform ONLY when the template send itself throws (and the window is open)', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('#132001 Template not approved'))

    await alertStaffMinorNoGuardian('Jireh Asiel', 'appointment reminder')

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      '+256394836298',
      expect.stringContaining('Jireh Asiel is a minor with no guardian contact on file')
    )
  })

  it('goes straight to freeform when no template is configured at all (window open)', async () => {
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME

    await alertStaffMinorNoGuardian('Zuri Kwezi Mugisha', 'reactivation reminder')

    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('uses the configured staff escalation destination, never a hardcoded fallback, when the env var is set', async () => {
    process.env.STAFF_WHATSAPP_NUMBER = '+256700111222'
    setStaffLastInbound(null) // this test only asserts the template call args -- keep window irrelevant by using the template path
    await alertStaffMinorNoGuardian('Esther Atim', 'reactivation reminder')
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith('+256700111222', expect.any(String), expect.any(Array))
  })

  it('never throws out of the caller even if template, freeform, and the in-app fallback all fail', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('template down'))
    sendWhatsAppMessageMock.mockRejectedValueOnce(new Error('freeform also down'))

    await expect(alertStaffMinorNoGuardian('Abubakra Zoya', 'reactivation reminder')).resolves.toBeUndefined()
  })

  // Regression: the approved cc_staff_concern template's real Meta-approved
  // body text is "Name: {{1}} / Phone: {{2}} / Message: {{3}}" -- {{2}} MUST
  // be a real phone number, never a description string, or the delivered
  // WhatsApp message literally reads "Phone: minor — no guardian phone on
  // file" to staff. Confirmed via a live read-only Graph API template fetch
  // during the 2026-09-16 investigation.
  it('maps the patient phone number to the template Phone field ({{2}}), never a description string', async () => {
    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder', '+256700123456')

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith(
      '+256394836298',
      'cc_staff_concern',
      ['Okullo Amara', '+256700123456', expect.any(String)]
    )
  })

  it('uses an honest "N/A" placeholder for the Phone field when no phone was passed, never a mislabelled description', async () => {
    await alertStaffMinorNoGuardian('Jireh Asiel', 'reactivation reminder')

    const [, , params] = sendWhatsAppTemplateMock.mock.calls[0]
    expect(params[1]).toBe('N/A')
  })
})

describe('alertStaffMinorNoGuardian — fail-closed 24h session window gating (the #131047 fix)', () => {
  it('outside the window with no template configured, does NOT attempt a freeform send', async () => {
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    setStaffLastInbound(48)

    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')

    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('outside the window, a template failure does NOT fall back to freeform either (would just produce another #131047)', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('template down'))
    setStaffLastInbound(48)

    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')

    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('creates an in-app notification + push fallback for RECEPTIONIST/ADMIN when WhatsApp never sends (blocked by the window)', async () => {
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    setStaffLastInbound(48)

    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')

    expect(store.notifications).toHaveLength(2)
    const recipientIds = store.notifications.map(n => n.userId).sort()
    expect(recipientIds).toEqual(['admin_1', 'reception_1'])
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT create an in-app fallback when the template send succeeds despite being outside the window', async () => {
    setStaffLastInbound(48) // template bypasses the window check entirely -- it's Meta-approved for exactly this case
    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')
    expect(store.notifications).toHaveLength(0)
  })

  it('the in-app fallback body never gets less detail than the WhatsApp message would have -- staff can still act from the notification centre alone', async () => {
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME
    setStaffLastInbound(48)

    await alertStaffMinorNoGuardian('Okullo Amara', 'reactivation reminder')

    expect(store.notifications[0].body).toContain('Okullo Amara')
    expect(store.notifications[0].body).toContain('guardian contact on file')
  })
})
