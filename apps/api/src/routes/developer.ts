import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

router.get('/', requireAuth, (_req, res) => res.json({ message: 'Developer endpoints' }))

// POST /developer/seed
// Idempotent — safe to call multiple times. Order: services → patients → appointments → conversations → agent config
router.post('/seed', requireAuth, async (_req, res) => {
  try {
    const results: string[] = []

    // ── 1. Services (seed first so appointments can reference them) ───────────
    const servicesData = [
      { name: 'Dental Checkup & Consultation',        category: 'Consultation',   priceUGX: 80000,   durationMins: 30,  colour: '#3498DB' },
      { name: 'Scaling & Polishing (Teeth Cleaning)', category: 'Preventive',    priceUGX: 100000,  durationMins: 45,  colour: '#2ECC71' },
      { name: 'Dental Filling (Composite)',           category: 'Restorative',   priceUGX: 180000,  durationMins: 60,  colour: '#F39C12' },
      { name: 'Tooth Extraction (Simple)',            category: 'Oral Surgery',  priceUGX: 90000,   durationMins: 30,  colour: '#E74C3C' },
      { name: 'Tooth Extraction (Surgical)',          category: 'Oral Surgery',  priceUGX: 200000,  durationMins: 60,  colour: '#C0392B' },
      { name: 'Root Canal Treatment',                 category: 'Endodontics',   priceUGX: 400000,  durationMins: 90,  colour: '#E8A838' },
      { name: 'Teeth Whitening',                      category: 'Cosmetic',      priceUGX: 350000,  durationMins: 60,  colour: '#1ABC9C' },
      { name: 'Orthodontic Consultation',             category: 'Orthodontics',  priceUGX: 150000,  durationMins: 45,  colour: '#9B59B6' },
      { name: 'Braces Installation',                  category: 'Orthodontics',  priceUGX: 2500000, durationMins: 120, colour: '#8E44AD' },
      { name: 'Periodontal Therapy',                  category: 'Periodontal',   priceUGX: 250000,  durationMins: 60,  colour: '#9B59B6' },
      { name: 'Emergency Dental Consultation',        category: 'Consultation',  priceUGX: 120000,  durationMins: 30,  colour: '#E74C3C' },
      { name: 'Dental Crown',                         category: 'Restorative',   priceUGX: 800000,  durationMins: 90,  colour: '#4A90D9' },
      { name: 'Dental Bridge',                        category: 'Restorative',   priceUGX: 1200000, durationMins: 120, colour: '#4A90D9' },
      { name: 'Dentures (Full)',                      category: 'Prosthodontics',priceUGX: 1500000, durationMins: 90,  colour: '#3498DB' },
      { name: 'Pediatric Dental Checkup',             category: 'Paediatric',    priceUGX: 70000,   durationMins: 30,  colour: '#2ECC71' },
      { name: 'Myobrace Treatment Consultation',      category: 'Orthodontics',  priceUGX: 150000,  durationMins: 45,  colour: '#9B59B6' },
      { name: 'Fluoride Treatment',                   category: 'Preventive',    priceUGX: 80000,   durationMins: 30,  colour: '#27AE60' },
      { name: 'Dental X-Ray',                         category: 'Preventive',    priceUGX: 50000,   durationMins: 15,  colour: '#2ECC71' },
      { name: 'Gum Treatment',                        category: 'Periodontal',   priceUGX: 200000,  durationMins: 60,  colour: '#8E44AD' },
      { name: 'Smile Makeover Consultation',          category: 'Cosmetic',      priceUGX: 150000,  durationMins: 45,  colour: '#1ABC9C' },
    ]
    for (const s of servicesData) {
      await prisma.service.upsert({
        where:  { name: s.name },
        update: { priceUGX: s.priceUGX, durationMins: s.durationMins, category: s.category, colour: s.colour, isActive: true },
        create: { name: s.name, category: s.category, priceUGX: s.priceUGX, priceUSD: s.priceUGX / 3700, durationMins: s.durationMins, colour: s.colour, isActive: true },
      })
    }
    results.push(`${servicesData.length} services upserted`)

    // ── 2. Patients ───────────────────────────────────────────────────────────
    const patientsData = [
      { firstName: 'Sarah',     lastName: 'Namukasa',  phone: '+256700000001', email: 'sarah.namukasa@gmail.com',  gender: 'FEMALE', dob: new Date('1990-03-15'), address: 'Bukoto Estate, Plot 14',   district: 'Kampala', nextOfKinName: 'James Namukasa',    nextOfKinPhone: '+256772000011', nextOfKinRelation: 'Spouse',  allergies: 'Penicillin',           medicalHistory: 'Hypertension' },
      { firstName: 'John',      lastName: 'Ssebulime', phone: '+256700000002', email: 'john.ssebulime@gmail.com',  gender: 'MALE',   dob: new Date('1985-07-22'), address: 'Ntinda, Kiwatule Road',    district: 'Kampala', nextOfKinName: 'Rose Ssebulime',     nextOfKinPhone: '+256772000012', nextOfKinRelation: 'Spouse',  allergies: '',                     medicalHistory: 'Diabetes, Hypertension' },
      { firstName: 'Mary',      lastName: 'Nakato',    phone: '+256700000003', email: null,                        gender: 'FEMALE', dob: new Date('1995-11-08'), address: 'Kawempe, Bwaise II',       district: 'Kampala', nextOfKinName: 'Paul Nakato',        nextOfKinPhone: '+256772000013', nextOfKinRelation: 'Brother', allergies: 'Latex',                medicalHistory: 'Asthma' },
      { firstName: 'Peter',     lastName: 'Ochieng',   phone: '+256700000004', email: 'peter.ochieng@yahoo.com',   gender: 'MALE',   dob: new Date('1978-01-30'), address: 'Naguru, Coronation Ave',   district: 'Kampala', nextOfKinName: 'Diana Ochieng',      nextOfKinPhone: '+256772000014', nextOfKinRelation: 'Spouse',  allergies: 'Aspirin',              medicalHistory: 'Diabetes, Heart Disease' },
      { firstName: 'Grace',     lastName: 'Auma',      phone: '+256700000005', email: null,                        gender: 'FEMALE', dob: new Date('2000-06-12'), address: 'Kireka, Namboole Road',    district: 'Wakiso',  nextOfKinName: 'Susan Auma',         nextOfKinPhone: '+256772000015', nextOfKinRelation: 'Mother',  allergies: '',                     medicalHistory: '' },
    ]
    const createdPatients: { id: string; firstName: string }[] = []
    for (const p of patientsData) {
      const pat = await prisma.patient.upsert({
        where:  { phone: p.phone },
        update: { firstName: p.firstName, lastName: p.lastName, address: p.address, district: p.district, nextOfKinName: p.nextOfKinName, nextOfKinPhone: p.nextOfKinPhone, nextOfKinRelation: p.nextOfKinRelation, allergies: p.allergies || undefined, medicalHistory: p.medicalHistory || undefined },
        create: { firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email ?? undefined, gender: p.gender, dob: p.dob, address: p.address, district: p.district, nextOfKinName: p.nextOfKinName, nextOfKinPhone: p.nextOfKinPhone, nextOfKinRelation: p.nextOfKinRelation, allergies: p.allergies || undefined, medicalHistory: p.medicalHistory || undefined },
      })
      createdPatients.push({ id: pat.id, firstName: p.firstName })
    }
    results.push(`${patientsData.length} patients upserted`)

    // ── 3. Appointments ───────────────────────────────────────────────────────
    const allDoctors  = await prisma.doctor.findMany({ include: { user: true } })
    const allServices = await prisma.service.findMany({ where: { isActive: true } })
    const adminUser   = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'RECEPTIONIST'] } } })

    if (allDoctors.length && allServices.length) {
      function apptDate(offsetDays: number, hour: number, minute = 0) {
        const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(hour, minute, 0, 0); return d
      }
      // exact-name lookup first, then fragment fallback, then first service
      function svc(name: string) {
        return allServices.find(s => s.name === name)
            ?? allServices.find(s => s.name.toLowerCase().includes(name.toLowerCase()))
            ?? allServices[0]
      }
      function doc(i: number) { return allDoctors[i % allDoctors.length] }
      function pat(i: number) { return createdPatients[i % createdPatients.length] }

      const appts = [
        // CONFIRMED — today & near future
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Dental Checkup & Consultation').id,        startAt: apptDate(0,  8,  0), status: 'CONFIRMED'   },
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Scaling & Polishing (Teeth Cleaning)').id, startAt: apptDate(0, 10,  0), status: 'CONFIRMED'   },
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Periodontal Therapy').id,                  startAt: apptDate(2,  9,  0), status: 'CONFIRMED'   },
        { patientId: pat(3).id, doctorId: doc(3).id, serviceId: svc('Root Canal Treatment').id,                 startAt: apptDate(4, 11,  0), status: 'CONFIRMED'   },
        { patientId: pat(4).id, doctorId: doc(4).id, serviceId: svc('Tooth Extraction (Simple)').id,            startAt: apptDate(6,  9,  0), status: 'CONFIRMED'   },
        { patientId: pat(0).id, doctorId: doc(1).id, serviceId: svc('Emergency Dental Consultation').id,        startAt: apptDate(1, 14,  0), status: 'CONFIRMED'   },
        // COMPLETED — past
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Dental Checkup & Consultation').id,        startAt: apptDate(-7,  9, 0), status: 'COMPLETED'   },
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Scaling & Polishing (Teeth Cleaning)').id, startAt: apptDate(-5, 10, 0), status: 'COMPLETED'   },
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Dental Filling (Composite)').id,           startAt: apptDate(-3, 14, 0), status: 'COMPLETED'   },
        { patientId: pat(3).id, doctorId: doc(3).id, serviceId: svc('Teeth Whitening').id,                      startAt: apptDate(-9, 11, 0), status: 'COMPLETED'   },
        // CANCELLED
        { patientId: pat(3).id, doctorId: doc(3).id, serviceId: svc('Orthodontic Consultation').id,             startAt: apptDate(10,  9, 0), status: 'CANCELLED'   },
        { patientId: pat(4).id, doctorId: doc(4).id, serviceId: svc('Dental Crown').id,                         startAt: apptDate(12, 11, 0), status: 'CANCELLED'   },
        // RESCHEDULED
        { patientId: pat(0).id, doctorId: doc(0).id, serviceId: svc('Tooth Extraction (Surgical)').id,          startAt: apptDate(14,  9, 0), status: 'RESCHEDULED' },
        // NO_SHOW
        { patientId: pat(1).id, doctorId: doc(1).id, serviceId: svc('Fluoride Treatment').id,                   startAt: apptDate(-4,  9, 0), status: 'NO_SHOW'     },
        // PENDING — far future
        { patientId: pat(2).id, doctorId: doc(2).id, serviceId: svc('Smile Makeover Consultation').id,          startAt: apptDate(20,  9, 0), status: 'PENDING'     },
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
    } else {
      results.push('appointments skipped — no doctors found (run prisma db seed first)')
    }

    // ── 4. WhatsApp Conversations ─────────────────────────────────────────────
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
      { role: 'USER',  content: 'Hello, I need to book an appointment',                                                                   minsAgo: 45 },
      { role: 'AGENT', content: "Hi! 😊 Thanks for reaching out to Code Clinic, this is Sarah — how may I brighten your smile today?",    minsAgo: 44 },
      { role: 'USER',  content: 'I need a dental checkup',                                                                                minsAgo: 43 },
      { role: 'AGENT', content: 'Perfect! We have slots this week. Would Tuesday at 10am work with Dr. Angella?',                         minsAgo: 42 },
      { role: 'USER',  content: 'Yes that works',                                                                                         minsAgo: 40 },
      { role: 'AGENT', content: "Great! Booked for Tuesday at 10:00 AM with Dr. Angella. See you then! 😊",                               minsAgo: 39 },
    ])
    await upsertConv('+256700000002', [
      { role: 'USER',  content: 'Can I reschedule my appointment?',                                                                        minsAgo: 120 },
      { role: 'AGENT', content: 'Of course John! You have Wednesday at 2pm with Dr. Arnold. What day works better?',                      minsAgo: 119 },
      { role: 'USER',  content: 'Can we do Friday instead?',                                                                               minsAgo: 118 },
      { role: 'AGENT', content: "Done! Moved to Friday at 2:00 PM with Dr. Arnold. Reminder sent 😊",                                     minsAgo: 117 },
    ])
    await upsertConv('+256700000003', [
      { role: 'USER',  content: 'I have a toothache, is there a slot today?',                                                              minsAgo: 30 },
      { role: 'AGENT', content: "Oh no, sorry to hear that 😟 We have a slot at 3:30 PM today with Dr. Joseline. Shall I book?",          minsAgo: 29 },
      { role: 'USER',  content: 'Yes please',                                                                                              minsAgo: 25 },
      { role: 'AGENT', content: "Done! Today at 3:30 PM with Dr. Joseline. Come 10 minutes early. Feel better soon! 💙",                  minsAgo: 24 },
    ])
    results.push('3 WhatsApp conversations upserted')

    // ── 5. AiAgentConfig (Sarah) ──────────────────────────────────────────────
    const sarahPrompt = `You are Sarah, a warm and friendly member of the front desk team at Code Clinic dental clinic in Kampala, Uganda.

IMPORTANT RULES — never break these:
- You are a real human team member, NOT a robot or AI. Never admit to being an AI, a bot, a virtual assistant, or automated in any way. If asked directly, say something like "I'm just one of the girls at the front desk 😄" or "Ha, I wish I was a robot — would make my job easier! I'm very much human 😂"
- Never list your functions or capabilities unprompted. Don't say "I help with bookings, appointment reminders, answering questions..." — that sounds like a robot reading its feature list
- Never use the word "assistant", "care assistant", "virtual", "automated", "AI", "bot", "system"
- Speak naturally like a warm Ugandan front desk receptionist would — casual, friendly, human
- Use light Ugandan English naturally — "How can I help you?" not "How may I assist you?"
- Occasional emojis are fine but don't overdo it
- Short responses — don't write paragraphs when one sentence works
- If someone is new, just warmly greet them and ask how you can help — don't list what you do
- If someone asks what you do, keep it simple: "I mainly help with appointment bookings and answer questions about our services, etc 😊"
- Never reveal technical details — no mention of "reminder system", "scheduling system", "outbound messages" etc.

OPENING MESSAGE when someone texts for the first time:
"Hi! 😊 Thanks for reaching out to Code Clinic, this is Sarah — how may I brighten your smile today?"

PERSONALITY:
- Warm, cheerful, professional but relaxed
- Speaks like a real person — uses contractions, natural flow
- Genuinely cares about patients
- If someone seems in pain or distressed, lead with empathy before anything else
- Light humour when appropriate
- Never robotic, never formal, never stiff

WHAT YOU CAN HELP WITH (but only mention when relevant, never all at once):
- Booking appointments
- Answering questions about services and pricing
- Rescheduling or cancelling appointments
- General questions about the clinic

CLINIC INFO:
- Name: Code Clinic
- Location: Old Kira Road, opposite Police Playground, Kamwokya, Kampala
- Phone: 0741 087667
- Email: dentist@codeclinic.ug
- Website: codeclinic.ug
- Hours: Monday–Friday 8am–6pm, Saturday 9am–2pm`

    const existing = await prisma.aiAgentConfig.findFirst()
    if (!existing) {
      await prisma.aiAgentConfig.create({
        data: {
          name: 'Sarah',
          personality: 'warm, friendly, conversational Ugandan English',
          systemPrompt: sarahPrompt,
          isActive: true,
          escalationPhone: '+256700000001',
          escalationTriggers: JSON.stringify(['urgent', 'emergency', 'complaint', 'angry']),
        },
      })
      results.push('AiAgentConfig (Sarah) created')
    } else {
      await prisma.aiAgentConfig.update({ where: { id: existing.id }, data: { systemPrompt: sarahPrompt } })
      results.push('AiAgentConfig (Sarah) prompt updated')
    }

    res.json({ success: true, results })
  } catch (err: any) {
    console.error('[Seed] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
