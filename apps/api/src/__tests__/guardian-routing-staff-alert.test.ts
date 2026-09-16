import { describe, expect, it, vi, beforeEach } from 'vitest'

// Regression coverage for the 2026-09-16 investigation: alertStaffMinorNoGuardian
// was sending a plain free-form WhatsApp message to the staff number on every
// call, with no template attempt at all -- the single highest-volume source
// of real Meta #131047 (24h re-engagement window) failures to that number,
// because this alert intentionally fires every time a scheduled job hits the
// same still-unfixed patient. It must now try the approved staff-alert
// template first (which bypasses the 24h window entirely) and only fall back
// to freeform if the template send itself fails.

const { sendWhatsAppMessageMock, sendWhatsAppTemplateMock } = vi.hoisted(() => ({
  sendWhatsAppMessageMock:  vi.fn().mockResolvedValue('wamid.freeform'),
  sendWhatsAppTemplateMock: vi.fn().mockResolvedValue('wamid.template'),
}))

vi.mock('../ai-suite/whatsapp/whatsapp.service', () => ({
  sendWhatsAppMessage:  sendWhatsAppMessageMock,
  sendWhatsAppTemplate: sendWhatsAppTemplateMock,
}))

import { alertStaffMinorNoGuardian } from '../ai-suite/scheduler/guardian-routing.service'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, STAFF_WHATSAPP_NUMBER: '+256394836298', WA_TEMPLATE_STAFF_ALERT_NAME: 'cc_staff_concern' }
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
  })

  it('falls back to freeform ONLY when the template send itself throws', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('#132001 Template not approved'))

    await alertStaffMinorNoGuardian('Jireh Asiel', 'appointment reminder')

    expect(sendWhatsAppTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      '+256394836298',
      expect.stringContaining('Jireh Asiel is a minor with no guardian contact on file')
    )
  })

  it('goes straight to freeform when no template is configured at all', async () => {
    delete process.env.WA_TEMPLATE_STAFF_ALERT_NAME

    await alertStaffMinorNoGuardian('Zuri Kwezi Mugisha', 'reactivation reminder')

    expect(sendWhatsAppTemplateMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('uses the configured staff escalation destination, never a hardcoded fallback, when the env var is set', async () => {
    process.env.STAFF_WHATSAPP_NUMBER = '+256700111222'
    await alertStaffMinorNoGuardian('Esther Atim', 'reactivation reminder')
    expect(sendWhatsAppTemplateMock).toHaveBeenCalledWith('+256700111222', expect.any(String), expect.any(Array))
  })

  it('never throws out of the caller even if both template and freeform sends fail', async () => {
    sendWhatsAppTemplateMock.mockRejectedValueOnce(new Error('template down'))
    sendWhatsAppMessageMock.mockRejectedValueOnce(new Error('freeform also down'))

    await expect(alertStaffMinorNoGuardian('Abubakra Zoya', 'reactivation reminder')).resolves.toBeUndefined()
  })
})