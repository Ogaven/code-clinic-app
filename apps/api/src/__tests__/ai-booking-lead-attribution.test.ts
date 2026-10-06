import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, linkOnBooking } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findFirst: vi.fn() },
    service: { findUnique: vi.fn() },
    appointment: { findFirst: vi.fn(), create: vi.fn() },
  },
  linkOnBooking: vi.fn(),
}))

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../../crm-automation/lead-patient-link.service', () => ({ checkAndConvertLeadOnBooking: linkOnBooking }))
vi.mock('../../services/agent/guards/escalation', () => ({ createEscalation: vi.fn() }))

import { createAppointment } from '../../ai-suite/booking/booking.service'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient-1', phone: '+256700000000' })
  prismaMock.service.findUnique.mockResolvedValue({ id: 'service-1', durationMins: 30 })
  prismaMock.appointment.findFirst.mockResolvedValue(null)
  prismaMock.appointment.create.mockResolvedValue({
    id: 'appointment-1',
    patientId: 'patient-1',
    patient: { id: 'patient-1', phone: '+256700000000' },
    doctor: { user: { firstName: 'Steven', lastName: 'Mugabe' } },
    service: { name: 'Consultation' },
  })
  linkOnBooking.mockResolvedValue(undefined)
})

describe('AI booking CRM attribution', () => {
  it('runs the canonical lead-to-patient linker after Sarah creates an appointment', async () => {
    await createAppointment('patient-1', 'doctor-1', 'service-1', new Date(Date.now() + 72 * 60 * 60 * 1000), '+256700000000')

    expect(prismaMock.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ patient: { select: { id: true, phone: true } } }),
    }))
    expect(linkOnBooking).toHaveBeenCalledWith({ id: 'patient-1', phone: '+256700000000' })
  })

  it('does not fail the booking if CRM attribution fails after the appointment is safely created', async () => {
    linkOnBooking.mockRejectedValue(new Error('crm unavailable'))

    await expect(createAppointment('patient-1', 'doctor-1', 'service-1', new Date(Date.now() + 72 * 60 * 60 * 1000), '+256700000000'))
      .resolves.toEqual(expect.objectContaining({ id: 'appointment-1' }))
  })
})
