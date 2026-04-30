import { PrismaClient } from '@prisma/client'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { searchKnowledge } from '../knowledge/rag'
import nodemailer from 'nodemailer'

async function sendEmail(opts: { to: string; subject: string; text: string }) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"Code Clinic" <noreply@codeclinic.ug>',
      to: opts.to, subject: opts.subject, text: opts.text,
    })
  } catch { /* non-blocking — email failure should not break agent */ }
}

async function sendSMS(to: string, message: string): Promise<void> {
  const apiKey   = process.env.AT_API_KEY
  const username = process.env.AT_USERNAME
  const senderId = process.env.AT_SENDER_ID || 'CodeClinic'
  if (!apiKey || !username || apiKey === 'your-key') {
    console.log(`[SMS STUB] Would send to ${to}: ${message.slice(0, 60)}`)
    return
  }
  try {
    const AfricasTalking = require('africastalking')
    const at  = AfricasTalking({ apiKey, username })
    const sms = at.SMS
    await sms.send({ to: [to], message, from: senderId })
    console.log(`[SMS] Sent to ${to}`)
  } catch (err: any) {
    console.warn(`[SMS] Failed for ${to}:`, err.message)
  }
}

const prisma = new PrismaClient()

// ── Encryption helpers (medical notes) ─────────────────────────

function decryptMedicalNotes(encrypted: string | null): string | null {
  if (!encrypted || !process.env.ENCRYPTION_KEY) return null
  try {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
    const [ivHex, authTagHex, ciphertext] = encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}

// ── Kampala time helpers ───────────────────────────────────────

function kampalaDay(date: Date, offsetDays = 0): Date {
  const d = new Date(date.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── Available time slots calculator ────────────────────────────

function generateSlots(
  start: string,
  end: string,
  durationMins: number,
  existingAppts: { startAt: Date; endAt: Date }[],
  blockedTimes: { startAt: Date; endAt: Date }[],
  dayStart: Date
): string[] {
  const startMins = parseTimeToMinutes(start)
  const endMins   = parseTimeToMinutes(end)
  const slots: string[] = []

  for (let s = startMins; s + durationMins <= endMins; s += 30) {
    const slotStart = new Date(dayStart)
    slotStart.setMinutes(slotStart.getMinutes() + (s - parseTimeToMinutes('00:00')))
    slotStart.setHours(Math.floor(s / 60), s % 60, 0, 0)
    const slotEnd = new Date(slotStart.getTime() + durationMins * 60000)

    // Check conflicts with existing appointments
    const hasConflict = [
      ...existingAppts.map(a => ({ start: a.startAt, end: a.endAt })),
      ...blockedTimes.map(b => ({ start: b.startAt, end: b.endAt })),
    ].some(({ start, end }) =>
      slotStart < end && slotEnd > start
    )

    if (!hasConflict) slots.push(minutesToTime(s))
  }

  return slots
}

// ── TOOL HANDLER CONTEXT ────────────────────────────────────────

export interface ToolContext {
  phoneNumber: string
  channel: 'VOICE' | 'WHATSAPP'
  sendWhatsApp?: (phone: string, message: string) => Promise<void>
}

// ── TOOL HANDLERS ──────────────────────────────────────────────

async function handle_get_patient_by_phone(input: { phone_number: string }) {
  const patient = await prisma.patient.findFirst({
    where: { phone: input.phone_number },
    include: {
      invoices: { where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } },
      appointments: {
        orderBy: { startAt: 'desc' },
        take: 5,
        include: {
          doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          service: { select: { name: true } },
        },
      },
    },
  })

  if (!patient) return { found: false }

  const outstanding = patient.invoices.reduce(
    (sum, inv) => sum + (inv.totalUGX - inv.paidUGX), 0
  )

  const lastAppt = patient.appointments[0]

  return {
    found: true,
    id: patient.id,
    full_name: `${patient.firstName} ${patient.lastName}`,
    first_name: patient.firstName,
    phone: patient.phone,
    email: patient.email,
    date_of_birth: patient.dob?.toISOString().split('T')[0],
    gender: patient.gender,
    medical_notes: decryptMedicalNotes(patient.medicalNotesEncrypted),
    total_outstanding_ugx: outstanding,
    last_visit_date: lastAppt?.startAt.toISOString().split('T')[0],
    last_doctor: lastAppt
      ? `Dr. ${lastAppt.doctor.user.firstName} ${lastAppt.doctor.user.lastName}`
      : null,
    upcoming_appointments: patient.appointments
      .filter(a => a.startAt > new Date() && !['CANCELLED', 'NO_SHOW'].includes(a.status))
      .map(a => ({
        id: a.id,
        date: a.startAt.toISOString().split('T')[0],
        time: a.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }),
        doctor: `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
        service: a.service.name,
        status: a.status,
      })),
  }
}

async function handle_get_patient_appointments(input: { patient_id: string }) {
  const appointments = await prisma.appointment.findMany({
    where: { patientId: input.patient_id },
    orderBy: { startAt: 'desc' },
    take: 10,
    include: {
      doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true, priceUGX: true } },
    },
  })

  return appointments.map(a => ({
    id: a.id,
    date: a.startAt.toISOString().split('T')[0],
    time: a.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }),
    doctor_name: `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`,
    doctor_id: a.doctorId,
    service_name: a.service.name,
    service_id: a.serviceId,
    status: a.status,
    price_ugx: a.service.priceUGX,
    notes: a.notes,
    is_upcoming: a.startAt > new Date(),
  }))
}

async function handle_get_doctor_availability(input: {
  doctor_id: string
  date: string
  duration_minutes: number
}) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: input.doctor_id },
    include: { user: { select: { firstName: true, lastName: true } } },
  })
  if (!doctor) return { error: 'Doctor not found', available_slots: [] }

  const dayStart = new Date(`${input.date}T00:00:00`)
  const dayEnd   = new Date(`${input.date}T23:59:59`)

  // Check if doctor works on this day (0=Sun, 1=Mon ... 6=Sat)
  const dayOfWeek = dayStart.getDay()
  const workingDays: number[] = JSON.parse(doctor.workingDays || '[1,2,3,4,5]')
  if (!workingDays.includes(dayOfWeek)) {
    return {
      doctor_name: `Dr. ${doctor.user.firstName} ${doctor.user.lastName}`,
      available_slots: [],
      message: 'Doctor does not work on this day',
    }
  }

  const workingHours: { start: string; end: string } = JSON.parse(
    doctor.workingHours || '{"start":"08:00","end":"18:00"}'
  )

  const [existingAppts, blockedTimes] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId: input.doctor_id,
        startAt: { gte: dayStart, lt: dayEnd },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.blockedTime.findMany({
      where: {
        doctorId: input.doctor_id,
        startAt: { gte: dayStart, lt: dayEnd },
      },
      select: { startAt: true, endAt: true },
    }),
  ])

  const slots = generateSlots(
    workingHours.start,
    workingHours.end,
    input.duration_minutes,
    existingAppts,
    blockedTimes,
    dayStart
  )

  return {
    doctor_name: `Dr. ${doctor.user.firstName} ${doctor.user.lastName}`,
    date: input.date,
    available_slots: slots,
  }
}

async function handle_get_all_doctors() {
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  })

  return doctors.map(d => {
    const workingDays: number[] = JSON.parse(d.workingDays || '[1,2,3,4,5]')
    const workingHours = JSON.parse(d.workingHours || '{"start":"08:00","end":"18:00"}')
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return {
      id: d.id,
      name: `Dr. ${d.user.firstName} ${d.user.lastName}`,
      specialisation: d.specialisation,
      working_days: workingDays.map(n => dayNames[n]).join(', '),
      working_hours: `${workingHours.start} – ${workingHours.end}`,
      colour: d.colour,
    }
  })
}

async function handle_get_services() {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return services.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    duration_minutes: s.durationMins,
    price_ugx: s.priceUGX,
    price_usd: s.priceUSD,
    vat_applicable: s.vatApplicable,
  }))
}

async function handle_get_patient_balance(input: { patient_id: string }) {
  const invoices = await prisma.invoice.findMany({
    where: {
      patientId: input.patient_id,
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      totalUGX: true,
      paidUGX: true,
      status: true,
      dueDate: true,
    },
  })

  const outstanding = invoices.reduce((sum, inv) => sum + (inv.totalUGX - inv.paidUGX), 0)

  return {
    outstanding_ugx: outstanding,
    invoice_count: invoices.length,
    invoices: invoices.map(inv => ({
      id: inv.id,
      number: inv.invoiceNumber,
      total_ugx: inv.totalUGX,
      paid_ugx: inv.paidUGX,
      balance_ugx: inv.totalUGX - inv.paidUGX,
      status: inv.status,
      due_date: inv.dueDate?.toISOString().split('T')[0],
    })),
  }
}

async function handle_book_appointment(
  input: {
    patient_id: string
    doctor_id: string
    service_id: string
    date: string
    time: string
    notes?: string
  },
  ctx: ToolContext
) {
  const service = await prisma.service.findUnique({ where: { id: input.service_id } })
  if (!service) return { success: false, error: 'Service not found' }

  const [h, m] = input.time.split(':').map(Number)
  const startAt = new Date(`${input.date}T00:00:00`)
  startAt.setHours(h, m, 0, 0)
  const endAt = new Date(startAt.getTime() + service.durationMins * 60000)

  // Double-check availability
  const conflict = await prisma.appointment.findFirst({
    where: {
      doctorId: input.doctor_id,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      OR: [{ AND: [{ startAt: { lte: startAt } }, { endAt: { gt: startAt } }] },
           { AND: [{ startAt: { lt: endAt } }, { endAt: { gte: endAt } }] }],
    },
  })
  if (conflict) return { success: false, error: 'Time slot no longer available. Please choose a different time.' }

  const [patient, doctor] = await Promise.all([
    prisma.patient.findUnique({ where: { id: input.patient_id } }),
    prisma.doctor.findUnique({ where: { id: input.doctor_id }, include: { user: { select: { firstName: true, lastName: true } } } }),
  ])
  if (!patient || !doctor) return { success: false, error: 'Patient or doctor not found' }

  const appointment = await prisma.appointment.create({
    data: {
      patientId: input.patient_id,
      doctorId: input.doctor_id,
      serviceId: input.service_id,
      startAt,
      endAt,
      status: 'CONFIRMED',
      notes: input.notes,
    },
  })

  // Save memory
  await prisma.agentMemory.create({
    data: {
      patientId: input.patient_id,
      channel: ctx.channel,
      phoneNumber: ctx.phoneNumber,
      interactionType: 'INBOUND',
      summary: `Booked appointment for ${service.name} with Dr. ${doctor.user.firstName} ${doctor.user.lastName} on ${input.date} at ${input.time}`,
      outcome: 'BOOKED',
      agentMode: 'INBOUND',
    },
  })

  // Send confirmation notifications
  const confirmText = `✅ Appointment confirmed!\n\n📅 ${new Date(startAt).toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n⏰ ${input.time}\n👨‍⚕️ Dr. ${doctor.user.firstName} ${doctor.user.lastName}\n🦷 ${service.name}\n\nPlease arrive 10 minutes early. Code Clinic, Kiira Road, Kamwokya. Call us: 0205477000`

  if (patient.email) {
    sendEmail({
      to: patient.email,
      subject: `Appointment Confirmed — Code Clinic`,
      text: confirmText,
    }).catch(() => { /* non-blocking */ })
  }

  if (ctx.sendWhatsApp && ctx.channel === 'VOICE') {
    ctx.sendWhatsApp(patient.phone, confirmText).catch(() => { /* non-blocking */ })
  }

  // Always send SMS confirmation
  sendSMS(patient.phone, confirmText).catch(() => { /* non-blocking */ })

  return {
    success: true,
    appointment_id: appointment.id,
    confirmation_details: {
      date: input.date,
      time: input.time,
      doctor: `Dr. ${doctor.user.firstName} ${doctor.user.lastName}`,
      service: service.name,
      duration_minutes: service.durationMins,
    },
  }
}

async function handle_reschedule_appointment(
  input: { appointment_id: string; new_date: string; new_time: string },
  ctx: ToolContext
) {
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointment_id },
    include: {
      service: true,
      patient: true,
      doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!appt) return { success: false, error: 'Appointment not found' }

  const [h, m] = input.new_time.split(':').map(Number)
  const newStart = new Date(`${input.new_date}T00:00:00`)
  newStart.setHours(h, m, 0, 0)
  const newEnd = new Date(newStart.getTime() + appt.service.durationMins * 60000)

  // Check new slot is free
  const conflict = await prisma.appointment.findFirst({
    where: {
      doctorId: appt.doctorId,
      id: { not: input.appointment_id },
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      OR: [{ AND: [{ startAt: { lte: newStart } }, { endAt: { gt: newStart } }] },
           { AND: [{ startAt: { lt: newEnd } }, { endAt: { gte: newEnd } }] }],
    },
  })
  if (conflict) return { success: false, error: 'New time slot is not available' }

  await prisma.appointment.update({
    where: { id: input.appointment_id },
    data: { startAt: newStart, endAt: newEnd, status: 'CONFIRMED' },
  })

  await prisma.agentMemory.create({
    data: {
      patientId: appt.patientId,
      channel: ctx.channel,
      phoneNumber: ctx.phoneNumber,
      interactionType: 'INBOUND',
      summary: `Rescheduled appointment to ${input.new_date} at ${input.new_time}`,
      outcome: 'RESCHEDULED',
      agentMode: 'INBOUND',
    },
  })

  return {
    success: true,
    new_date: input.new_date,
    new_time: input.new_time,
    service: appt.service.name,
    doctor: `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
  }
}

async function handle_cancel_appointment(
  input: { appointment_id: string; reason?: string },
  ctx: ToolContext
) {
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointment_id },
    include: { patient: true, service: true, doctor: { include: { user: true } } },
  })
  if (!appt) return { success: false, error: 'Appointment not found' }

  await prisma.appointment.update({
    where: { id: input.appointment_id },
    data: { status: 'CANCELLED', notes: input.reason ? `Cancelled: ${input.reason}` : 'Cancelled via agent' },
  })

  await prisma.agentMemory.create({
    data: {
      patientId: appt.patientId,
      channel: ctx.channel,
      phoneNumber: ctx.phoneNumber,
      interactionType: 'INBOUND',
      summary: `Cancelled appointment for ${appt.service.name}. Reason: ${input.reason || 'Not provided'}`,
      outcome: 'CANCELLED',
      agentMode: 'INBOUND',
    },
  })

  return { success: true, message: 'Appointment cancelled successfully' }
}

async function handle_confirm_appointment(
  input: { appointment_id: string },
  ctx: ToolContext
) {
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointment_id },
    include: { patient: true, service: true, doctor: { include: { user: true } } },
  })
  if (!appt) return { success: false, error: 'Appointment not found' }

  await prisma.appointment.update({
    where: { id: input.appointment_id },
    data: { status: 'CONFIRMED' },
  })

  await prisma.agentMemory.create({
    data: {
      patientId: appt.patientId,
      channel: ctx.channel,
      phoneNumber: ctx.phoneNumber,
      interactionType: 'REMINDER',
      summary: `Patient confirmed attendance for ${appt.service.name} appointment`,
      outcome: 'CONFIRMED',
      agentMode: 'REMINDER',
    },
  })

  return { success: true, message: 'Appointment confirmed' }
}

async function handle_get_agent_memory(input: { patient_id: string }) {
  const memories = await prisma.agentMemory.findMany({
    where: { patientId: input.patient_id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return memories.map(m => ({
    date: m.createdAt.toISOString().split('T')[0],
    channel: m.channel,
    type: m.interactionType,
    summary: m.summary,
    outcome: m.outcome,
    agent_mode: m.agentMode,
    days_ago: Math.floor((Date.now() - m.createdAt.getTime()) / 86400000),
  }))
}

async function handle_search_knowledge_base(input: { query: string }) {
  const results = await searchKnowledge(input.query, 3, 0.75)
  if (results.length === 0) return { found: false }
  return {
    found: true,
    results: results.map(r => ({
      title: r.title,
      content: r.content.slice(0, 800), // cap at 800 chars per chunk
      confidence: Math.round(r.similarity * 100),
    })),
  }
}

async function handle_create_patient(input: {
  full_name: string
  phone: string
  email?: string
  date_of_birth?: string
}) {
  const parts = input.full_name.trim().split(/\s+/)
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ') || 'Unknown'

  const existing = await prisma.patient.findFirst({ where: { phone: input.phone } })
  if (existing) return { success: true, patient_id: existing.id, message: 'Patient already exists', is_new: false }

  const patient = await prisma.patient.create({
    data: {
      firstName,
      lastName,
      phone: input.phone,
      email: input.email,
      dob: input.date_of_birth ? new Date(input.date_of_birth) : undefined,
      isActive: true,
    },
  })

  return { success: true, patient_id: patient.id, message: 'New patient profile created', is_new: true }
}

async function handle_escalate_to_human(
  input: { reason: string; urgency: 'LOW' | 'MEDIUM' | 'HIGH'; channel: 'VOICE' | 'WHATSAPP' },
  ctx: ToolContext,
  transcript?: string,
  whatsappThread?: any[]
) {
  // Create escalation record
  const patient = await prisma.patient.findFirst({ where: { phone: ctx.phoneNumber } })

  await prisma.escalation.create({
    data: {
      patientId: patient?.id,
      phoneNumber: ctx.phoneNumber,
      channel: input.channel,
      reason: input.reason,
      transcript,
      whatsappThread: whatsappThread ? JSON.stringify(whatsappThread) : undefined,
      status: 'PENDING',
    },
  })

  // Notify all receptionist + admin users
  const staff = await prisma.user.findMany({
    where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true },
    select: { id: true },
  })

  const urgencyEmoji = { LOW: '⚠️', MEDIUM: '🔶', HIGH: '🚨' }[input.urgency]
  await Promise.all(
    staff.map(u =>
      prisma.notification.create({
        data: {
          userId: u.id,
          type: 'ESCALATION',
          title: `${urgencyEmoji} Agent Escalation — ${input.urgency} Priority`,
          body: `${input.reason.slice(0, 180)} | Phone: ${ctx.phoneNumber}`,
          href: '/receptionist/dashboard',
        },
      })
    )
  )

  return { escalated: true, message: 'Connecting you with our team now' }
}

async function handle_save_interaction_memory(input: {
  patient_id?: string
  channel: 'VOICE' | 'WHATSAPP'
  interaction_type: string
  summary: string
  outcome: string
  phone_number: string
  agent_mode: string
}) {
  await prisma.agentMemory.create({
    data: {
      patientId: input.patient_id,
      channel: input.channel,
      phoneNumber: input.phone_number,
      interactionType: input.interaction_type,
      summary: input.summary,
      outcome: input.outcome,
      agentMode: input.agent_mode,
    },
  })
  return { saved: true }
}

async function handle_get_knowledge_base_info() {
  // Return the seeded INBOUND agent prompt as general clinic info fallback
  const prompt = await prisma.agentPrompt.findFirst({ where: { type: 'INBOUND_BOOKING' } })
  return {
    clinic_name: 'Code Clinic',
    location: 'Kiira Road, Kamwokya, Kampala, Uganda',
    phone: '0205477000',
    founded: '2012',
    founder: 'Dr. Steven Mugabe',
    mission: 'Deliver a WOW dental experience while saving lives through oral-systemic health',
    payment_methods: 'MTN MoMo, Airtel Money, Cash, Bank Transfer, Visa/Mastercard',
    working_hours: 'Monday–Friday 8:00am–6:00pm, Saturday 9:00am–2:00pm',
    additional_info: prompt?.systemPrompt?.slice(0, 500),
  }
}

// ── TOOL DEFINITIONS (Anthropic format) ────────────────────────

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_patient_by_phone',
    description: 'ALWAYS call this first when a patient contacts us. Returns full patient profile including balance and upcoming appointments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        phone_number: { type: 'string', description: 'Phone number in Uganda format e.g. +256700123456 or 0700123456' },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'get_patient_appointments',
    description: 'Get all appointments for a patient. Call before discussing any appointment.',
    input_schema: {
      type: 'object' as const,
      properties: { patient_id: { type: 'string' } },
      required: ['patient_id'],
    },
  },
  {
    name: 'get_doctor_availability',
    description: 'Check available time slots for a specific doctor on a specific date. Always call before suggesting or confirming any appointment time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        doctor_id: { type: 'string' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        duration_minutes: { type: 'number', description: 'Duration of the service in minutes' },
      },
      required: ['doctor_id', 'date', 'duration_minutes'],
    },
  },
  {
    name: 'get_all_doctors',
    description: 'Get list of all active doctors with working days and specialisations. Call before mentioning any doctor.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_services',
    description: 'Get all available services with prices and durations. ALWAYS call before mentioning any price.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_patient_balance',
    description: 'Get outstanding balance for a patient. Call before discussing any payment.',
    input_schema: {
      type: 'object' as const,
      properties: { patient_id: { type: 'string' } },
      required: ['patient_id'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment. ONLY call after patient has verbally confirmed ALL details (date, time, doctor, service).',
    input_schema: {
      type: 'object' as const,
      properties: {
        patient_id: { type: 'string' },
        doctor_id: { type: 'string' },
        service_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM (24-hour)' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['patient_id', 'doctor_id', 'service_id', 'date', 'time'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Reschedule an existing appointment. Only call after patient confirms new date and time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string' },
        new_date: { type: 'string', description: 'YYYY-MM-DD' },
        new_time: { type: 'string', description: 'HH:MM (24-hour)' },
      },
      required: ['appointment_id', 'new_date', 'new_time'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an appointment. Only call after patient explicitly confirms cancellation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointment_id: { type: 'string' },
        reason: { type: 'string', description: 'Optional cancellation reason' },
      },
      required: ['appointment_id'],
    },
  },
  {
    name: 'confirm_appointment',
    description: 'Mark an appointment as confirmed when patient confirms they will attend.',
    input_schema: {
      type: 'object' as const,
      properties: { appointment_id: { type: 'string' } },
      required: ['appointment_id'],
    },
  },
  {
    name: 'get_agent_memory',
    description: 'ALWAYS call this after get_patient_by_phone. Loads interaction history so you remember the patient across sessions.',
    input_schema: {
      type: 'object' as const,
      properties: { patient_id: { type: 'string' } },
      required: ['patient_id'],
    },
  },
  {
    name: 'search_knowledge_base',
    description: 'Search the clinic knowledge base for answers to questions. Use before answering any FAQ. If confidence is low, escalate.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'The question to search for' } },
      required: ['query'],
    },
  },
  {
    name: 'create_patient',
    description: 'Create a new patient profile when they are not found in the system.',
    input_schema: {
      type: 'object' as const,
      properties: {
        full_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        date_of_birth: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['full_name', 'phone'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'IMMEDIATELY escalate when: cannot answer, patient is upset, request is outside scope, tool returns error, dental emergency, or anything uncertain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Why are you escalating?' },
        urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        channel: { type: 'string', enum: ['VOICE', 'WHATSAPP'] },
      },
      required: ['reason', 'urgency', 'channel'],
    },
  },
  {
    name: 'save_interaction_memory',
    description: 'Call at the END of every interaction to save what happened. This is mandatory — every interaction must be remembered.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patient_id: { type: 'string', description: 'Patient ID (optional if unknown caller)' },
        phone_number: { type: 'string' },
        channel: { type: 'string', enum: ['VOICE', 'WHATSAPP'] },
        interaction_type: { type: 'string', enum: ['INBOUND', 'REMINDER', 'FOLLOWUP', 'DEBT'] },
        summary: { type: 'string', description: '1-2 sentence summary of what happened' },
        outcome: { type: 'string', enum: ['BOOKED', 'RESCHEDULED', 'CANCELLED', 'CONFIRMED', 'ESCALATED', 'NO_ANSWER', 'CALLBACK_REQUESTED', 'COMPLETED', 'NO_ACTION'] },
        agent_mode: { type: 'string' },
      },
      required: ['phone_number', 'channel', 'interaction_type', 'summary', 'outcome', 'agent_mode'],
    },
  },
  {
    name: 'get_knowledge_base_info',
    description: 'Get basic clinic information (location, hours, payment methods, contact). Call when patient asks general questions about the clinic.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
]

// ── TOOL EXECUTOR ──────────────────────────────────────────────

export async function executeAgentTool(
  name: string,
  input: any,
  ctx: ToolContext,
  agentState?: { transcript?: string; whatsappThread?: any[] }
): Promise<any> {
  try {
    switch (name) {
      case 'get_patient_by_phone':       return await handle_get_patient_by_phone(input)
      case 'get_patient_appointments':   return await handle_get_patient_appointments(input)
      case 'get_doctor_availability':    return await handle_get_doctor_availability(input)
      case 'get_all_doctors':            return await handle_get_all_doctors()
      case 'get_services':               return await handle_get_services()
      case 'get_patient_balance':        return await handle_get_patient_balance(input)
      case 'book_appointment':           return await handle_book_appointment(input, ctx)
      case 'reschedule_appointment':     return await handle_reschedule_appointment(input, ctx)
      case 'cancel_appointment':         return await handle_cancel_appointment(input, ctx)
      case 'confirm_appointment':        return await handle_confirm_appointment(input, ctx)
      case 'get_agent_memory':           return await handle_get_agent_memory(input)
      case 'search_knowledge_base':      return await handle_search_knowledge_base(input)
      case 'create_patient':             return await handle_create_patient(input)
      case 'escalate_to_human':          return await handle_escalate_to_human(input, ctx, agentState?.transcript, agentState?.whatsappThread)
      case 'save_interaction_memory':    return await handle_save_interaction_memory({ ...input, phone_number: input.phone_number || ctx.phoneNumber })
      case 'get_knowledge_base_info':    return await handle_get_knowledge_base_info()
      default:                           return { error: `Unknown tool: ${name}` }
    }
  } catch (err: any) {
    console.error(`[AGENT TOOL ERROR] ${name}:`, err.message)
    return { error: `Tool execution failed: ${err.message}` }
  }
}
