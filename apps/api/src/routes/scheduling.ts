import { Router } from 'express'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { auditLog } from '../middleware/audit'
import { formatPatientId } from '../lib/utils'
import { syncAppointmentToGCal } from '../services/gcal'
import { sendAppointmentNotification } from '../ai-suite/notifications/notification.service'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'
import { prisma } from '../lib/prisma'

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

// ─── Calendar (day) ─────────────────────────────────────────────────────────
// GET /scheduling/calendar?date=YYYY-MM-DD
router.get('/calendar', requireAuth, async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10)
  const date    = new Date(dateStr + 'T00:00:00+03:00')
  const nextDay = new Date(dateStr + 'T23:59:59+03:00')

  const [appointments, blockedTimes, doctors] = await Promise.all([
    prisma.appointment.findMany({
      where: { startAt: { gte: date, lte: nextDay } },
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
// GET /scheduling/appointments?startDate=&endDate=&doctorId=&status=&patientId=&search=&page=&limit=
router.get('/appointments', requireAuth, async (req, res) => {
  const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10)
  const endDate   = (req.query.endDate as string)   || startDate
  const doctorId  = req.query.doctorId  as string | undefined
  const status    = req.query.status    as string | undefined
  const patientId = req.query.patientId as string | undefined
  const search    = (req.query.search   as string)?.trim() || undefined
  const page      = Math.max(1, parseInt((req.query.page  as string) || '1'))
  const limit     = Math.max(0, parseInt((req.query.limit as string) || '0'))

  const start = startDate.includes('T') ? new Date(startDate) : new Date(startDate + 'T00:00:00+03:00')
  const end   = endDate.includes('T')   ? new Date(endDate)   : new Date(endDate   + 'T23:59:59+03:00')

  const where: any = { startAt: { gte: start, lte: end } }
  // Doctors see only their own appointments
  if (req.user!.role === 'DOCTOR' && req.user!.doctorId) {
    where.doctorId = req.user!.doctorId
  } else if (doctorId) {
    where.doctorId = doctorId
  }
  if (status)    where.status    = status
  if (patientId) where.patientId = patientId
  if (search) {
    where.patient = {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search } },
      ],
    }
  }

  const includeSpec = {
    patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
    doctor:  { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
    service: { select: { id: true, name: true, colour: true, durationMins: true, priceUGX: true } },
  }
  const mapPrice = (a: any) => ({ ...a, service: { ...a.service, priceUGX: Number(a.service.priceUGX) } })

  if (limit > 0) {
    const [rows, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: includeSpec,
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ])
    res.json({ appointments: rows.map(mapPrice), total, page, limit })
  } else {
    const appointments = await prisma.appointment.findMany({ where, include: includeSpec, orderBy: { startAt: 'asc' } })
    res.json(appointments.map(mapPrice))
  }
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
  res.json({
    ...appt,
    patient: { ...appt.patient, patientId: formatPatientId(appt.patient.patientNumber) },
    service: { ...appt.service, priceUGX: Number(appt.service.priceUGX) },
  })
})

// ─── Create appointment ───────────────────────────────────────────────────────
const createApptSchema = z.object({
  patientId: z.string().uuid(),
  doctorId:  z.string().uuid(),
  serviceId: z.string().uuid(),
  startAt:   z.string().datetime(),
  endAt:     z.string().datetime().optional(),   // client-selected duration; use when provided
  notes:     z.string().optional(),
})

router.post('/appointments', requireAuth, clinicalStaff, validate(createApptSchema), auditLog('appointments'), async (req, res) => {
  const { patientId, doctorId, serviceId, startAt, endAt: endAtStr, notes } = req.body

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) { res.status(404).json({ error: 'Service not found' }); return }

  const start = new Date(startAt)
  // Use the client-supplied endAt (user's duration choice) when present;
  // fall back to the service default only when endAt is absent.
  const end = endAtStr
    ? new Date(endAtStr)
    : new Date(start.getTime() + service.durationMins * 60_000)

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
  endAt:       z.string().datetime().optional(),
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
    // Honour an explicit endAt (custom duration) when provided; otherwise fall back to service default
    end   = req.body.endAt
      ? new Date(req.body.endAt)
      : new Date(start.getTime() + service.durationMins * 60_000)

    const overlapSetting = await prisma.appSetting.findUnique({ where: { key: 'allow_overlapping_appointments' } })
    if (overlapSetting?.value !== 'true') {
      const conflict = await prisma.appointment.findFirst({
        where: {
          id: { not: req.params.id },
          doctorId, status: { notIn: ['CANCELLED'] },
          startAt: { lt: end }, endAt: { gt: start },
        },
      })
      if (conflict) { res.status(409).json({ error: 'Time slot conflict — doctor already booked' }); return }
    }
  } else if (req.body.endAt) {
    // Drag-to-resize: only endAt changed, enforce 10-minute minimum
    const newEnd = new Date(req.body.endAt)
    const minEnd = new Date(start.getTime() + 10 * 60_000)
    end = newEnd < minEnd ? minEnd : newEnd
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

interface ImportRowResult {
  rowNumber:       number
  status:          'success' | 'partial' | 'error'
  patientCreated?: boolean
  appointmentId?:  string
  error?:          string
  warning?:        string
  rawData:         Record<string, string>
}

// Parse date string in any supported format → YYYY-MM-DD, or null if unparseable.
// Formats: YYYY-MM-DD, DD-MM-YYYY, D-M-YYYY, DD/MM/YYYY, D/M/YYYY, MM/DD/YYYY
function parseDateStr(raw: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})([\/-])(\d{1,2})\2(\d{4})$/)
  if (!m) return null
  const [, a, sep, b, y] = m
  const na = parseInt(a), nb = parseInt(b)
  if (na > 12) return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`   // must be DD-?-MM
  if (nb > 12) return `${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`   // must be MM-?-DD
  // Ambiguous: use separator as hint — `-` → DD-MM (SimplyBook), `/` → MM/DD (US)
  if (sep === '/') return `${y}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`
  return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`
}

router.post('/import-appointments', requireAuth, clinicalStaff, upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

  try {
    // Strip UTF-8 BOM (EF BB BF) that Excel CSV exports prepend.
    let fileBuffer = req.file.buffer
    if (fileBuffer[0] === 0xEF && fileBuffer[1] === 0xBB && fileBuffer[2] === 0xBF) {
      fileBuffer = fileBuffer.slice(3)
    }
    // cellDates: false — keep all cell values as raw strings so DD-MM-YYYY dates
    // are not silently mangled by XLSX's date-serial auto-conversion.
    const wb = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0]]

    // Convert to array-of-arrays so we can handle a title row above the headers.
    const raw2d = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null })

    // Scan first 6 rows for SimplyBook-specific column names.
    const SB_MARKERS = ['Client name', 'Service provider', 'Is cancelled']
    let headerRowIdx = -1
    for (let i = 0; i < Math.min(raw2d.length, 6); i++) {
      const cells = raw2d[i].map((c: any) => String(c ?? '').trim())
      if (SB_MARKERS.some(m => cells.includes(m))) { headerRowIdx = i; break }
    }
    const isSimplyBook = headerRowIdx >= 0

    type NormRow = {
      patient_name: string; phone: string; email: string
      service: string; doctor: string; date: string
      time: string; notes: string; __cancelled: boolean
      __rawData: Record<string, string>
    }

    let rows: NormRow[]

    if (isSimplyBook) {
      const sbHeaders = raw2d[headerRowIdx].map((c: any) => String(c ?? '').trim())
      const get = (r: any[], h: string): string => {
        const idx = sbHeaders.indexOf(h)
        if (idx < 0) return ''
        const v = r[idx]
        return v === null || v === undefined ? '' : String(v).trim()
      }
      rows = raw2d
        .slice(headerRowIdx + 1)
        .filter(r => r && r.some((c: any) => c !== null && c !== undefined && String(c).trim() !== ''))
        .map(r => {
          const rawObj: Record<string, string> = {}
          sbHeaders.forEach((h, i) => { rawObj[h] = r[i] === null || r[i] === undefined ? '' : String(r[i]).trim() })

          // Strip leading apostrophes from phone: '+256776945215 → +256776945215
          const rawPhone = get(r, 'Client phone')
          const phone    = rawPhone.replace(/^'+/, '+').replace(/[^\d+]/g, '')

          // Notes: human comment + SimplyBook booking code
          const comment = get(r, 'Comment')
          const sbCode  = get(r, 'Code')
          const notes   = [comment, sbCode ? `SimplyBook ref: ${sbCode}` : ''].filter(Boolean).join(' | ')

          return {
            patient_name: get(r, 'Client name'),
            phone,
            email:        get(r, 'Client email'),
            service:      get(r, 'Service'),            // actual column name — was wrongly 'Event'
            doctor:       get(r, 'Service provider'),
            date:         parseDateStr(get(r, 'Date')) ?? get(r, 'Date'),
            time:         get(r, 'Time'),               // "HH:MM - HH:MM" — parsed below
            notes,
            __cancelled:  get(r, 'Is cancelled').toLowerCase() === 'yes',
            __rawData:    rawObj,
          }
        })
    } else {
      rows = XLSX.utils.sheet_to_json<any>(ws, { raw: false, defval: '' }).map((r: any) => {
        const rawDate = String(r.date ?? r['Date'] ?? r['date (YYYY-MM-DD)'] ?? '').trim()
        return {
          patient_name: String(r.patient_name ?? r['Patient Name'] ?? '').trim(),
          phone:        String(r.phone        ?? r['Phone']        ?? '').trim(),
          email:        String(r.email        ?? r['Email']        ?? '').trim(),
          service:      String(r.service      ?? r['Service']      ?? '').trim(),
          doctor:       String(r.doctor       ?? r['Doctor']       ?? '').trim(),
          date:         parseDateStr(rawDate) ?? rawDate,
          time:         String(r.time         ?? r['Time']         ?? r['time (HH:MM)'] ?? '').trim(),
          notes:        String(r.notes        ?? r['Notes']        ?? '').trim(),
          __cancelled:  false,
          __rawData:    r as Record<string, string>,
        }
      })
    }

    let succeeded = 0, partial = 0, failed = 0, servicesCreated = 0
    const results: ImportRowResult[] = []

    // Load all active doctors once for the whole batch.
    const allDoctors = await prisma.doctor.findMany({
      where:   { isActive: true },
      include: { user: { select: { firstName: true, lastName: true } } },
    })

    for (let idx = 0; idx < rows.length; idx++) {
      const rowNumber = idx + 1
      const row       = rows[idx]
      const result: ImportRowResult = { rowNumber, status: 'error', rawData: row.__rawData }

      try {
        const { patient_name: patientName, phone, email, service: serviceName,
                doctor: doctorName, date: dateStr, time: timeStr, notes: notesTxt } = row

        // Skip rows with no usable identifier (the ~11 null-name rows in SimplyBook export)
        if (!patientName && !phone) {
          result.error = 'No client name or phone — skipped'
          results.push(result); failed++; continue
        }

        if (!dateStr) {
          result.error = 'Missing date'
          results.push(result); failed++; continue
        }

        // ── Patient ──────────────────────────────────────────────────────────
        // Match on last 9 digits of phone (handles +256 vs 0 prefix differences).
        const phoneDigits = phone.replace(/\D/g, '').slice(-9)
        let patientCreated = false
        let patient = (phoneDigits.length >= 7)
          ? await prisma.patient.findFirst({ where: { phone: { endsWith: phoneDigits } } })
          : null
        if (!patient && patientName) {
          const nameParts  = patientName.split(' ')
          const firstName  = nameParts[0] ?? ''
          const lastName   = nameParts.slice(1).join(' ') || '.'
          patient = await prisma.patient.findFirst({
            where: { firstName: { equals: firstName, mode: 'insensitive' },
                     lastName:  { equals: lastName,  mode: 'insensitive' } },
          })
        }
        if (!patient) {
          const parts = patientName ? patientName.split(' ') : []
          patient = await prisma.patient.create({
            data: {
              firstName:    parts[0] || 'Unknown',
              lastName:     parts.slice(1).join(' ') || '.',
              phone:        phone || '',
              email:        email || undefined,
              importSource: 'CSV',
            },
          })
          patientCreated = true
        }
        result.patientCreated = patientCreated

        // ── Service ──────────────────────────────────────────────────────────
        let service = serviceName
          ? await prisma.service.findFirst({ where: { name: { equals: serviceName, mode: 'insensitive' } } })
          : await prisma.service.findFirst({ where: { isActive: true } })
        if (!service && serviceName) {
          // Partial-match fallback before creating
          service = await prisma.service.findFirst({ where: { name: { contains: serviceName, mode: 'insensitive' } } })
        }
        if (!service && serviceName) {
          try {
            service = await prisma.service.create({
              data: { name: serviceName, durationMins: 60, priceUGX: 0, isActive: true },
            })
            servicesCreated++
          } catch {
            service = await prisma.service.findFirst({ where: { name: { contains: serviceName, mode: 'insensitive' } } })
          }
        }
        if (!service) {
          result.error = 'No services exist in the system — create at least one service first'
          results.push(result); failed++; continue
        }

        // ── Doctor ───────────────────────────────────────────────────────────
        // Exact match → partial/contains match → first-name match → fallback.
        // doctorId is NOT nullable, so we must always assign someone.
        const doctorWarnings: string[] = []
        let doctor = doctorName
          ? allDoctors.find(d => `${d.user.firstName} ${d.user.lastName}`.toLowerCase() === doctorName.toLowerCase())
            ?? allDoctors.find(d => `${d.user.firstName} ${d.user.lastName}`.toLowerCase().includes(doctorName.toLowerCase()))
            ?? allDoctors.find(d => doctorName.toLowerCase().includes(d.user.firstName.toLowerCase()))
          : allDoctors[0]
        if (!doctor && allDoctors.length > 0) {
          doctor = allDoctors[0]
          doctorWarnings.push(`Doctor "${doctorName}" not in system — assigned to ${doctor.user.firstName} ${doctor.user.lastName}`)
        }
        if (!doctor) {
          result.error = 'No doctors exist in the system'
          results.push(result); failed++; continue
        }

        // ── Parse datetime — EAT (UTC+3) ─────────────────────────────────────
        // SimplyBook time format: "HH:MM - HH:MM"
        const timeParts = timeStr.split(/\s*-\s*/)
        const startTime = timeParts[0]?.trim() ?? timeStr
        const endTime   = timeParts[1]?.trim() ?? ''
        const timeNorm  = startTime.length >= 5 ? startTime.slice(0, 5) : startTime
        const startAt   = new Date(`${dateStr}T${timeNorm}:00+03:00`)
        if (isNaN(startAt.getTime())) {
          result.error = `Invalid date/time: "${dateStr} ${timeStr}"`
          results.push(result); failed++; continue
        }
        let endAt: Date
        if (endTime.length >= 5) {
          const parsed = new Date(`${dateStr}T${endTime.slice(0, 5)}:00+03:00`)
          endAt = (!isNaN(parsed.getTime()) && parsed > startAt)
            ? parsed
            : new Date(startAt.getTime() + service.durationMins * 60_000)
        } else {
          endAt = new Date(startAt.getTime() + service.durationMins * 60_000)
        }

        // ── Status ────────────────────────────────────────────────────────────
        // Cancelled source rows → CANCELLED (imported for history, not skipped)
        // Unknown doctor → IMPORTED (flagged for manual review)
        // Past non-cancelled → COMPLETED, Future → CONFIRMED
        let apptStatus: string
        if (row.__cancelled) {
          apptStatus = 'CANCELLED'
        } else if (doctorWarnings.length > 0) {
          apptStatus = 'IMPORTED'
        } else {
          apptStatus = startAt < new Date() ? 'COMPLETED' : 'CONFIRMED'
        }

        // ── Duplicate check (skip for CANCELLED — historical dupes are fine) ──
        if (apptStatus !== 'CANCELLED') {
          const dup = await prisma.appointment.findFirst({
            where: { doctorId: doctor.id, startAt, status: { notIn: ['CANCELLED', 'IMPORTED'] } },
          })
          if (dup) {
            result.status        = 'error'
            result.error         = `Duplicate: ${dup.status} appointment already exists at this slot`
            result.appointmentId = dup.id
            results.push(result); failed++; continue
          }
        }

        // ── Create ────────────────────────────────────────────────────────────
        const appt = await prisma.appointment.create({
          data: {
            patientId:   patient.id,
            doctorId:    doctor.id,
            serviceId:   service.id,
            startAt,
            endAt,
            status:      apptStatus as any,
            notes:       notesTxt || undefined,
            createdById: req.user?.id,
          },
        })
        result.appointmentId = appt.id

        if (doctorWarnings.length > 0) {
          result.status  = 'partial'
          result.warning = doctorWarnings.join('; ')
          results.push(result); partial++
        } else {
          result.status = 'success'
          results.push(result); succeeded++
        }

      } catch (rowErr: any) {
        result.status = 'error'
        result.error  = rowErr.message ?? String(rowErr)
        results.push(result); failed++
      }
    }

    res.json({
      total:           rows.length,
      succeeded,
      partial,
      failed,
      servicesCreated,
      format:          isSimplyBook ? 'simplybook' : 'standard',
      results,
    })
  } catch (e: any) {
    res.status(500).json({ error: `Failed to parse file: ${e.message}` })
  }
})

// ─── Booking settings ────────────────────────────────────────────────────────
// GET  /scheduling/booking-settings → { allowOverlapping: boolean }
// POST /scheduling/booking-settings → { allowOverlapping: boolean }

router.get('/booking-settings', requireAuth, async (_req, res) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'allow_overlapping_appointments' } })
    res.json({ allowOverlapping: setting?.value === 'true' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/booking-settings', requireAuth, clinicalStaff, async (req, res) => {
  try {
    const { allowOverlapping } = req.body as { allowOverlapping: boolean }
    await prisma.appSetting.upsert({
      where:  { key: 'allow_overlapping_appointments' },
      update: { value: String(!!allowOverlapping) },
      create: { key: 'allow_overlapping_appointments', value: String(!!allowOverlapping) },
    })
    res.json({ allowOverlapping: !!allowOverlapping })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
