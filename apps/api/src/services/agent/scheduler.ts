import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { triggerOutboundCall } from './channels/voice-channel'
import { sendMissedCallWhatsApp } from './channels/whatsapp-channel'

const prisma = new PrismaClient()

// ── Time helpers (Kampala = UTC+3) ────────────────────────────

function kampalaToday(offsetDays = 0): { start: Date; end: Date } {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  now.setDate(now.getDate() + offsetDays)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

// ── JOB 1: Appointment Reminder — 09:00 EAT = 06:00 UTC ──────

async function runReminderJob() {
  console.log('[SCHEDULER] Running appointment reminder job...')
  const tomorrow = kampalaToday(1)

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: tomorrow.start, lt: tomorrow.end },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    include: { patient: true, service: true },
  })

  console.log(`[SCHEDULER] Found ${appointments.length} appointments for tomorrow`)

  let delayMinutes = 0
  for (const appt of appointments) {
    // Check if we already have a pending queue item for this appointment
    const existing = await prisma.outboundQueue.findFirst({
      where: {
        appointmentId: appt.id,
        agentMode: 'REMINDER',
        status: { in: ['PENDING', 'CALLING', 'COMPLETED'] },
        createdAt: { gte: kampalaToday(0).start },
      },
    })
    if (existing) continue

    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000)
    await prisma.outboundQueue.create({
      data: {
        patientId:     appt.patientId,
        phoneNumber:   appt.patient.phone,
        agentMode:     'REMINDER',
        reason:        `Appointment reminder for ${appt.service.name}`,
        appointmentId: appt.id,
        scheduledFor,
        status:        'PENDING',
      },
    })

    delayMinutes += 2 // Space calls 2 minutes apart
  }

  console.log(`[SCHEDULER] Queued ${appointments.length} reminder calls`)
}

// ── JOB 2: Post-Visit Follow-up — 10:00 EAT = 07:00 UTC ──────

async function runFollowupJob() {
  console.log('[SCHEDULER] Running post-visit follow-up job...')
  const yesterday = kampalaToday(-1)

  const completedAppts = await prisma.appointment.findMany({
    where: {
      startAt: { gte: yesterday.start, lt: yesterday.end },
      status: 'COMPLETED',
    },
    include: { patient: true, service: true, doctor: { include: { user: true } } },
  })

  console.log(`[SCHEDULER] Found ${completedAppts.length} completed appointments from yesterday`)

  let delayMinutes = 0
  for (const appt of completedAppts) {
    const existing = await prisma.outboundQueue.findFirst({
      where: {
        appointmentId: appt.id,
        agentMode: 'FOLLOWUP',
        status: { in: ['PENDING', 'CALLING', 'COMPLETED'] },
      },
    })
    if (existing) continue

    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000)
    await prisma.outboundQueue.create({
      data: {
        patientId:     appt.patientId,
        phoneNumber:   appt.patient.phone,
        agentMode:     'FOLLOWUP',
        reason:        `Post-visit follow-up after ${appt.service.name} with Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
        appointmentId: appt.id,
        scheduledFor,
        status:        'PENDING',
      },
    })
    delayMinutes += 2
  }

  console.log(`[SCHEDULER] Queued ${completedAppts.length} follow-up calls`)
}

// ── JOB 3: Debt Reminder — Monday 11:00 EAT = 08:00 UTC ──────

async function runDebtJob() {
  console.log('[SCHEDULER] Running debt reminder job...')
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['OVERDUE', 'UNPAID'] },
      createdAt: { lt: sevenDaysAgo },
    },
    include: { patient: true },
  })

  // Group by patient (one call per patient, not per invoice)
  const patientMap = new Map<string, typeof overdueInvoices[0]>()
  for (const inv of overdueInvoices) {
    if (!patientMap.has(inv.patientId)) patientMap.set(inv.patientId, inv)
  }

  console.log(`[SCHEDULER] Found ${patientMap.size} patients with overdue invoices`)

  let delayMinutes = 0
  for (const [patientId, inv] of patientMap.entries()) {
    // Check if we already called this patient today for debt
    const existing = await prisma.outboundQueue.findFirst({
      where: {
        patientId,
        agentMode: 'DEBT',
        status: { in: ['PENDING', 'CALLING', 'COMPLETED'] },
        createdAt: { gte: kampalaToday(0).start },
      },
    })
    if (existing) continue

    const outstanding = overdueInvoices
      .filter(i => i.patientId === patientId)
      .reduce((sum, i) => sum + (i.totalUGX - i.paidUGX), 0)

    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000)
    await prisma.outboundQueue.create({
      data: {
        patientId,
        phoneNumber:   inv.patient.phone,
        agentMode:     'DEBT',
        reason:        `Outstanding balance of UGX ${outstanding.toLocaleString()} — overdue > 7 days`,
        scheduledFor,
        status:        'PENDING',
      },
    })
    delayMinutes += 2
  }

  console.log(`[SCHEDULER] Queued ${patientMap.size} debt reminder calls`)
}

// ── QUEUE PROCESSOR — every 2 minutes ─────────────────────────

async function processQueue() {
  const ready = await prisma.outboundQueue.findMany({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: new Date() },
      attempts: { lt: 3 },
    },
    include: { patient: true },
    take: 5, // process 5 at a time to avoid overloading
    orderBy: { scheduledFor: 'asc' },
  })

  if (ready.length === 0) return

  console.log(`[QUEUE] Processing ${ready.length} queued calls`)

  for (const item of ready) {
    try {
      await triggerOutboundCall(item.id)
    } catch (err: any) {
      console.error(`[QUEUE] Failed to trigger call for ${item.id}:`, err.message)
      await prisma.outboundQueue.update({
        where: { id: item.id },
        data: { status: 'FAILED', outcome: err.message.slice(0, 200) },
      })
    }
  }
}

// ── FOLLOWUP: Send WhatsApp if no answer in 5 minutes ─────────

async function checkNoAnswerWhatsApp() {
  // Find FAILED queue items with NO_ANSWER memory within last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const noAnswerMemory = await prisma.agentMemory.findMany({
    where: {
      outcome: 'NO_ANSWER',
      createdAt: { gte: oneHourAgo },
      interactionType: 'REMINDER',
    },
  })

  for (const mem of noAnswerMemory) {
    // Check if we already sent a WhatsApp follow-up
    const alreadySent = await prisma.agentLog.findFirst({
      where: {
        patientId: mem.patientId,
        type: 'WHATSAPP_OUTBOUND',
        createdAt: { gte: mem.createdAt },
      },
    })
    if (alreadySent) continue

    // Get appointment details from queue
    const queueItem = await prisma.outboundQueue.findFirst({
      where: {
        patientId: mem.patientId || undefined,
        agentMode: 'REMINDER',
        status: { in: ['FAILED', 'COMPLETED'] },
        createdAt: { gte: oneHourAgo },
      },
      include: { patient: true },
    })

    if (!queueItem?.appointmentId) continue

    const appt = await prisma.appointment.findUnique({
      where: { id: queueItem.appointmentId },
      include: { doctor: { include: { user: true } }, service: true },
    })
    if (!appt) continue

    await sendMissedCallWhatsApp(
      queueItem.patient.phone,
      `${queueItem.patient.firstName} ${queueItem.patient.lastName}`,
      `Dr. ${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`,
      appt.startAt.toLocaleTimeString('en-UG', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit' }),
      appt.id
    )
  }
}

// ── Start all cron jobs ────────────────────────────────────────

export function startScheduler(): void {
  // REMINDER: 09:00 EAT = 06:00 UTC
  cron.schedule('0 6 * * *', runReminderJob, { timezone: 'UTC' })

  // FOLLOWUP: 10:00 EAT = 07:00 UTC
  cron.schedule('0 7 * * *', runFollowupJob, { timezone: 'UTC' })

  // DEBT: Monday 11:00 EAT = 08:00 UTC
  cron.schedule('0 8 * * 1', runDebtJob, { timezone: 'UTC' })

  // QUEUE PROCESSOR: every 2 minutes
  cron.schedule('*/2 * * * *', processQueue)

  // NO-ANSWER WHATSAPP: every 10 minutes
  cron.schedule('*/10 * * * *', checkNoAnswerWhatsApp)

  console.log('[SCHEDULER] All cron jobs started:')
  console.log('  ├─ Appointment reminders: 09:00 EAT daily')
  console.log('  ├─ Post-visit follow-ups: 10:00 EAT daily')
  console.log('  ├─ Debt reminders: Monday 11:00 EAT')
  console.log('  ├─ Queue processor: every 2 minutes')
  console.log('  └─ No-answer WhatsApp: every 10 minutes')
}

// ── Manual triggers (for testing/admin) ──────────────────────

export { runReminderJob, runFollowupJob, runDebtJob, processQueue }
