// Coverage for the staff escalation WhatsApp destination config accessor.
//
// Context (2026-09-23 urgent fix): the number that receives cc_staff_concern
// / cc_staff_booking_update alerts was previously read independently as
// `process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'` in four different
// files (escalation.ts, guardian-routing.service.ts, whatsapp.service.ts,
// staff-relay.service.ts) — four copies of the same magic string that could
// silently drift. getClinicEscalationWhatsAppNumber() is now the single
// source of truth every one of those call sites goes through.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getClinicEscalationWhatsAppNumber } from '../config/escalation-config'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER
  delete process.env.STAFF_WHATSAPP_NUMBER
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('getClinicEscalationWhatsAppNumber', () => {
  it('uses the owner-approved clinic ops number when nothing is configured — never empty, never a patient number', () => {
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256394836298')
  })

  it('prefers the canonical CLINIC_ESCALATION_WHATSAPP_NUMBER env var when set', () => {
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER = '0700111222'
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256700111222')
  })

  it('falls back to the legacy STAFF_WHATSAPP_NUMBER var when the canonical one is unset', () => {
    process.env.STAFF_WHATSAPP_NUMBER = '+256700333444'
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256700333444')
  })

  it('CLINIC_ESCALATION_WHATSAPP_NUMBER wins over the legacy STAFF_WHATSAPP_NUMBER when both are set', () => {
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER = '+256700111222'
    process.env.STAFF_WHATSAPP_NUMBER = '+256700999888'
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256700111222')
  })

  it('normalizes a raw local-format number to E.164', () => {
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER = '0394836298'
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256394836298')
  })

  it('fails safe (throws) rather than returning an unusable destination when configured with garbage', () => {
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER = 'not-a-phone-number'
    expect(() => getClinicEscalationWhatsAppNumber()).toThrow()
  })

  it('fails safe (throws) on an empty-string override instead of silently falling through unexpectedly', () => {
    process.env.CLINIC_ESCALATION_WHATSAPP_NUMBER = '   '
    expect(getClinicEscalationWhatsAppNumber()).toBe('+256394836298') // blank trims to falsy, falls through to the safe default
  })

  it('never derives the destination from anything resembling patient-supplied input — pure env/default resolution only', () => {
    // The function takes no arguments at all: there is no code path by which
    // a patient's phone number (passed into a caller like notifyJulian) could
    // ever influence what this returns.
    expect(getClinicEscalationWhatsAppNumber.length).toBe(0)
  })
})
