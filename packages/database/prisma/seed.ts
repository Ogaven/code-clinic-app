import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding CodeClinic database...')

  const adminPassword = await bcrypt.hash('Admin@2024!', 12)
  const staffPassword = await bcrypt.hash('Staff@2024!', 12)
  const doctorPassword = await bcrypt.hash('Doctor@2024!', 12)

  // ─── Staff Users ───────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@codeclinic.ug' },
    update: {},
    create: { email: 'admin@codeclinic.ug', passwordHash: adminPassword, role: 'ADMIN', firstName: 'Admin', lastName: 'User', phone: '+256700000001' },
  })
  await prisma.user.upsert({
    where: { email: 'reception@codeclinic.ug' },
    update: {},
    create: { email: 'reception@codeclinic.ug', passwordHash: staffPassword, role: 'RECEPTIONIST', firstName: 'Reception', lastName: 'Staff', phone: '+256700000002' },
  })
  await prisma.user.upsert({
    where: { email: 'accounts@codeclinic.ug' },
    update: {},
    create: { email: 'accounts@codeclinic.ug', passwordHash: staffPassword, role: 'ACCOUNTS', firstName: 'Accounts', lastName: 'Staff', phone: '+256700000003' },
  })
  console.log('✅ Staff users created')

  // ─── Doctors ───────────────────────────────────────────────────
  const doctors = [
    { firstName: 'Steven',   lastName: 'Mugabe',   email: 'steven.mugabe@codeclinic.ug',    specialisation: 'General Dentistry & Oral-Systemic Health', colour: '#4A90D9' },
    { firstName: 'Angella',  lastName: 'Kissa',    email: 'angella.kissa@codeclinic.ug',     specialisation: 'Orthodontics',                               colour: '#E8A838' },
    { firstName: 'Arnold',   lastName: 'Nshimye',  email: 'arnold.nshimye@codeclinic.ug',   specialisation: 'Periodontics',                               colour: '#9B59B6' },
    { firstName: 'Lois',     lastName: 'Kisakye',  email: 'lois.kisakye@codeclinic.ug',     specialisation: 'Paediatric Dentistry',                       colour: '#2ECC71' },
    { firstName: 'Joseline', lastName: 'Babirye',  email: 'joseline.babirye@codeclinic.ug', specialisation: 'Restorative Dentistry',                      colour: '#E74C3C' },
    { firstName: 'Kutesa',   lastName: 'Eben',     email: 'kutesa.eben@codeclinic.ug',      specialisation: 'Oral Surgery',                               colour: '#1ABC9C' },
    { firstName: 'Kajumba',  lastName: 'Faith',    email: 'kajumba.faith@codeclinic.ug',    specialisation: 'Endodontics',                                colour: '#F39C12' },
    { firstName: 'Papa',     lastName: 'Joel',     email: 'papa.joel@codeclinic.ug',        specialisation: 'Prosthodontics',                             colour: '#3498DB' },
  ]
  for (const d of doctors) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: { email: d.email, passwordHash: doctorPassword, role: 'DOCTOR', firstName: d.firstName, lastName: d.lastName },
    })
    await prisma.doctor.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        specialisation: d.specialisation,
        colour: d.colour,
        workingDays: JSON.stringify([1, 2, 3, 4, 5]),
        workingHours: JSON.stringify({ start: '08:00', end: '18:00' }),
      },
    })
  }
  console.log('✅ 8 doctors created')

  // ─── Services ──────────────────────────────────────────────────
  const services = [
    // Consultations
    { category: 'Consultation',  name: 'Check and Treat',              durationMins: 30,  priceUGX: 50000,   colour: '#3498DB' },
    { category: 'Consultation',  name: 'Review Check Up',              durationMins: 20,  priceUGX: 30000,   colour: '#2ECC71' },
    { category: 'Consultation',  name: 'Emergency Dental Consult',     durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
    { category: 'Consultation',  name: 'Second Opinion Consultation',  durationMins: 30,  priceUGX: 40000,   colour: '#3498DB' },
    // Preventive
    { category: 'Preventive',    name: 'Dental Cleaning (Scaling)',    durationMins: 45,  priceUGX: 80000,   colour: '#2ECC71' },
    { category: 'Preventive',    name: 'Fluoride Treatment',           durationMins: 30,  priceUGX: 40000,   colour: '#27AE60' },
    { category: 'Preventive',    name: 'Fissure Sealants',             durationMins: 30,  priceUGX: 50000,   colour: '#27AE60' },
    { category: 'Preventive',    name: 'Dental X-Ray (Periapical)',    durationMins: 15,  priceUGX: 30000,   colour: '#2ECC71' },
    { category: 'Preventive',    name: 'Dental X-Ray (Panoramic)',     durationMins: 15,  priceUGX: 80000,   colour: '#2ECC71' },
    // Restorative
    { category: 'Restorative',   name: 'Dental Filling (Composite)',   durationMins: 45,  priceUGX: 90000,   colour: '#F39C12' },
    { category: 'Restorative',   name: 'Dental Filling (Amalgam)',     durationMins: 45,  priceUGX: 70000,   colour: '#F39C12' },
    { category: 'Restorative',   name: 'Dental Crown (Porcelain)',     durationMins: 90,  priceUGX: 700000,  colour: '#4A90D9' },
    { category: 'Restorative',   name: 'Dental Crown (Metal)',         durationMins: 90,  priceUGX: 500000,  colour: '#4A90D9' },
    { category: 'Restorative',   name: 'Dental Bridge',                durationMins: 90,  priceUGX: 900000,  colour: '#4A90D9' },
    { category: 'Restorative',   name: 'Inlay / Onlay',                durationMins: 60,  priceUGX: 300000,  colour: '#E67E22' },
    // Periodontal
    { category: 'Periodontal',   name: 'Periodontal Therapy',          durationMins: 60,  priceUGX: 120000,  colour: '#9B59B6' },
    { category: 'Periodontal',   name: 'Deep Scaling & Root Planing',  durationMins: 75,  priceUGX: 180000,  colour: '#8E44AD' },
    { category: 'Periodontal',   name: 'Gingivectomy',                 durationMins: 60,  priceUGX: 200000,  colour: '#9B59B6' },
    // Endodontics
    { category: 'Endodontics',   name: 'Root Canal Treatment',         durationMins: 90,  priceUGX: 350000,  colour: '#E8A838' },
    { category: 'Endodontics',   name: 'Root Canal Retreatment',       durationMins: 90,  priceUGX: 420000,  colour: '#E8A838' },
    { category: 'Endodontics',   name: 'Pulp Capping',                 durationMins: 45,  priceUGX: 100000,  colour: '#E8A838' },
    // Oral Surgery
    { category: 'Oral Surgery',  name: 'Tooth Extraction (Simple)',    durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
    { category: 'Oral Surgery',  name: 'Tooth Extraction (Surgical)',  durationMins: 60,  priceUGX: 150000,  colour: '#C0392B' },
    { category: 'Oral Surgery',  name: 'Wisdom Tooth Extraction',      durationMins: 75,  priceUGX: 200000,  colour: '#C0392B' },
    { category: 'Oral Surgery',  name: 'Abscess Drainage',             durationMins: 30,  priceUGX: 80000,   colour: '#E74C3C' },
    { category: 'Oral Surgery',  name: 'Jaw Bone Surgery',             durationMins: 90,  priceUGX: 500000,  colour: '#C0392B' },
    // Cosmetic
    { category: 'Cosmetic',      name: 'Teeth Whitening (In-Chair)',   durationMins: 60,  priceUGX: 250000,  colour: '#1ABC9C' },
    { category: 'Cosmetic',      name: 'Dental Veneers (Porcelain)',   durationMins: 90,  priceUGX: 800000,  colour: '#16A085' },
    { category: 'Cosmetic',      name: 'Dental Bonding',               durationMins: 45,  priceUGX: 120000,  colour: '#1ABC9C' },
    { category: 'Cosmetic',      name: 'Smile Makeover Consult',       durationMins: 45,  priceUGX: 80000,   colour: '#16A085' },
    // Orthodontics
    { category: 'Orthodontics',  name: 'Orthodontic Consultation',     durationMins: 30,  priceUGX: 60000,   colour: '#29ABE2' },
    { category: 'Orthodontics',  name: 'Braces Fitting (Metal)',       durationMins: 90,  priceUGX: 1200000, colour: '#2980B9' },
    { category: 'Orthodontics',  name: 'Braces Adjustment',            durationMins: 30,  priceUGX: 80000,   colour: '#29ABE2' },
    { category: 'Orthodontics',  name: 'Myobrace Treatment',           durationMins: 45,  priceUGX: 250000,  colour: '#29ABE2' },
    { category: 'Orthodontics',  name: 'Retainer Fitting',             durationMins: 45,  priceUGX: 150000,  colour: '#2980B9' },
    // Prosthodontics
    { category: 'Prosthodontics',name: 'Denture (Full)',               durationMins: 60,  priceUGX: 800000,  colour: '#34495E' },
    { category: 'Prosthodontics',name: 'Denture (Partial)',            durationMins: 60,  priceUGX: 500000,  colour: '#34495E' },
    { category: 'Prosthodontics',name: 'Implant Consultation',         durationMins: 45,  priceUGX: 100000,  colour: '#2C3E50' },
    // Paediatric
    { category: 'Paediatric',    name: 'Child Dental Check-Up',        durationMins: 30,  priceUGX: 40000,   colour: '#E91E63' },
    { category: 'Paediatric',    name: 'Child Tooth Extraction',       durationMins: 30,  priceUGX: 50000,   colour: '#E91E63' },
  ]
  for (const s of services) {
    await prisma.service.upsert({
      where: { name: s.name } as any,
      update: { category: s.category },
      create: { name: s.name, category: s.category, durationMins: s.durationMins, priceUGX: s.priceUGX, priceUSD: s.priceUGX / 3700, colour: s.colour, vatApplicable: true },
    })
  }
  console.log(`✅ ${services.length} services created`)

  // ─── Agent Prompts ─────────────────────────────────────────────
  const prompts = [
    { type: 'INBOUND_BOOKING',    name: 'Inbound Booking Agent',       systemPrompt: 'You are Maya, the AI receptionist at Code Clinic, Kampala Uganda. Greet warmly, collect booking details, confirm availability and book appointments.' },
    { type: 'OUTBOUND_REMINDER',  name: 'Appointment Reminder Agent',  systemPrompt: 'You are Maya from Code Clinic calling to remind patients of upcoming appointments. Confirm attendance or reschedule if needed.' },
    { type: 'FOLLOWUP',           name: 'Post-Visit Follow-up Agent',  systemPrompt: 'You are Maya following up after a patient visit. Check on their wellbeing, collect feedback rating 1-5, and offer to book follow-up if needed.' },
    { type: 'DEBT_REMINDER',      name: 'Debt Reminder Agent',         systemPrompt: 'You are Maya calling about an outstanding balance. Be kind and non-confrontational. Offer MTN MoMo, Airtel Money, or in-person payment options.' },
    { type: 'VISITOR_ENGAGEMENT', name: 'Website Visitor Agent',       systemPrompt: 'You are Maya on the Code Clinic website. Help visitors book appointments, learn about services, and capture their contact details.' },
    { type: 'BIRTHDAY',           name: 'Birthday Greeting Agent',     systemPrompt: 'Send a warm birthday message with a 10% discount offer for the month. Keep it personal and celebratory.' },
    { type: 'PROMO',              name: 'Promotional Campaign Agent',  systemPrompt: 'Send promotional messages on behalf of Code Clinic. Include the offer, expiry date, how to book, and opt-out instructions.' },
    { type: 'FAQ',                name: 'FAQ Agent',                   systemPrompt: 'You are Maya answering FAQs using the knowledge base. Clinic hours: Mon-Sat 8am-6pm. Location: Kiira Road, Kamwokya, Kampala.' },
    { type: 'ESCALATION',         name: 'Escalation Handler',          systemPrompt: 'Transfer to human receptionist for distressed patients, complex medical queries, complaints, or when you cannot resolve after 2 attempts.' },
  ]
  for (const p of prompts) {
    await prisma.agentPrompt.upsert({
      where: { type: p.type },
      update: { systemPrompt: p.systemPrompt },
      create: p,
    })
  }
  console.log('✅ 9 agent prompts created')

  // ─── Demo Patients ─────────────────────────────────────────────
  const patientsData = [
    { firstName: 'Sarah',    lastName: 'Namukasa',  phone: '+256701234567', email: 'sarah.n@gmail.com',    gender: 'FEMALE', dob: new Date('1990-03-15') },
    { firstName: 'Robert',   lastName: 'Ssempala',  phone: '+256702345678', email: 'robert.s@gmail.com',   gender: 'MALE',   dob: new Date('1985-07-22') },
    { firstName: 'Grace',    lastName: 'Apio',      phone: '+256703456789', email: null,                   gender: 'FEMALE', dob: new Date('1995-11-08') },
    { firstName: 'Michael',  lastName: 'Okello',    phone: '+256704567890', email: 'mike.o@yahoo.com',     gender: 'MALE',   dob: new Date('1978-01-30') },
    { firstName: 'Patience', lastName: 'Nakato',    phone: '+256705678901', email: null,                   gender: 'FEMALE', dob: new Date('2000-06-12') },
    { firstName: 'Daniel',   lastName: 'Kiggundu',  phone: '+256706789012', email: 'dan.k@gmail.com',      gender: 'MALE',   dob: new Date('1982-09-05') },
    { firstName: 'Esther',   lastName: 'Nalwanga',  phone: '+256707890123', email: 'esther.n@outlook.com', gender: 'FEMALE', dob: new Date('1993-04-18') },
    { firstName: 'Joseph',   lastName: 'Tumwine',   phone: '+256708901234', email: null,                   gender: 'MALE',   dob: new Date('1975-12-25') },
    { firstName: 'Agnes',    lastName: 'Namutebi',  phone: '+256709012345', email: 'agnes.nm@gmail.com',   gender: 'FEMALE', dob: new Date('1988-08-14') },
    { firstName: 'Brian',    lastName: 'Wasswa',    phone: '+256700123456', email: 'brian.w@gmail.com',    gender: 'MALE',   dob: new Date('1997-02-28') },
  ]
  const createdPatients: { id: string; firstName: string; lastName: string }[] = []
  for (const p of patientsData) {
    const pat = await prisma.patient.upsert({
      where: { phone: p.phone },
      update: {},
      create: { firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email ?? undefined, gender: p.gender, dob: p.dob },
    })
    createdPatients.push({ id: pat.id, firstName: p.firstName, lastName: p.lastName })
  }
  console.log(`✅ ${createdPatients.length} demo patients created`)

  // ─── Sample Appointments ───────────────────────────────────────
  // Fetch all doctors and services
  const allDoctors  = await prisma.doctor.findMany({ include: { user: true } })
  const allServices = await prisma.service.findMany({ where: { isActive: true } })

  // Get first admin user as creator
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } })

  if (allDoctors.length && allServices.length && createdPatients.length) {
    // Helper: build a date at specific time today or +N days
    function apptDate(offsetDays: number, hour: number, minute = 0) {
      const d = new Date('2026-04-04T00:00:00')
      d.setDate(d.getDate() + offsetDays)
      d.setHours(hour, minute, 0, 0)
      return d
    }

    function svc(name: string) {
      return allServices.find(s => s.name.includes(name)) ?? allServices[0]
    }
    function doc(firstName: string) {
      return allDoctors.find(d => d.user.firstName === firstName) ?? allDoctors[0]
    }
    function pat(firstName: string) {
      return createdPatients.find(p => p.firstName === firstName) ?? createdPatients[0]
    }

    const appts = [
      // Today — Apr 4
      { patientId: pat('Sarah').id,    doctorId: doc('Steven').id,   serviceId: svc('Check and Treat').id,          startAt: apptDate(0, 8, 0),   status: 'CONFIRMED'  },
      { patientId: pat('Robert').id,   doctorId: doc('Angella').id,  serviceId: svc('Dental Cleaning').id,          startAt: apptDate(0, 8, 30),  status: 'CONFIRMED'  },
      { patientId: pat('Grace').id,    doctorId: doc('Arnold').id,   serviceId: svc('Periodontal Therapy').id,      startAt: apptDate(0, 9, 0),   status: 'PENDING'    },
      { patientId: pat('Michael').id,  doctorId: doc('Lois').id,     serviceId: svc('Child Dental Check').id,       startAt: apptDate(0, 9, 30),  status: 'CONFIRMED'  },
      { patientId: pat('Daniel').id,   doctorId: doc('Steven').id,   serviceId: svc('Root Canal').id,               startAt: apptDate(0, 10, 0),  status: 'IN_PROGRESS'},
      { patientId: pat('Esther').id,   doctorId: doc('Joseline').id, serviceId: svc('Dental Filling (Composite)').id, startAt: apptDate(0, 10, 30), status: 'PENDING'  },
      { patientId: pat('Agnes').id,    doctorId: doc('Kutesa').id,   serviceId: svc('Tooth Extraction (Simple)').id, startAt: apptDate(0, 11, 0),  status: 'CONFIRMED'  },
      { patientId: pat('Brian').id,    doctorId: doc('Kajumba').id,  serviceId: svc('Teeth Whitening').id,           startAt: apptDate(0, 11, 30), status: 'PENDING'    },
      { patientId: pat('Joseph').id,   doctorId: doc('Papa').id,     serviceId: svc('Dental Crown (Porcelain)').id,  startAt: apptDate(0, 14, 0),  status: 'CONFIRMED'  },
      { patientId: pat('Patience').id, doctorId: doc('Arnold').id,   serviceId: svc('Deep Scaling').id,              startAt: apptDate(0, 14, 30), status: 'CONFIRMED'  },
      // Tomorrow — Apr 5
      { patientId: pat('Sarah').id,    doctorId: doc('Angella').id,  serviceId: svc('Braces Adjustment').id,         startAt: apptDate(1, 9, 0),   status: 'CONFIRMED'  },
      { patientId: pat('Robert').id,   doctorId: doc('Steven').id,   serviceId: svc('Review Check Up').id,           startAt: apptDate(1, 9, 30),  status: 'PENDING'    },
      { patientId: pat('Grace').id,    doctorId: doc('Kutesa').id,   serviceId: svc('Wisdom Tooth Extraction').id,   startAt: apptDate(1, 10, 0),  status: 'CONFIRMED'  },
      { patientId: pat('Daniel').id,   doctorId: doc('Kajumba').id,  serviceId: svc('Pulp Capping').id,              startAt: apptDate(1, 11, 0),  status: 'CONFIRMED'  },
      { patientId: pat('Esther').id,   doctorId: doc('Lois').id,     serviceId: svc('Fluoride Treatment').id,        startAt: apptDate(1, 14, 0),  status: 'PENDING'    },
      // Apr 7
      { patientId: pat('Michael').id,  doctorId: doc('Arnold').id,   serviceId: svc('Gingivectomy').id,              startAt: apptDate(3, 9, 0),   status: 'PENDING'    },
      { patientId: pat('Agnes').id,    doctorId: doc('Joseline').id, serviceId: svc('Dental Veneers').id,            startAt: apptDate(3, 10, 0),  status: 'CONFIRMED'  },
      { patientId: pat('Brian').id,    doctorId: doc('Papa').id,     serviceId: svc('Implant Consultation').id,      startAt: apptDate(3, 11, 30), status: 'PENDING'    },
      // Apr 8
      { patientId: pat('Patience').id, doctorId: doc('Steven').id,   serviceId: svc('Smile Makeover').id,            startAt: apptDate(4, 9, 0),   status: 'CONFIRMED'  },
      { patientId: pat('Joseph').id,   doctorId: doc('Angella').id,  serviceId: svc('Myobrace Treatment').id,        startAt: apptDate(4, 10, 30), status: 'PENDING'    },
      // Yesterday (completed)
      { patientId: pat('Sarah').id,    doctorId: doc('Steven').id,   serviceId: svc('Check and Treat').id,           startAt: apptDate(-1, 9, 0),  status: 'COMPLETED'  },
      { patientId: pat('Robert').id,   doctorId: doc('Angella').id,  serviceId: svc('Dental Cleaning').id,           startAt: apptDate(-1, 10, 0), status: 'COMPLETED'  },
      { patientId: pat('Grace').id,    doctorId: doc('Kutesa').id,   serviceId: svc('Tooth Extraction (Simple)').id, startAt: apptDate(-1, 11, 0), status: 'COMPLETED'  },
      { patientId: pat('Michael').id,  doctorId: doc('Lois').id,     serviceId: svc('Child Dental Check').id,        startAt: apptDate(-1, 14, 0), status: 'NO_SHOW'    },
    ]

    let created = 0
    for (const a of appts) {
      const service = allServices.find(s => s.id === a.serviceId) ?? allServices[0]
      const endAt   = new Date(a.startAt.getTime() + service.durationMins * 60_000)
      try {
        await prisma.appointment.upsert({
          where: { doctorId_startAt: { doctorId: a.doctorId, startAt: a.startAt } },
          update: { status: a.status },
          create: {
            patientId:  a.patientId,
            doctorId:   a.doctorId,
            serviceId:  a.serviceId,
            startAt:    a.startAt,
            endAt,
            status:     a.status,
            createdById: adminUser?.id,
          },
        })
        created++
      } catch { /* skip duplicates */ }
    }
    console.log(`✅ ${created} sample appointments created`)
  }

  // ─── AiAgentConfig — Sarah ────────────────────────────────────
  const sarahPrompt = `You are Sarah, the patient care assistant for Code Clinic, a dental clinic in Kampala, Uganda. You are warm, friendly, and speak in natural conversational Ugandan English — not stiff, not formal, not robotic. You genuinely care about every patient. You remember everything about them from previous conversations and refer to their history naturally without making it feel strange. You help patients book, reschedule, and cancel appointments conversationally. You send reminders and follow up after treatment warmly. When discussing outstanding balances you are empathetic and non-judgmental — like a trusted friend helping them sort things out, never making them feel embarrassed. You know everything about Code Clinic's services, prices, hours, and doctors from the knowledge provided to you. When you truly cannot help, you escalate gracefully to a human staff member by saying you will get someone to follow up. You never sign off messages with your name or clinic name. You just end naturally like a real person would in a text conversation. No 'Sarah — Code Clinic', no signatures, no formal closings. You use natural Ugandan conversational English. You can say things like 'sure thing', 'no worries', 'sounds good', 'let me check that for you', 'aah okay', naturally — not scripted phrases. You use emojis sparingly and naturally — only when it genuinely fits the tone, not on every message. You keep responses short and conversational — 1 to 3 sentences maximum unless the patient asks for detail. Never say you are an AI unless directly and explicitly asked. If asked directly, say you are Sarah, Code Clinic's care assistant. Never mention Claude or Anthropic.`

  const existingConfig = await prisma.aiAgentConfig.findFirst()
  if (!existingConfig) {
    await prisma.aiAgentConfig.create({
      data: {
        name: 'Sarah',
        personality: 'warm, friendly, conversational Ugandan English',
        systemPrompt: sarahPrompt,
        isActive: true,
        escalationPhone: '+256700000001',
        escalationTriggers: JSON.stringify(['urgent', 'emergency', 'complaint', 'angry', 'frustrated']),
      },
    })
    console.log('✅ AiAgentConfig (Sarah) created')
  } else {
    console.log('ℹ️  AiAgentConfig already exists — skipping')
  }

  // ─── Demo AI Conversations ─────────────────────────────────────
  const conv1Patient = createdPatients.find(p => p.firstName === 'Sarah') ?? createdPatients[0]
  const conv2Patient = createdPatients.find(p => p.firstName === 'Robert') ?? createdPatients[1]
  const conv3Patient = createdPatients.find(p => p.firstName === 'Grace') ?? createdPatients[2]

  async function upsertConversation(phone: string, channel: string, agentEnabled: boolean, messages: { role: 'USER' | 'AGENT'; content: string; minsAgo: number }[]) {
    const existing = await prisma.aiConversation.findFirst({ where: { phoneNumber: phone, channel } })
    const conv = existing ?? await prisma.aiConversation.create({
      data: { phoneNumber: phone, channel, agentEnabled, status: 'OPEN' },
    })
    for (const m of messages) {
      const existing = await prisma.aiMessage.findFirst({ where: { conversationId: conv.id, role: m.role, content: m.content } })
      if (!existing) {
        const createdAt = new Date(Date.now() - m.minsAgo * 60_000)
        await prisma.aiMessage.create({ data: { conversationId: conv.id, role: m.role, content: m.content, createdAt } })
      }
    }
    return conv
  }

  await upsertConversation(conv1Patient ? (await prisma.patient.findFirst({ where: { firstName: conv1Patient.firstName } }))?.phone ?? '+256701234567' : '+256701234567', 'WHATSAPP', false, [
    { role: 'USER',  content: 'Hi, I need to book a dental cleaning', minsAgo: 45 },
    { role: 'AGENT', content: 'Hi Sarah! Of course 😊 Dental cleaning — great choice. Do you have a preferred doctor, or shall I find whoever is available soonest?', minsAgo: 44 },
    { role: 'USER',  content: 'Anyone is fine', minsAgo: 43 },
    { role: 'AGENT', content: 'Perfect! I found these available slots for *Dental Cleaning (Scaling)* 😊\n\n1. Monday at 9:00 am — Dr Steven Mugabe\n2. Monday at 2:00 pm — Dr Joseline Babirye\n3. Tuesday at 10:00 am — Dr Steven Mugabe\n\nJust reply with the number that works best for you!', minsAgo: 42 },
    { role: 'USER',  content: '1', minsAgo: 40 },
    { role: 'AGENT', content: 'Perfect! You\'re all booked 🎉 *Monday* at *9:00 am* with *Dr Steven Mugabe* for *Dental Cleaning (Scaling)*. We\'ll send you a reminder the day before. See you then!', minsAgo: 39 },
  ])

  await upsertConversation(conv2Patient ? (await prisma.patient.findFirst({ where: { firstName: conv2Patient.firstName } }))?.phone ?? '+256702345678' : '+256702345678', 'WHATSAPP', true, [
    { role: 'USER',  content: 'Hello, I have a toothache that started yesterday. It\'s quite painful', minsAgo: 120 },
    { role: 'AGENT', content: 'Aah Robert, sorry to hear that 😔 Toothaches can be really uncomfortable. We can fit you in for an Emergency Dental Consult today. Would you like to come in this morning or afternoon?', minsAgo: 119 },
    { role: 'USER',  content: 'Morning if possible please', minsAgo: 118 },
    { role: 'AGENT', content: 'Sure thing! I have a slot at 11:00 am with Dr Kutesa Eben. Shall I book that for you?', minsAgo: 117 },
    { role: 'USER',  content: 'Yes please', minsAgo: 116 },
    { role: 'AGENT', content: 'Done! 🎉 *Today* at *11:00 am* with *Dr Kutesa Eben* for *Emergency Dental Consult*. Please arrive 5 minutes early. See you soon Robert, hope you feel better!', minsAgo: 115 },
  ])

  await upsertConversation(conv3Patient ? (await prisma.patient.findFirst({ where: { firstName: conv3Patient.firstName } }))?.phone ?? '+256703456789' : '+256703456789', 'SMS', true, [
    { role: 'USER',  content: 'Can I reschedule my appointment? I can\'t make it tomorrow', minsAgo: 30 },
    { role: 'AGENT', content: 'No worries Grace 😊 I can see your appointment tomorrow at 10:00 am with Dr Kutesa for Wisdom Tooth Extraction. What day or time would work better for you?', minsAgo: 29 },
    { role: 'USER',  content: 'Can we do Thursday morning?', minsAgo: 25 },
    { role: 'AGENT', content: 'Let me check Thursday for you... I have *Thursday at 9:00 am* or *Thursday at 11:00 am* with Dr Kutesa. Which works for you?', minsAgo: 24 },
    { role: 'USER',  content: '9am please', minsAgo: 20 },
    { role: 'AGENT', content: 'Done! Rescheduled to *Thursday* at *9:00 am* with *Dr Kutesa Eben* for *Wisdom Tooth Extraction*. We\'ll remind you the day before. Take care!', minsAgo: 19 },
  ])
  console.log('✅ 3 demo AI conversations created')

  console.log('\n🎉 CodeClinic seeded successfully!')
  console.log('   admin@codeclinic.ug     → Admin@2024!')
  console.log('   reception@codeclinic.ug → Staff@2024!')
  console.log('   accounts@codeclinic.ug  → Staff@2024!')
  console.log('   steven.mugabe@codeclinic.ug → Doctor@2024!')
}

main().catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) }).finally(() => prisma.$disconnect())
