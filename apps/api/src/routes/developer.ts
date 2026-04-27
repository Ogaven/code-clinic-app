import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { requireAuth } from '../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

router.get('/', requireAuth, (_req, res) => res.json({ message: 'Developer endpoints' }))

// POST /api/developer/seed
// Idempotent seed — safe to call multiple times. Creates demo patients,
// appointments, AI conversations, and agent config if they don't exist yet.
router.post('/seed', requireAuth, async (_req, res) => {
  try {
    const results: string[] = []

    // ── Patients ─────────────────────────────────────────────────────────────
    const patientsData = [
      { firstName: 'Sarah',     lastName: 'Namukasa',  phone: '+256700000001', email: 'sarah.namukasa@gmail.com',  gender: 'FEMALE', dob: new Date('1990-03-15') },
      { firstName: 'John',      lastName: 'Ssebulime', phone: '+256700000002', email: 'john.ssebulime@gmail.com',  gender: 'MALE',   dob: new Date('1985-07-22') },
      { firstName: 'Mary',      lastName: 'Nakato',    phone: '+256700000003', email: null,                        gender: 'FEMALE', dob: new Date('1995-11-08') },
      { firstName: 'Peter',     lastName: 'Ochieng',   phone: '+256700000004', email: 'peter.ochieng@yahoo.com',   gender: 'MALE',   dob: new Date('1978-01-30') },
      { firstName: 'Grace',     lastName: 'Auma',      phone: '+256700000005', email: null,                        gender: 'FEMALE', dob: new Date('2000-06-12') },
    ]
    const createdPatients: { id: string; firstName: string }[] = []
    for (const p of patientsData) {
      const pat = await prisma.patient.upsert({
        where:  { phone: p.phone },
        update: { firstName: p.firstName, lastName: p.lastName },
        create: { firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email ?? undefined, gender: p.gender, dob: p.dob },
      })
      createdPatients.push({ id: pat.id, firstName: p.firstName })
    }
    results.push(`${patientsData.length} patients upserted`)

    // ── Appointments ─────────────────────────────────────────────────────────
    const allDoctors  = await prisma.doctor.findMany({ include: { user: true } })
    const allServices = await prisma.service.findMany({ where: { isActive: true } })
    const adminUser   = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'RECEPTIONIST'] } } })

    if (allDoctors.length && allServices.length) {
      function apptDate(offsetDays: number, hour: number, minute = 0) {
        const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(hour, minute, 0, 0); return d
      }
      function svc(name: string) { return allServices.find(s => s.name.includes(name)) ?? allServices[0] }
      function doc(i: number)    { return allDoctors[i % allDoctors.length] }
      function pat(i: number)    { return createdPatients[i % createdPatients.length] }

      const appts = [
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Check and Treat').id,        startAt: apptDate(0,  8, 0),  status: 'CONFIRMED'   },
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Dental Cleaning').id,        startAt: apptDate(0, 10, 0),  status: 'CONFIRMED'   },
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Periodontal Therapy').id,    startAt: apptDate(3,  9, 0),  status: 'CONFIRMED'   },
        { patientId: pat(3).id, doctorId: doc(3).id, serviceId: svc('Root Canal Treatment').id,   startAt: apptDate(5, 11, 0),  status: 'CONFIRMED'   },
        { patientId: pat(4).id, doctorId: doc(4).id, serviceId: svc('Tooth Extraction').id,       startAt: apptDate(7,  9, 0),  status: 'CONFIRMED'   },
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Check and Treat').id,        startAt: apptDate(-7, 9, 0),  status: 'COMPLETED'   },
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Dental Cleaning').id,        startAt: apptDate(-5,10, 0),  status: 'COMPLETED'   },
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Dental Filling').id,         startAt: apptDate(-3,14, 0),  status: 'COMPLETED'   },
        { patientId: pat(3).id, doctorId: doc(3).id, serviceId: svc('Implant Consultation').id,   startAt: apptDate(10, 9, 0),  status: 'CANCELLED'   },
        { patientId: pat(4).id, doctorId: doc(4).id, serviceId: svc('Orthodontic Consultation').id, startAt: apptDate(12,11, 0), status: 'CANCELLED' },
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Wisdom Tooth').id,           startAt: apptDate(15, 9, 0),  status: 'RESCHEDULED' },
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Fluoride Treatment').id,     startAt: apptDate(-4, 9, 0),  status: 'NO_SHOW'     },
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Teeth Whitening').id,        startAt: apptDate(20, 9, 0),  status: 'PENDING'     },
      ]

      let apptCreated = 0
      for (const a of appts) {
        const service = allServices.find(s => s.id === a.serviceId) ?? allServices[0]
        const endAt   = new Date(a.startAt.getTime() + service.durationMins * 60_000)
        try {
          await prisma.appointment.upsert({
            where:  { doctorId_startAt: { doctorId: a.doctorId, startAt: a.startAt } },
            update: { status: a.status },
            create: { patientId: a.patientId, doctorId: a.doctorId, serviceId: a.serviceId, startAt: a.startAt, endAt, status: a.status, createdById: adminUser?.id },
          })
          apptCreated++
        } catch { /* skip duplicates */ }
      }
      results.push(`${apptCreated} appointments upserted`)
    }

    // ── AI Conversations ──────────────────────────────────────────────────────
    async function upsertConv(phone: string, msgs: { role: 'USER' | 'AGENT'; content: string; minsAgo: number }[]) {
      const existing = await prisma.aiConversation.findFirst({ where: { phoneNumber: phone, channel: 'WHATSAPP' } })
      const conv = existing ?? await prisma.aiConversation.create({
        data: { phoneNumber: phone, channel: 'WHATSAPP', agentEnabled: true, status: 'ACTIVE' },
      })
      for (const m of msgs) {
        const dup = await prisma.aiMessage.findFirst({ where: { conversationId: conv.id, role: m.role, content: m.content } })
        if (!dup) {
          await prisma.aiMessage.create({
            data: { conversationId: conv.id, role: m.role, content: m.content, createdAt: new Date(Date.now() - m.minsAgo * 60_000) },
          })
        }
      }
    }

    await upsertConv('+256700000001', [
      { role: 'USER',  content: 'Hello, I need to book an appointment',                                                              minsAgo: 45 },
      { role: 'AGENT', content: "Hi Sarah! Welcome to Code Clinic 😊 I'd be happy to help you book. Which service are you looking for?", minsAgo: 44 },
      { role: 'USER',  content: 'I need a dental checkup',                                                                            minsAgo: 43 },
      { role: 'AGENT', content: 'Perfect! We have slots this week. Would Tuesday at 10am work with Dr. Angella?',                      minsAgo: 42 },
      { role: 'USER',  content: 'Yes that works',                                                                                     minsAgo: 40 },
      { role: 'AGENT', content: "Great! Booked for Tuesday at 10:00 AM with Dr. Angella. See you then! 😊",                           minsAgo: 39 },
    ])
    await upsertConv('+256700000002', [
      { role: 'USER',  content: 'Can I reschedule my appointment?',                                                                   minsAgo: 120 },
      { role: 'AGENT', content: 'Of course John! You have Wednesday at 2pm with Dr. Arnold. What day works better?',                  minsAgo: 119 },
      { role: 'USER',  content: 'Can we do Friday instead?',                                                                          minsAgo: 118 },
      { role: 'AGENT', content: "Done! Moved to Friday at 2:00 PM with Dr. Arnold. Reminder sent 😊",                                minsAgo: 117 },
    ])
    await upsertConv('+256700000003', [
      { role: 'USER',  content: 'I have a toothache, is there a slot today?',                                                         minsAgo: 30 },
      { role: 'AGENT', content: "Oh no, sorry to hear that 😟 We have a slot at 3:30 PM today with Dr. Joseline. Shall I book?",      minsAgo: 29 },
      { role: 'USER',  content: 'Yes please',                                                                                         minsAgo: 25 },
      { role: 'AGENT', content: "Done! Today at 3:30 PM with Dr. Joseline. Come 10 minutes early. Feel better soon! 💙",              minsAgo: 24 },
    ])
    results.push('3 WhatsApp conversations upserted')

    // ── AiAgentConfig ─────────────────────────────────────────────────────────
    const existing = await prisma.aiAgentConfig.findFirst()
    if (!existing) {
      await prisma.aiAgentConfig.create({
        data: {
          name: 'Sarah',
          personality: 'warm, friendly, conversational Ugandan English',
          systemPrompt: `You are Sarah, the patient care assistant for Code Clinic, a dental clinic in Kampala, Uganda. You are warm, friendly, and speak in natural conversational Ugandan English. You help patients book, reschedule, and cancel appointments. You send reminders and follow up after treatment. You know everything about Code Clinic's services, prices, hours, and doctors. When you cannot help, you escalate to a human staff member. Keep responses short — 1 to 3 sentences. Never say you are an AI unless directly asked.`,
          isActive: true,
          escalationPhone: '+256700000001',
          escalationTriggers: JSON.stringify(['urgent', 'emergency', 'complaint', 'angry']),
        },
      })
      results.push('AiAgentConfig (Sarah) created')
    } else {
      results.push('AiAgentConfig already exists — skipped')
    }

    res.json({ success: true, results })
  } catch (err: any) {
    console.error('[Seed] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
