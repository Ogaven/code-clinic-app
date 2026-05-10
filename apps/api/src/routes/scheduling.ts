import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { auditLog } from '../middleware/audit'
import { syncAppointmentToGCal } from '../services/gcal'
import { sendAppointmentNotification } from '../ai-suite/notifications/notification.service'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const STAFF_NUMBER = process.env.STAFF_WHATSAPP_NUMBER || '+256394836298'

async function notifyStaff(
  prismaClient: PrismaClient,
  type: 'booked' | 'rescheduled' | 'cancelled',
  appt: { id: string; patient: { firstName: string; lastName: string }; service: { name: string }; doctor: { user: { firstName: string; lastName: string } }; startAt: Date },
) {
  const p    = appt.patient
  const doc  = `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`
  const svc  = appt.service.name
  const date = appt.startAt.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
  const time = appt.startAt.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi' })
  const name = `${p.firstName} ${p.lastName}`

  let waMsg = '', notifTitle = '', notifBody = ''
  if (type === 'booked') {
    waMsg       = `📋 New booking: ${name} — ${svc} on ${date} at ${time} with ${doc}`
    notifTitle  = 'New Appointment Booked'
    notifBody   = `${name} — ${svc} on ${date} at ${time} with ${doc}`
  } else if (type === 'rescheduled') {
    waMsg       = `🔄 Rescheduled: ${name} — new time ${date} at ${time}`
    notifTitle  = 'Appointment Rescheduled'
    notifBody   = `${name} rescheduled to ${date} at ${time} with ${doc}`
  } else {
    waMsg       = `❌ Cancelled: ${name} — ${svc} on ${date}`
    notifTitle  = 'Appointment Cancelled'
    notifBody   = `${name}'s ${svc} on ${date} was cancelled`
  }

  // In-app notifications to all receptionists and admins
  try {
    const staff = await prismaClient.user.findMany({ where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true } })
    await Promise.all(staff.map(u => prismaClient.notification.create({
      data: { userId: u.id, type: 'APPOINTMENT', title: notifTitle, body: notifBody, href: '/receptionist/appointments' },
    })))
  } catch (e: any) { console.warn('[Staff notif] in-app failed:', e.message) }

  // WhatsApp to clinic main number
  sendWhatsAppMessage(STAFF_NUMBER, waMsg).catch(() => {})
}

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
  // Doctors see only their own appointments
  if (req.user!.role === 'DOCTOR' && req.user!.doctorId) {
    where.doctorId = req.user!.doctorId
  } else if (doctorId) {
    where.doctorId = doctorId
  }
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
      const dateStr = start.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
      const timeStr = start.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
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

  // WhatsApp booking confirmation to patient (fire-and-forget)
  sendAppointmentNotification(appointment.id, 'booked').catch(() => {})

  // Staff notifications (fire-and-forget)
  notifyStaff(prisma, 'booked', appointment).catch(() => {})

  res.status(201).json({ ...appointment, service: { ...appointment.service, priceUGX: Number(appointment.service.priceUGX) } })
})

// ─── Reschedule / update appointment ─────────────────────────────────────────
const rescheduleSchema = z.object({
  startAt:     z.string().datetime().optional(),
  scheduledAt: z.string().datetime().optional(),
  doctorId:    z.string().uuid().optional(),
  serviceId:   z.string().uuid().optional(),
  notes:       z.string().optional(),
  status:      z.string().optional(),
})

const PATCH_VALID_STATUSES = [
  'PENDING', 'CONFIRMED',
  'ARRIVED', 'WAITING', 'IN_OPERATORY', 'WITH_PROVIDER', 'SESSION_COMPLETE', 'CHECKOUT', 'DEPARTED',
  'CHECKED_IN', 'IN_CHAIR', 'READY_CHECKOUT', 'COMPLETED',
  'CANCELLED', 'NO_SHOW', 'RESCHEDULED',
]

router.patch('/appointments/:id', requireAuth, clinicalStaff, validate(rescheduleSchema), auditLog('appointments'), async (req, res) => {
  const existing = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { service: true } })
  if (!existing) { res.status(404).json({ error: 'Appointment not found' }); return }

  if (req.body.status && !PATCH_VALID_STATUSES.includes(req.body.status)) {
    res.status(400).json({ error: 'Invalid status' }); return
  }

  const serviceId = req.body.serviceId || existing.serviceId
  const doctorId  = req.body.doctorId  || existing.doctorId

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) { res.status(404).json({ error: 'Service not found' }); return }

  const rawStart = req.body.startAt || req.body.scheduledAt
  let start = existing.startAt
  let end   = existing.endAt
  if (rawStart) {
    start = new Date(rawStart)
    end   = new Date(start.getTime() + service.durationMins * 60_000)

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
      ...(req.body.status ? { status: req.body.status } : {}),
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: true,
    },
  })

  // Auto-sync to Google Calendar (fire-and-forget)
  syncAppointmentToGCal(updated).catch(() => {})

  // WhatsApp patient notification + staff notification (fire-and-forget)
  if (req.body.status === 'CANCELLED') {
    sendAppointmentNotification(updated.id, 'cancelled').catch(() => {})
    notifyStaff(prisma, 'cancelled', updated).catch(() => {})
  } else if (rawStart) {
    sendAppointmentNotification(updated.id, 'rescheduled').catch(() => {})
    notifyStaff(prisma, 'rescheduled', updated).catch(() => {})
  }

  res.json({ ...updated, service: { ...updated.service, priceUGX: Number(updated.service.priceUGX) } })
})

// ─── Status change ────────────────────────────────────────────────────────────
router.patch('/appointments/:id/status', requireAuth, auditLog('appointments'), async (req, res) => {
  // New clinical flow stages + legacy statuses for backward compat
  const validStatuses = [
    'PENDING', 'CONFIRMED',
    'ARRIVED', 'WAITING', 'IN_OPERATORY', 'WITH_PROVIDER', 'SESSION_COMPLETE', 'CHECKOUT', 'DEPARTED',
    // Legacy (kept for backward compat)
    'CHECKED_IN', 'IN_CHAIR', 'READY_CHECKOUT', 'COMPLETED',
    'CANCELLED', 'NO_SHOW',
  ]
  console.log('[CHECKIN]', { id: req.params.id, status: req.body.status, role: (req as any).user?.role })
  const { status } = req.body
  if (!validStatuses.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return }

  // Record stage timestamps as patient progresses through the flow
  const now = new Date()
  const timestampData: Record<string, Date> = {}
  if (status === 'ARRIVED' || status === 'CHECKED_IN') timestampData.arrivedAt = now
  if (status === 'WITH_PROVIDER' || status === 'IN_CHAIR') timestampData.withProviderAt = now
  if (status === 'DEPARTED' || status === 'COMPLETED' || status === 'SESSION_COMPLETE') timestampData.departedAt = now

  let appointment: any
  try {
    appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status, ...timestampData },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        doctor:  { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        service: true,
      },
    })
  } catch (e: any) {
    console.error('[CHECKIN ERROR]', JSON.stringify({ message: e?.message, code: e?.code, meta: e?.meta, stack: e?.stack?.split('\n').slice(0, 5) }))
    if (e?.code === 'P2025') { res.status(404).json({ error: 'Appointment not found' }); return }
    res.status(500).json({ error: 'Failed to update appointment status' }); return
  }

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

  // Auto-sync status / color change to Google Calendar (fire-and-forget)
  syncAppointmentToGCal(appointment).catch(() => {})

  res.json({ ...appointment, service: { ...appointment.service, priceUGX: Number(appointment.service.priceUGX) } })
})

// ─── Check-in WhatsApp notification ──────────────────────────────────────────
router.post('/appointments/:id/checkin-notify', requireAuth, async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: {
        patient: { select: { firstName: true, phone: true } },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    })
    if (!appt) { res.status(404).json({ error: 'Not found' }); return }
    const msg = `Hi ${appt.patient.firstName}! You've been checked in at Code Clinic. Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName} will be with you shortly 😊`
    sendWhatsAppMessage(appt.patient.phone, msg).catch(() => {})
    res.json({ sent: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
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

  if (req.user!.role !== 'ADMIN' && req.user!.role !== 'RECEPTIONIST' && doctor.userId !== req.user!.id) {
    res.status(403).json({ error: 'Not authorized to block this time' }); return
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

// ─── Working Hours ─────────────────────────────────────────────────────────────
const DEFAULT_WORKING_HOURS = [
  { dayOfWeek: 0, isOpen: false, openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 1, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 2, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 3, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 4, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 5, isOpen: true,  openTime: '07:00', closeTime: '18:00', breaks: [] },
  { dayOfWeek: 6, isOpen: true,  openTime: '07:00', closeTime: '14:00', breaks: [] },
]

router.get('/working-hours', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.workingHours.findMany({ orderBy: { dayOfWeek: 'asc' } })
    if (rows.length === 0) { res.json(DEFAULT_WORKING_HOURS); return }
    res.json(rows)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.put('/working-hours', requireAuth, async (req, res) => {
  try {
    const days: Array<{ dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; breaks: any[] }> = req.body
    const results = await Promise.all(days.map(d =>
      prisma.workingHours.upsert({
        where:  { dayOfWeek: d.dayOfWeek },
        create: { dayOfWeek: d.dayOfWeek, isOpen: d.isOpen, openTime: d.openTime, closeTime: d.closeTime, breaks: d.breaks },
        update: { isOpen: d.isOpen, openTime: d.openTime, closeTime: d.closeTime, breaks: d.breaks },
      })
    ))
    res.json(results)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── Doctor Schedule ───────────────────────────────────────────────────────────
router.get('/doctor-schedule/:doctorId', requireAuth, async (req, res) => {
  try {
    const rows = await prisma.doctorSchedule.findMany({
      where:   { doctorId: req.params.doctorId },
      orderBy: { dayOfWeek: 'asc' },
    })
    res.json(rows)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.put('/doctor-schedule/:doctorId', requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.params
    const days: Array<{ dayOfWeek: number; isOpen: boolean; openTime?: string; closeTime?: string; breaks?: any[]; slots?: string[] }> = req.body
    if (!days || days.length === 0) {
      await prisma.doctorSchedule.deleteMany({ where: { doctorId } })
      res.json([]); return
    }
    const results = await Promise.all(days.map(d =>
      prisma.doctorSchedule.upsert({
        where:  { doctorId_dayOfWeek: { doctorId, dayOfWeek: d.dayOfWeek } },
        create: { doctorId, dayOfWeek: d.dayOfWeek, isOpen: d.isOpen, openTime: d.openTime, closeTime: d.closeTime, breaks: d.breaks ?? undefined, slots: d.slots ?? undefined },
        update: { isOpen: d.isOpen, openTime: d.openTime, closeTime: d.closeTime, breaks: d.breaks ?? undefined, slots: d.slots ?? undefined },
      })
    ))
    res.json(results)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.delete('/doctor-schedule/:doctorId', requireAuth, async (req, res) => {
  try {
    await prisma.doctorSchedule.deleteMany({ where: { doctorId: req.params.doctorId } })
    res.json({ cleared: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── Special Days ──────────────────────────────────────────────────────────────
router.get('/special-days', requireAuth, async (req, res) => {
  try {
    const year  = parseInt((req.query.year as string) || String(new Date().getFullYear()))
    const start = new Date(`${year}-01-01T00:00:00.000Z`)
    const end   = new Date(`${year}-12-31T23:59:59.999Z`)
    const days  = await prisma.specialDay.findMany({
      where:   { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    })
    res.json(days)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/special-days', requireAuth, async (req, res) => {
  try {
    const { date, type, openTime, closeTime, note } = req.body
    const d = await prisma.specialDay.upsert({
      where:  { date: new Date(date) },
      create: { date: new Date(date), type, openTime: openTime || null, closeTime: closeTime || null, note: note || null },
      update: { type, openTime: openTime || null, closeTime: closeTime || null, note: note || null },
    })
    res.status(201).json(d)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.delete('/special-days/:id', requireAuth, async (req, res) => {
  try {
    await prisma.specialDay.delete({ where: { id: req.params.id } })
    res.json({ deleted: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ─── Import Appointments ───────────────────────────────────────────────────────
router.post('/import-appointments', requireAuth, clinicalStaff, upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

  try {
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { raw: false, defval: '' })

    let imported = 0, skipped = 0
    const errors: string[] = []

    // Cache doctors once
    const allDoctors = await prisma.doctor.findMany({
      where:   { isActive: true },
      include: { user: { select: { firstName: true, lastName: true } } },
    })

    for (const row of rows) {
      try {
        const patientName = String(row.patient_name ?? row['Patient Name'] ?? '').trim()
        const phone       = String(row.phone        ?? row['Phone']        ?? '').trim()
        const dateStr     = String(row.date         ?? row['Date']         ?? row['date (YYYY-MM-DD)'] ?? '').trim()
        const timeStr     = String(row.time         ?? row['Time']         ?? row['time (HH:MM)']      ?? '').trim()
        const doctorName  = String(row.doctor       ?? row['Doctor']       ?? '').trim()
        const serviceName = String(row.service      ?? row['Service']      ?? '').trim()
        const notesTxt    = String(row.notes        ?? row['Notes']        ?? '').trim()
        const emailTxt    = String(row.email        ?? row['Email']        ?? '').trim()

        if (!patientName || !phone || !dateStr || !timeStr) {
          skipped++; errors.push(`Row skipped: missing name, phone, date or time`); continue
        }

        // Find/create patient
        let patient = await prisma.patient.findFirst({ where: { phone } })
        if (!patient) {
          const parts = patientName.split(' ')
          patient = await prisma.patient.create({
            data: { firstName: parts[0] || patientName, lastName: parts.slice(1).join(' ') || '.', phone, email: emailTxt || undefined },
          })
        }

        // Find service
        const service = serviceName
          ? await prisma.service.findFirst({ where: { name: { contains: serviceName, mode: 'insensitive' }, isActive: true } })
          : await prisma.service.findFirst({ where: { isActive: true } })
        if (!service) { skipped++; errors.push(`Row skipped: service "${serviceName}" not found`); continue }

        // Find doctor
        const doctor = doctorName
          ? allDoctors.find(d => `${d.user.firstName} ${d.user.lastName}`.toLowerCase().includes(doctorName.toLowerCase()))
          : allDoctors[0]
        if (!doctor) { skipped++; errors.push(`Row skipped: doctor "${doctorName}" not found`); continue }

        // Parse datetime (EAT = UTC+3)
        const startAt = new Date(`${dateStr}T${timeStr.length === 5 ? timeStr : timeStr.slice(0, 5)}:00+03:00`)
        if (isNaN(startAt.getTime())) { skipped++; errors.push(`Row skipped: invalid date/time "${dateStr} ${timeStr}"`); continue }
        const endAt = new Date(startAt.getTime() + service.durationMins * 60_000)

        // Duplicate check
        const dup = await prisma.appointment.findFirst({
          where: { doctorId: doctor.id, startAt, status: { not: 'CANCELLED' } },
        })
        if (dup) { skipped++; continue }

        await prisma.appointment.create({
          data: { patientId: patient.id, doctorId: doctor.id, serviceId: service.id, startAt, endAt, notes: notesTxt || undefined, createdById: req.user!.id },
        })
        imported++
      } catch (rowErr: any) {
        skipped++; errors.push(`Row error: ${rowErr.message}`)
      }
    }

    res.json({ imported, skipped, errors: errors.slice(0, 20) })
  } catch (e: any) {
    res.status(500).json({ error: `Failed to parse file: ${e.message}` })
  }
})

export default router
