import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { auditLog } from '../middleware/audit'
import { syncAppointmentToGCal } from '../services/gcal'

const router = Router()
const prisma = new PrismaClient()

// ─── Calendar (day) ─────────────────────────────────────────────────────────
// GET /scheduling/calendar?date=YYYY-MM-DD
router.get('/calendar', requireAuth, async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10)
  const date    = new Date(dateStr + 'T00:00:00+03:00')
  const nextDay = new Date(dateStr + 'T23:59:59+03:00')

  const [appointments, blockedTimes, doctors] = await Promise.all([
    prisma.appointment.findMany({
      where: { startAt: { gte: date, lte: nextDay }, status: { not: 'CANCELLED' } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true, avatarR2Key: true } },
        doctor:  { include: { user: { select: { id: true, firstName: true, lastName: true, avatarR2Key: true } } } },
        service: { select: { id: true, name: true, colour: true, durationMins: true, priceUGX: true } },
      },
      orderBy: { startAt: 'asc' },
    }),
    prisma.blockedTime.findMany({
      where: { startAt: { gte: date, lte: nextDay } },
      include: { doctor: { include: { user: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.doctor.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarR2Key: true } } },
      orderBy: { user: { firstName: 'asc' } },
    }),
  ])

  const calendar = doctors.map((doctor) => ({
    doctor: {
      id: doctor.id, userId: doctor.userId,
      firstName: doctor.user.firstName, lastName: doctor.user.lastName,
      colour: doctor.colour, specialisation: doctor.specialisation,
      workingHours: doctor.workingHours,
    },
    appointments: appointments
      .filter((a) => a.doctorId === doctor.id)
      .map((a) => ({ ...a, service: { ...a.service, priceUGX: Number(a.service.priceUGX) } })),
    blockedTimes: blockedTimes.filter((b) => b.doctorId === doctor.id),
  }))

  res.json({ date: dateStr, calendar })
})

// ─── Appointments list (range) ────────────────────────────────────────────────
// GET /scheduling/appointments?startDate=&endDate=&doctorId=&status=&patientId=
router.get('/appointments', requireAuth, async (req, res) => {
  const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10)
  const endDate   = (req.query.endDate as string)   || startDate
  const doctorId  = req.query.doctorId  as string | undefined
  const status    = req.query.status    as string | undefined
  const patientId = req.query.patientId as string | undefined

  const start = new Date(startDate + 'T00:00:00+03:00')
  const end   = new Date(endDate   + 'T23:59:59+03:00')

  const where: any = { startAt: { gte: start, lte: end } }
  if (doctorId)  where.doctorId  = doctorId
  if (status)    where.status    = status
  if (patientId) where.patientId = patientId

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      service: { select: { id: true, name: true, colour: true, durationMins: true, priceUGX: true } },
    },
    orderBy: { startAt: 'asc' },
  })

  res.json(appointments.map((a) => ({
    ...a,
    service: { ...a.service, priceUGX: Number(a.service.priceUGX) },
  })))
})

// ─── Single appointment ───────────────────────────────────────────────────────
router.get('/appointments/:id', requireAuth, async (req, res) => {
  const appt = await prisma.appointment.findUnique({
    where: { id: req.params.id },
    include: {
      patient: true,
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: true,
    },
  })
  if (!appt) { res.status(404).json({ error: 'Appointment not found' }); return }
  res.json({ ...appt, service: { ...appt.service, priceUGX: Number(appt.service.priceUGX) } })
})

// ─── Create appointment ───────────────────────────────────────────────────────
const createApptSchema = z.object({
  patientId: z.string().uuid(),
  doctorId:  z.string().uuid(),
  serviceId: z.string().uuid(),
  startAt:   z.string().datetime(),
  notes:     z.string().optional(),
})

router.post('/appointments', requireAuth, clinicalStaff, validate(createApptSchema), auditLog('appointments'), async (req, res) => {
  const { patientId, doctorId, serviceId, startAt, notes } = req.body

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) { res.status(404).json({ error: 'Service not found' }); return }

  const start = new Date(startAt)
  const end   = new Date(start.getTime() + service.durationMins * 60_000)

  const conflict = await prisma.appointment.findFirst({
    where: { doctorId, status: { notIn: ['CANCELLED'] }, startAt: { lt: end }, endAt: { gt: start } },
  })
  if (conflict) { res.status(409).json({ error: 'This time slot is already booked for this doctor' }); return }

  const blocked = await prisma.blockedTime.findFirst({
    where: { doctorId, startAt: { lt: end }, endAt: { gt: start } },
  })
  if (blocked) { res.status(409).json({ error: 'Doctor is unavailable during this time', reason: blocked.reason }); return }

  const appointment = await prisma.appointment.create({
    data: { patientId, doctorId, serviceId, startAt: start, endAt: end, notes, createdById: req.user!.id },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      service: true,
    },
  })

  // SMS confirmation to patient
  try {
    const atApiKey   = process.env.AT_API_KEY
    const atUsername = process.env.AT_USERNAME
    if (atApiKey && atUsername && atApiKey !== 'your-key') {
      const p = appointment.patient
      const d = appointment.doctor.user
      const dateStr = start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' })
      const timeStr = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })
      const smsText = `Hi ${p.firstName}, your appt at Code Clinic is confirmed: ${dateStr} at ${timeStr} with Dr. ${d.firstName} ${d.lastName}. Location: Kiira Rd, Kamwokya. Call: 0205477000`
      const AfricasTalking = require('africastalking')
      const at = AfricasTalking({ apiKey: atApiKey, username: atUsername })
      await at.SMS.send({ to: [p.phone], message: smsText, from: process.env.AT_SENDER_ID || 'CodeClinic' })
    }
  } catch (smsErr: any) {
    console.warn('[SMS] Booking confirmation failed:', smsErr.message)
  }

  // Auto-sync to Google Calendar (fire-and-forget)
  syncAppointmentToGCal(appointment).catch(() => {})

  res.status(201).json({ ...appointment, service: { ...appointment.service, priceUGX: Number(appointment.service.priceUGX) } })
})

// ─── Reschedule / update appointment ─────────────────────────────────────────
const rescheduleSchema = z.object({
  startAt:   z.string().datetime().optional(),
  doctorId:  z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  notes:     z.string().optional(),
})

router.patch('/appointments/:id', requireAuth, clinicalStaff, validate(rescheduleSchema), auditLog('appointments'), async (req, res) => {
  const existing = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { service: true } })
  if (!existing) { res.status(404).json({ error: 'Appointment not found' }); return }

  const serviceId = req.body.serviceId || existing.serviceId
  const doctorId  = req.body.doctorId  || existing.doctorId

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) { res.status(404).json({ error: 'Service not found' }); return }

  let start = existing.startAt
  let end   = existing.endAt
  if (req.body.startAt) {
    start = new Date(req.body.startAt)
    end   = new Date(start.getTime() + service.durationMins * 60_000)

    // Conflict check (exclude self)
    const conflict = await prisma.appointment.findFirst({
      where: {
        id: { not: req.params.id },
        doctorId, status: { notIn: ['CANCELLED'] },
        startAt: { lt: end }, endAt: { gt: start },
      },
    })
    if (conflict) { res.status(409).json({ error: 'Time slot conflict — doctor already booked' }); return }
  }

  const updated = await prisma.appointment.update({
    where: { id: req.params.id },
    data: {
      startAt: start, endAt: end,
      doctorId, serviceId,
      notes: req.body.notes !== undefined ? req.body.notes : existing.notes,
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: true,
    },
  })

  res.json({ ...updated, service: { ...updated.service, priceUGX: Number(updated.service.priceUGX) } })
})

// ─── Status change ────────────────────────────────────────────────────────────
router.patch('/appointments/:id/status', requireAuth, clinicalStaff, auditLog('appointments'), async (req, res) => {
  // New clinical flow stages + legacy statuses for backward compat
  const validStatuses = [
    'PENDING', 'CONFIRMED',
    'ARRIVED', 'WAITING', 'IN_OPERATORY', 'WITH_PROVIDER', 'SESSION_COMPLETE', 'CHECKOUT', 'DEPARTED',
    // Legacy (kept for backward compat)
    'CHECKED_IN', 'IN_CHAIR', 'READY_CHECKOUT', 'COMPLETED',
    'CANCELLED', 'NO_SHOW',
  ]
  const { status } = req.body
  if (!validStatuses.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return }

  const appointment = await prisma.appointment.update({
    where: { id: req.params.id },
    data: { status },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      doctor:  { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      service: true,
    },
  })

  // ─── Log to PatientActivity ─────────────────────────────────────────────
  const statusLabels: Record<string, string> = {
    ARRIVED: 'Patient Arrived', WAITING: 'Moved to Waiting Room',
    IN_OPERATORY: 'Moved to Operatory', WITH_PROVIDER: 'With Provider',
    SESSION_COMPLETE: 'Session Complete', CHECKOUT: 'At Checkout',
    DEPARTED: 'Patient Departed',
    CONFIRMED: 'Appointment Confirmed', CHECKED_IN: 'Checked In',
    IN_CHAIR: 'In Chair', READY_CHECKOUT: 'Ready for Checkout',
    COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No Show',
  }
  const actorName = `${req.user!.role} ${req.user!.firstName || ''} ${req.user!.lastName || ''}`.trim()
  try {
    await prisma.patientActivity.create({
      data: {
        patientId: appointment.patient.id,
        userId: req.user!.id,
        userName: actorName,
        action: statusLabels[status] || status,
        metadata: JSON.stringify({ appointmentId: appointment.id, status }),
      },
    })
  } catch { /* non-critical */ }

  // ─── Status transition side-effects ───────────────────────────────────────
  try {
    // Notify doctor when patient arrives
    if (status === 'ARRIVED' || status === 'CHECKED_IN') {
      await prisma.notification.create({
        data: {
          userId: appointment.doctor.user.id,
          type: 'APPOINTMENT',
          title: 'Patient Arrived',
          body: `${appointment.patient.firstName} ${appointment.patient.lastName} has arrived and is ready for you.`,
          href: '/scheduling',
        },
      })
    }

    // Notify receptionists when session is complete / ready for checkout
    if (status === 'SESSION_COMPLETE' || status === 'CHECKOUT' || status === 'READY_CHECKOUT') {
      const receptionists = await prisma.user.findMany({ where: { role: 'RECEPTIONIST', isActive: true } })
      await Promise.all(receptionists.map((r) =>
        prisma.notification.create({
          data: {
            userId: r.id,
            type: 'APPOINTMENT',
            title: 'Patient Ready for Checkout',
            body: `${appointment.patient.firstName} ${appointment.patient.lastName} is ready for checkout.`,
            href: '/receptionist/appointments',
          },
        }),
      ))
    }

    // Create invoice when patient departs / session completes
    if (status === 'DEPARTED' || status === 'COMPLETED') {
      const existing = await prisma.invoice.findUnique({ where: { appointmentId: appointment.id } })
      if (!existing) {
        const count = await prisma.invoice.count()
        const invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`
        const priceUGX = Number(appointment.service.priceUGX) || 0
        await prisma.invoice.create({
          data: {
            invoiceNumber,
            patientId: appointment.patient.id,
            appointmentId: appointment.id,
            lineItems: JSON.stringify([{
              description: appointment.service.name,
              quantity: 1,
              unitPrice: priceUGX,
              total: priceUGX,
            }]),
            subtotalUGX: priceUGX,
            vatUGX: 0,
            totalUGX: priceUGX,
            status: 'UNPAID',
          },
        })
      }
    }
  } catch (e) {
    console.error('[STATUS SIDE-EFFECTS]', e)
  }

  res.json({ ...appointment, service: { ...appointment.service, priceUGX: Number(appointment.service.priceUGX) } })
})

// ─── Availability slots ───────────────────────────────────────────────────────
router.get('/doctors/:id/availability', requireAuth, async (req, res) => {
  const { id } = req.params
  const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10)

  const doctor = await prisma.doctor.findUnique({ where: { id } })
  if (!doctor) { res.status(404).json({ error: 'Doctor not found' }); return }

  const hours = JSON.parse(doctor.workingHours) as { start: string; end: string }
  const [startH, startM] = hours.start.split(':').map(Number)
  const [endH,   endM]   = hours.end.split(':').map(Number)

  const slots: string[] = []
  let h = startH, m = startM
  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    m += 30; if (m >= 60) { m -= 60; h++ }
  }

  const date    = new Date(dateStr + 'T00:00:00+03:00')
  const nextDay = new Date(dateStr + 'T23:59:59+03:00')

  const [appointments, blocked] = await Promise.all([
    prisma.appointment.findMany({ where: { doctorId: id, startAt: { gte: date, lte: nextDay }, status: { not: 'CANCELLED' } } }),
    prisma.blockedTime.findMany({ where: { doctorId: id, startAt: { gte: date, lte: nextDay } } }),
  ])

  const available = slots.filter((slot) => {
    const slotStart = new Date(`${dateStr}T${slot}:00+03:00`)
    const slotEnd   = new Date(slotStart.getTime() + 30 * 60_000)
    return !appointments.some((a) => a.startAt < slotEnd && a.endAt > slotStart)
        && !blocked.some((b) => b.startAt < slotEnd && b.endAt > slotStart)
  })

  res.json({ doctorId: id, date: dateStr, availableSlots: available })
})

// ─── Block time ───────────────────────────────────────────────────────────────
router.post('/doctors/:id/block-time', requireAuth, async (req, res) => {
  const { startAt, endAt, reason } = req.body

  const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id } })
  if (!doctor) { res.status(404).json({ error: 'Doctor not found' }); return }

  if (req.user!.role !== 'ADMIN' && doctor.userId !== req.user!.id) {
    res.status(403).json({ error: 'You can only block your own time' }); return
  }

  const block = await prisma.blockedTime.create({
    data: { doctorId: req.params.id, startAt: new Date(startAt), endAt: new Date(endAt), reason },
  })

  res.status(201).json(block)
})

router.delete('/doctors/:id/block-time/:blockId', requireAuth, async (req, res) => {
  await prisma.blockedTime.delete({ where: { id: req.params.blockId } })
  res.json({ message: 'Block removed' })
})

export default router
