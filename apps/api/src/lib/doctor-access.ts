import type { PrismaClient } from '@prisma/client'
import type { AuthUser } from '../middleware/auth'
import type { NextFunction, Request, Response } from 'express'

export async function authenticatedDoctorId(prisma: PrismaClient, user: AuthUser): Promise<string | null> {
  if (user.role !== 'DOCTOR') return null
  if (user.doctorId) return user.doctorId
  const doctor = await prisma.doctor.findUnique({ where: { userId: user.id }, select: { id: true } })
  return doctor?.id ?? null
}

export async function doctorHasPatient(prisma: PrismaClient, doctorId: string, patientId: string): Promise<boolean> {
  const appointment = await prisma.appointment.findFirst({ where: { doctorId, patientId }, select: { id: true } })
  return Boolean(appointment)
}

export async function patientVisibleToUser(prisma: PrismaClient, user: AuthUser, patientId: string): Promise<boolean> {
  if (user.role !== 'DOCTOR') return true
  const doctorId = await authenticatedDoctorId(prisma, user)
  return doctorId ? doctorHasPatient(prisma, doctorId, patientId) : false
}

export async function appointmentVisibleToUser(prisma: PrismaClient, user: AuthUser, appointmentId: string): Promise<boolean> {
  if (user.role !== 'DOCTOR') return true
  const doctorId = await authenticatedDoctorId(prisma, user)
  if (!doctorId) return false
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, doctorId }, select: { id: true } })
  return Boolean(appointment)
}

export function requireDoctorPatientAccess(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction, patientId: string) => {
    if (!req.user || req.user.role !== 'DOCTOR') return next()
    try {
      if (await patientVisibleToUser(prisma, req.user, patientId)) return next()
      res.status(404).json({ error: 'Patient not found' })
    } catch (error) { next(error) }
  }
}
