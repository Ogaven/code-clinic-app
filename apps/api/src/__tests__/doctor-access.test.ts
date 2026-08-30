import { describe, expect, it, vi } from 'vitest'
import { appointmentVisibleToUser, authenticatedDoctorId, doctorHasPatient } from '../lib/doctor-access'

const doctorUser = { id: 'user-a', email: 'a@example.test', role: 'DOCTOR', firstName: 'A', lastName: 'Doctor' }

describe('Doctor authorization helpers', () => {
  it('derives Doctor identity from the authenticated user when the token has no doctorId', async () => {
    const prisma = { doctor: { findUnique: vi.fn().mockResolvedValue({ id: 'doctor-a' }) } } as any
    await expect(authenticatedDoctorId(prisma, doctorUser)).resolves.toBe('doctor-a')
    expect(prisma.doctor.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-a' }, select: { id: true } })
  })

  it('fails closed when a Doctor has no Doctor record', async () => {
    const prisma = { doctor: { findUnique: vi.fn().mockResolvedValue(null) } } as any
    await expect(authenticatedDoctorId(prisma, doctorUser)).resolves.toBeNull()
  })

  it('requires an appointment relationship for Doctor-patient access', async () => {
    const prisma = { appointment: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'appt' }).mockResolvedValueOnce(null) } } as any
    await expect(doctorHasPatient(prisma, 'doctor-a', 'patient-a')).resolves.toBe(true)
    await expect(doctorHasPatient(prisma, 'doctor-a', 'patient-b')).resolves.toBe(false)
  })

  it('cannot expose another Doctor appointment', async () => {
    const prisma = { appointment: { findFirst: vi.fn().mockResolvedValue(null) } } as any
    await expect(appointmentVisibleToUser(prisma, { ...doctorUser, doctorId: 'doctor-a' }, 'doctor-b-appt')).resolves.toBe(false)
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({ where: { id: 'doctor-b-appt', doctorId: 'doctor-a' }, select: { id: true } })
  })
})
