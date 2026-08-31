import { describe, expect, it, vi } from 'vitest'
import { createPatientWithBotConsent } from '../services/patient-consent.service'

function transactionMock() {
  return {
    patient: { create: vi.fn().mockResolvedValue({ id: 'patient-1' }) },
    patientConsent: { create: vi.fn().mockResolvedValue({ id: 'consent-1' }) },
  }
}

describe('createPatientWithBotConsent', () => {
  it.each([true, false])('persists consentBotComms=%s without coercion', async (granted) => {
    const tx = transactionMock()
    await createPatientWithBotConsent(tx as never, { firstName: 'Test', lastName: 'Patient', phone: '+256700000000' }, granted)
    expect(tx.patientConsent.create).toHaveBeenCalledWith({
      data: { patientId: 'patient-1', consentType: 'BOT_COMMUNICATION', granted },
    })
  })
})
