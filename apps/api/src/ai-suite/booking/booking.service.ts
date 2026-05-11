import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export interface AvailableSlot {
  doctorId: string
  doctorName: string
  serviceId: string
  serviceName: string
  startAt: Date
  endAt: Date
}

// ── Timezone helpers (Africa/Nairobi = UTC+3) ─────────────────────────────────

function toKampalaDateStr(date: Date): string {
  // Returns YYYY-MM-DD in Kampala local time
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}

function kampalaWeekday(date: Date): number {
  // Returns 0=Sun, 1=Mon, …, 6=Sat in Kampala timezone
  const short = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Africa/Nairobi' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short)
}

function getWorkingHours(json: string, weekday: number): { start: string; end: string } | null {
  // Supports both simple {start,end} and per-day {1:{start,end},…} formats
  try {
    const parsed = JSON.parse(json)
    if (parsed[String(weekday)]?.start) return parsed[String(weekday)]
    if (parsed.start && parsed.end) return { start: parsed.start, end: parsed.end }
    return null
  } catch {
    return null
  }
}

// ── getAvailableSlots ─────────────────────────────────────────────────────────

export async function getAvailableSlots(
  serviceId: string,
  doctorId?: string,
  daysAhead = 7
): Promise<AvailableSlot[]> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) return []

  const durationMs = service.durationMins * 60_000
  const now        = new Date()
  const minStart   = new Date(now.getTime() + 2 * 60 * 60 * 1000)  // minimum 2h lead time
  const rangeEnd   = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  // Resolve eligible doctors
  let doctors: Array<{
    id: string
    workingDays: string
    workingHours: string
    serviceIds: string
    user: { firstName: string; lastName: string }
  }>

  if (doctorId) {
    const d = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { user: { select: { firstName: true, lastName: true } } },
    })
    doctors = d ? [d] : []
  } else {
    const all = await prisma.doctor.findMany({
      where: { isActive: true },
      include: { user: { select: { firstName: true, lastName: true } } },
    })
    // Include doctors with no serviceIds restriction OR explicitly assigned this service
    doctors = all.filter(d => {
      const ids = JSON.parse(d.serviceIds) as string[]
      return ids.length === 0 || ids.includes(serviceId)
    })
  }

  if (doctors.length === 0) return []

  // Batch-fetch all conflicts for the entire range in one round-trip
  const doctorIds = doctors.map(d => d.id)
  const [existingAppts, blockedTimes] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        doctorId: { in: doctorIds },
        status: { notIn: ['CANCELLED'] },
        startAt: { lt: rangeEnd },
        endAt:   { gt: minStart },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
    prisma.blockedTime.findMany({
      where: {
        doctorId: { in: doctorIds },
        startAt: { lt: rangeEnd },
        endAt:   { gt: minStart },
      },
      select: { doctorId: true, startAt: true, endAt: true },
    }),
  ])

  const slots: AvailableSlot[] = []

  for (let dayOffset = 0; dayOffset < daysAhead && slots.length < 20; dayOffset++) {
    const dayBase   = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000)
    const dateStr   = toKampalaDateStr(dayBase)
    const weekday   = kampalaWeekday(dayBase)

    for (const doctor of doctors) {
      if (slots.length >= 20) break

      const workingDays = JSON.parse(doctor.workingDays) as number[]
      if (!workingDays.includes(weekday)) continue

      const hours = getWorkingHours(doctor.workingHours, weekday)
      if (!hours) continue

      const doctorAppts  = existingAppts.filter(a => a.doctorId === doctor.id)
      const doctorBlocks = blockedTimes.filter(b => b.doctorId === doctor.id)
      const doctorName   = `Dr ${doctor.user.firstName} ${doctor.user.lastName}`

      // Walk through slots from working-hours start to end
      let slotStart = new Date(`${dateStr}T${hours.start}:00+03:00`)
      const dayEnd  = new Date(`${dateStr}T${hours.end}:00+03:00`)

      while (slotStart < dayEnd && slots.length < 20) {
        const slotEnd = new Date(slotStart.getTime() + durationMs)
        if (slotEnd > dayEnd) break

        if (slotStart >= minStart) {
          const conflict =
            doctorAppts.some(a  => a.startAt < slotEnd && a.endAt > slotStart) ||
            doctorBlocks.some(b => b.startAt < slotEnd && b.endAt > slotStart)

          if (!conflict) {
            slots.push({
              doctorId:    doctor.id,
              doctorName,
              serviceId,
              serviceName: service.name,
              startAt:     new Date(slotStart),
              endAt:       new Date(slotEnd),
            })
          }
        }

        slotStart = new Date(slotStart.getTime() + durationMs)
      }
    }
  }

  return slots
}

// ── getServices ───────────────────────────────────────────────────────────────

export async function getServices() {
  return prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true, priceUGX: true, durationMins: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
}

// ── getDoctors ────────────────────────────────────────────────────────────────

export async function getDoctors() {
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { user: { firstName: 'asc' } },
  })
  return doctors.map(d => ({
    id:             d.id,
    firstName:      d.user.firstName,
    lastName:       d.user.lastName,
    specialisation: d.specialisation,
  }))
}

// ── createAppointment ─────────────────────────────────────────────────────────

export async function createAppointment(
  patientId: string | null,
  doctorId: string,
  serviceId: string,
  startAt: Date,
  phone: string
) {
  // Appointment.patientId is non-nullable — find or create patient from phone
  let resolvedPatientId = patientId
  if (!resolvedPatientId) {
    let patient = await prisma.patient.findFirst({ where: { phone } })
    if (!patient) {
      patient = await prisma.patient.create({
        data: { firstName: 'New', lastName: 'Patient', phone },
      })
    }
    resolvedPatientId = patient.id
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } })
  if (!service) throw new Error('Service not found')

  const endAt = new Date(startAt.getTime() + service.durationMins * 60_000)

  const conflict = await prisma.appointment.findFirst({
    where: {
      doctorId,
      status: { notIn: ['CANCELLED'] },
      startAt: { lt: endAt },
      endAt:   { gt: startAt },
    },
  })
  if (conflict) throw new Error('Time slot no longer available — please pick another')

  return prisma.appointment.create({
    data: { patientId: resolvedPatientId, doctorId, serviceId, startAt, endAt },
    include: {
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })
}

// ── rescheduleAppointment ─────────────────────────────────────────────────────

export async function rescheduleAppointment(appointmentId: string, newStartAt: Date) {
  const existing = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { service: true },
  })
  if (!existing) throw new Error('Appointment not found')

  const newEndAt = new Date(newStartAt.getTime() + existing.service.durationMins * 60_000)

  const conflict = await prisma.appointment.findFirst({
    where: {
      id:       { not: appointmentId },
      doctorId: existing.doctorId,
      status:   { notIn: ['CANCELLED'] },
      startAt:  { lt: newEndAt },
      endAt:    { gt: newStartAt },
    },
  })
  if (conflict) throw new Error('That slot is no longer available')

  return prisma.appointment.update({
    where: { id: appointmentId },
    data:  { startAt: newStartAt, endAt: newEndAt },
    include: {
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })
}

// ── cancelAppointment ─────────────────────────────────────────────────────────

export async function cancelAppointment(appointmentId: string) {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data:  { status: 'CANCELLED' },
    include: {
      doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
      service: { select: { name: true } },
    },
  })
}
