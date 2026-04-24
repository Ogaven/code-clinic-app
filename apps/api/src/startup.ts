import { execSync } from 'child_process'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const DB_DIR = path.resolve(__dirname, '../../../packages/database')
const PRISMA_BIN = path.join(DB_DIR, 'node_modules/.bin/prisma')

export async function runStartup() {
  // ── 1. Push schema to DB (works on fresh PostgreSQL, no migration files needed) ──
  try {
    console.log('[startup] Running prisma db push...')
    execSync(`"${PRISMA_BIN}" db push --schema="${path.join(DB_DIR, 'prisma/schema.prisma')}" --accept-data-loss`, {
      stdio: 'inherit',
      env: { ...process.env },
    })
    console.log('[startup] Schema pushed.')
  } catch (err: any) {
    console.error('[startup] DB migration failed but continuing:', err.message)
  }

  // ── 2. Seed if database is empty or sparse ────────────────────
  try {
    const [userCount, patientCount, apptCount] = await Promise.all([
      prisma.user.count(),
      prisma.patient.count(),
      prisma.appointment.count(),
    ])

    if (userCount === 0) {
      console.log('[startup] Empty database — running full seed...')
      await seed()
      console.log('[startup] Seed complete.')
    } else if (patientCount < 30 || apptCount < 30) {
      console.log(`[startup] Sparse data (${patientCount} patients, ${apptCount} appts) — running demo top-up...`)
      await seedDemoData()
      console.log('[startup] Demo top-up complete.')
    } else {
      console.log(`[startup] Database healthy: ${userCount} users, ${patientCount} patients, ${apptCount} appts.`)
    }
  } catch (e: any) {
    console.error('[startup] Seed error:', e.message?.split('\n')[0])
  } finally {
    await prisma.$disconnect()
  }
}

async function seed() {
  const adminPw  = await bcrypt.hash('Admin@2024!', 12)
  const staffPw  = await bcrypt.hash('Staff@2024!', 12)
  const doctorPw = await bcrypt.hash('Doctor@2024!', 12)

  // Staff users
  await prisma.user.upsert({ where: { email: 'admin@codeclinic.ug' },     update: {}, create: { email: 'admin@codeclinic.ug',     passwordHash: adminPw,  role: 'ADMIN',        firstName: 'Admin',     lastName: 'User',  phone: '+256700000001' } })
  await prisma.user.upsert({ where: { email: 'reception@codeclinic.ug' }, update: {}, create: { email: 'reception@codeclinic.ug', passwordHash: staffPw,  role: 'RECEPTIONIST', firstName: 'Reception', lastName: 'Staff', phone: '+256700000002' } })
  await prisma.user.upsert({ where: { email: 'accounts@codeclinic.ug' },  update: {}, create: { email: 'accounts@codeclinic.ug',  passwordHash: staffPw,  role: 'ACCOUNTS',     firstName: 'Accounts',  lastName: 'Staff', phone: '+256700000003' } })
  console.log('[startup] Staff users created.')

  // Doctors
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
      where:  { email: d.email },
      update: {},
      create: { email: d.email, passwordHash: doctorPw, role: 'DOCTOR', firstName: d.firstName, lastName: d.lastName },
    })
    await prisma.doctor.upsert({
      where:  { userId: user.id },
      update: {},
      create: { userId: user.id, specialisation: d.specialisation, colour: d.colour, workingDays: JSON.stringify([1,2,3,4,5]), workingHours: JSON.stringify({ start: '08:00', end: '18:00' }) },
    })
  }
  console.log('[startup] 8 doctors created.')

  // Services
  const services = [
    { category: 'Consultation',   name: 'Check and Treat',              durationMins: 30,  priceUGX: 50000,   colour: '#3498DB' },
    { category: 'Consultation',   name: 'Review Check Up',              durationMins: 20,  priceUGX: 30000,   colour: '#2ECC71' },
    { category: 'Consultation',   name: 'Emergency Dental Consult',     durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
    { category: 'Preventive',     name: 'Dental Cleaning (Scaling)',    durationMins: 45,  priceUGX: 80000,   colour: '#2ECC71' },
    { category: 'Preventive',     name: 'Fluoride Treatment',           durationMins: 30,  priceUGX: 40000,   colour: '#27AE60' },
    { category: 'Preventive',     name: 'Dental X-Ray (Periapical)',    durationMins: 15,  priceUGX: 30000,   colour: '#2ECC71' },
    { category: 'Preventive',     name: 'Dental X-Ray (Panoramic)',     durationMins: 15,  priceUGX: 80000,   colour: '#2ECC71' },
    { category: 'Restorative',    name: 'Dental Filling (Composite)',   durationMins: 45,  priceUGX: 90000,   colour: '#F39C12' },
    { category: 'Restorative',    name: 'Dental Crown (Porcelain)',     durationMins: 90,  priceUGX: 700000,  colour: '#4A90D9' },
    { category: 'Restorative',    name: 'Dental Bridge',                durationMins: 90,  priceUGX: 900000,  colour: '#4A90D9' },
    { category: 'Periodontal',    name: 'Periodontal Therapy',          durationMins: 60,  priceUGX: 120000,  colour: '#9B59B6' },
    { category: 'Periodontal',    name: 'Deep Scaling & Root Planing',  durationMins: 75,  priceUGX: 180000,  colour: '#8E44AD' },
    { category: 'Endodontics',    name: 'Root Canal Treatment',         durationMins: 90,  priceUGX: 350000,  colour: '#E8A838' },
    { category: 'Oral Surgery',   name: 'Tooth Extraction (Simple)',    durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
    { category: 'Oral Surgery',   name: 'Tooth Extraction (Surgical)',  durationMins: 60,  priceUGX: 150000,  colour: '#C0392B' },
    { category: 'Oral Surgery',   name: 'Wisdom Tooth Extraction',      durationMins: 75,  priceUGX: 200000,  colour: '#C0392B' },
    { category: 'Cosmetic',       name: 'Teeth Whitening (In-Chair)',   durationMins: 60,  priceUGX: 250000,  colour: '#1ABC9C' },
    { category: 'Cosmetic',       name: 'Dental Veneers (Porcelain)',   durationMins: 90,  priceUGX: 800000,  colour: '#16A085' },
    { category: 'Orthodontics',   name: 'Braces Fitting (Metal)',       durationMins: 90,  priceUGX: 1200000, colour: '#2980B9' },
    { category: 'Orthodontics',   name: 'Braces Adjustment',            durationMins: 30,  priceUGX: 80000,   colour: '#29ABE2' },
    { category: 'Prosthodontics', name: 'Denture (Full)',               durationMins: 60,  priceUGX: 800000,  colour: '#34495E' },
    { category: 'Paediatric',     name: 'Child Dental Check-Up',        durationMins: 30,  priceUGX: 40000,   colour: '#E91E63' },
    { category: 'Paediatric',     name: 'Child Tooth Extraction',       durationMins: 30,  priceUGX: 50000,   colour: '#E91E63' },
  ]
  for (const s of services) {
    await (prisma.service as any).upsert({
      where:  { name: s.name },
      update: { category: s.category },
      create: { name: s.name, category: s.category, durationMins: s.durationMins, priceUGX: s.priceUGX, priceUSD: s.priceUGX / 3700, colour: s.colour, vatApplicable: true },
    })
  }
  console.log(`[startup] ${services.length} services created.`)

  // Agent prompts
  const prompts = [
    { type: 'INBOUND_BOOKING',    name: 'Inbound Booking Agent',      systemPrompt: 'You are Maya, the AI receptionist at Code Clinic Kampala. Greet warmly, collect booking details, confirm availability and book appointments.' },
    { type: 'OUTBOUND_REMINDER',  name: 'Appointment Reminder Agent', systemPrompt: 'You are Maya from Code Clinic calling to remind patients of upcoming appointments. Confirm attendance or reschedule if needed.' },
    { type: 'FOLLOWUP',           name: 'Post-Visit Follow-up Agent', systemPrompt: 'You are Maya following up after a patient visit. Check wellbeing, collect feedback rating 1-5, and offer to book follow-up if needed.' },
    { type: 'DEBT_REMINDER',      name: 'Debt Reminder Agent',        systemPrompt: 'You are Maya calling about an outstanding balance. Be kind. Offer MTN MoMo, Airtel Money, or in-person payment options.' },
    { type: 'VISITOR_ENGAGEMENT', name: 'Website Visitor Agent',      systemPrompt: 'You are Maya on the Code Clinic website. Help visitors book appointments, learn about services, and capture contact details.' },
    { type: 'BIRTHDAY',           name: 'Birthday Greeting Agent',    systemPrompt: 'Send a warm birthday message with a 10% discount offer for the month. Keep it personal and celebratory.' },
    { type: 'PROMO',              name: 'Promotional Campaign Agent', systemPrompt: 'Send promotional messages for Code Clinic. Include the offer, expiry date, how to book, and opt-out instructions.' },
    { type: 'FAQ',                name: 'FAQ Agent',                  systemPrompt: 'You are Maya answering FAQs. Clinic hours: Mon-Sat 8am-6pm. Location: Kiira Road, Kamwokya, Kampala.' },
    { type: 'ESCALATION',         name: 'Escalation Handler',         systemPrompt: 'Transfer to human receptionist for distressed patients, complex medical queries, complaints, or when unresolvable after 2 attempts.' },
  ]
  for (const p of prompts) {
    await prisma.agentPrompt.upsert({ where: { type: p.type }, update: { systemPrompt: p.systemPrompt }, create: p })
  }
  console.log('[startup] Agent prompts created.')

  // Demo appointments (for today)
  const existingAppts = await prisma.appointment.count()
  if (existingAppts === 0) {
    const allDoctors  = await prisma.doctor.findMany({ include: { user: true }, take: 4 })
    const allPatients = await prisma.patient.findMany({ take: 8 })
    const allServices = await prisma.service.findMany({ take: 10 })
    const adminUser   = await prisma.user.findFirst({ where: { role: 'ADMIN' } })

    if (allDoctors.length && allPatients.length && allServices.length && adminUser) {
      const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
      today.setHours(0, 0, 0, 0)

      const apptSlots = [
        { patientIdx: 0, doctorIdx: 0, serviceIdx: 0,  hourOffset: 8,  min: 0,  status: 'COMPLETED'  as const },
        { patientIdx: 1, doctorIdx: 0, serviceIdx: 3,  hourOffset: 9,  min: 0,  status: 'IN_PROGRESS' as const },
        { patientIdx: 2, doctorIdx: 1, serviceIdx: 10, hourOffset: 9,  min: 30, status: 'CONFIRMED'   as const },
        { patientIdx: 3, doctorIdx: 1, serviceIdx: 13, hourOffset: 10, min: 0,  status: 'CONFIRMED'   as const },
        { patientIdx: 4, doctorIdx: 2, serviceIdx: 6,  hourOffset: 10, min: 30, status: 'PENDING'     as const },
        { patientIdx: 5, doctorIdx: 2, serviceIdx: 16, hourOffset: 11, min: 0,  status: 'PENDING'     as const },
        { patientIdx: 6, doctorIdx: 3, serviceIdx: 1,  hourOffset: 14, min: 0,  status: 'CONFIRMED'   as const },
        { patientIdx: 7, doctorIdx: 3, serviceIdx: 12, hourOffset: 15, min: 0,  status: 'CONFIRMED'   as const },
      ]

      for (const slot of apptSlots) {
        const doctor  = allDoctors[slot.doctorIdx]
        const patient = allPatients[slot.patientIdx]
        const service = allServices[slot.serviceIdx]
        if (!doctor || !patient || !service) continue

        const startAt = new Date(today)
        startAt.setHours(slot.hourOffset, slot.min, 0, 0)
        const endAt   = new Date(startAt.getTime() + service.durationMins * 60000)

        await prisma.appointment.create({
          data: {
            patientId:  patient.id,
            doctorId:   doctor.id,
            serviceId:  service.id,
            startAt,
            endAt,
            status:     slot.status,
            createdById:  adminUser.id,
          },
        })
      }
      console.log('[startup] Demo appointments created.')
    }
  }

  // Demo patients
  const patientsData = [
    { firstName: 'Sarah',    lastName: 'Namukasa', phone: '+256701234567', gender: 'FEMALE', dob: new Date('1990-03-15') },
    { firstName: 'Robert',   lastName: 'Ssempala', phone: '+256702345678', gender: 'MALE',   dob: new Date('1985-07-22') },
    { firstName: 'Grace',    lastName: 'Apio',     phone: '+256703456789', gender: 'FEMALE', dob: new Date('1995-11-08') },
    { firstName: 'Michael',  lastName: 'Okello',   phone: '+256704567890', gender: 'MALE',   dob: new Date('1978-01-30') },
    { firstName: 'Patience', lastName: 'Nakato',   phone: '+256705678901', gender: 'FEMALE', dob: new Date('2000-06-12') },
    { firstName: 'Daniel',   lastName: 'Kiggundu', phone: '+256706789012', gender: 'MALE',   dob: new Date('1982-09-05') },
    { firstName: 'Esther',   lastName: 'Nalwanga', phone: '+256707890123', gender: 'FEMALE', dob: new Date('1993-04-18') },
    { firstName: 'Joseph',   lastName: 'Tumwine',  phone: '+256708901234', gender: 'MALE',   dob: new Date('1975-12-25') },
    { firstName: 'Agnes',    lastName: 'Namutebi', phone: '+256709012345', gender: 'FEMALE', dob: new Date('1988-08-14') },
    { firstName: 'Brian',    lastName: 'Wasswa',   phone: '+256700123456', gender: 'MALE',   dob: new Date('1997-02-28') },
  ]
  for (const p of patientsData) {
    await prisma.patient.upsert({ where: { phone: p.phone }, update: {}, create: p })
  }
  console.log('[startup] Demo patients created.')

  console.log('\n[startup] Seed done!')
  console.log('   admin@codeclinic.ug     → Admin@2024!')
  console.log('   reception@codeclinic.ug → Staff@2024!')
  console.log('   accounts@codeclinic.ug  → Staff@2024!')
  await seedDemoData()
}

export async function seedDemoData() {
  const allDoctors  = await prisma.doctor.findMany({ include: { user: true } })
  const allServices = await prisma.service.findMany()
  const adminUser   = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!allDoctors.length || !allServices.length || !adminUser) return

  // 45 demo patients with Ugandan names
  const patientList = [
    { firstName: 'Sarah',      lastName: 'Namukasa',   phone: '+256701234567', gender: 'FEMALE', dob: new Date('1990-03-15') },
    { firstName: 'Robert',     lastName: 'Ssempala',   phone: '+256702345678', gender: 'MALE',   dob: new Date('1985-07-22') },
    { firstName: 'Grace',      lastName: 'Apio',       phone: '+256703456789', gender: 'FEMALE', dob: new Date('1995-11-08') },
    { firstName: 'Michael',    lastName: 'Okello',     phone: '+256704567890', gender: 'MALE',   dob: new Date('1978-01-30') },
    { firstName: 'Patience',   lastName: 'Nakato',     phone: '+256705678901', gender: 'FEMALE', dob: new Date('2000-06-12') },
    { firstName: 'Daniel',     lastName: 'Kiggundu',   phone: '+256706789012', gender: 'MALE',   dob: new Date('1982-09-05') },
    { firstName: 'Esther',     lastName: 'Nalwanga',   phone: '+256707890123', gender: 'FEMALE', dob: new Date('1993-04-18') },
    { firstName: 'Joseph',     lastName: 'Tumwine',    phone: '+256708901234', gender: 'MALE',   dob: new Date('1975-12-25') },
    { firstName: 'Agnes',      lastName: 'Namutebi',   phone: '+256709012345', gender: 'FEMALE', dob: new Date('1988-08-14') },
    { firstName: 'Brian',      lastName: 'Wasswa',     phone: '+256700123456', gender: 'MALE',   dob: new Date('1997-02-28') },
    { firstName: 'Hilda',      lastName: 'Nakirya',    phone: '+256701111111', gender: 'FEMALE', dob: new Date('1991-05-20') },
    { firstName: 'Emmanuel',   lastName: 'Muwanga',    phone: '+256702222222', gender: 'MALE',   dob: new Date('1983-09-14') },
    { firstName: 'Lydia',      lastName: 'Atuhaire',   phone: '+256703333333', gender: 'FEMALE', dob: new Date('1996-02-07') },
    { firstName: 'Patrick',    lastName: 'Kyagulanyi', phone: '+256704444444', gender: 'MALE',   dob: new Date('1979-11-30') },
    { firstName: 'Judith',     lastName: 'Nambi',      phone: '+256705555555', gender: 'FEMALE', dob: new Date('2001-08-22') },
    { firstName: 'Samuel',     lastName: 'Opio',       phone: '+256706666666', gender: 'MALE',   dob: new Date('1987-04-03') },
    { firstName: 'Barbra',     lastName: 'Nansubuga',  phone: '+256707777777', gender: 'FEMALE', dob: new Date('1994-07-16') },
    { firstName: 'Denis',      lastName: 'Byaruhanga', phone: '+256708888888', gender: 'MALE',   dob: new Date('1980-01-09') },
    { firstName: 'Christine',  lastName: 'Akullu',     phone: '+256709999999', gender: 'FEMALE', dob: new Date('1999-10-28') },
    { firstName: 'Ivan',       lastName: 'Nkurunziza', phone: '+256700000011', gender: 'MALE',   dob: new Date('1992-06-11') },
    { firstName: 'Winnie',     lastName: 'Namaganda',  phone: '+256700000012', gender: 'FEMALE', dob: new Date('1986-03-24') },
    { firstName: 'Godfrey',    lastName: 'Ssali',      phone: '+256700000013', gender: 'MALE',   dob: new Date('1974-12-17') },
    { firstName: 'Rachael',    lastName: 'Nakigozi',   phone: '+256700000014', gender: 'FEMALE', dob: new Date('1998-09-05') },
    { firstName: 'Moses',      lastName: 'Otim',       phone: '+256700000015', gender: 'MALE',   dob: new Date('1976-07-31') },
    { firstName: 'Florence',   lastName: 'Nabbosa',    phone: '+256700000016', gender: 'FEMALE', dob: new Date('2002-04-14') },
    { firstName: 'Stephen',    lastName: 'Mugisha',    phone: '+256700000017', gender: 'MALE',   dob: new Date('1989-11-02') },
    { firstName: 'Doreen',     lastName: 'Nanteza',    phone: '+256700000018', gender: 'FEMALE', dob: new Date('1995-08-19') },
    { firstName: 'Paul',       lastName: 'Katumba',    phone: '+256700000019', gender: 'MALE',   dob: new Date('1981-02-26') },
    { firstName: 'Irene',      lastName: 'Nabukeera',  phone: '+256700000020', gender: 'FEMALE', dob: new Date('1993-05-08') },
    { firstName: 'Andrew',     lastName: 'Kiberu',     phone: '+256700000021', gender: 'MALE',   dob: new Date('1984-10-15') },
    { firstName: 'Rose',       lastName: 'Nakimera',   phone: '+256700000022', gender: 'FEMALE', dob: new Date('1997-01-21') },
    { firstName: 'James',      lastName: 'Kabuura',    phone: '+256700000023', gender: 'MALE',   dob: new Date('1977-06-04') },
    { firstName: 'Sylvia',     lastName: 'Nampijja',   phone: '+256700000024', gender: 'FEMALE', dob: new Date('2000-12-30') },
    { firstName: 'Ronald',     lastName: 'Mubiru',     phone: '+256700000025', gender: 'MALE',   dob: new Date('1991-03-17') },
    { firstName: 'Annet',      lastName: 'Nabulime',   phone: '+256700000026', gender: 'FEMALE', dob: new Date('1985-09-23') },
    { firstName: 'Geoffrey',   lastName: 'Musoke',     phone: '+256700000027', gender: 'MALE',   dob: new Date('1973-07-08') },
    { firstName: 'Harriet',    lastName: 'Nagawa',     phone: '+256700000028', gender: 'FEMALE', dob: new Date('1999-04-01') },
    { firstName: 'Charles',    lastName: 'Lutalo',     phone: '+256700000029', gender: 'MALE',   dob: new Date('1988-11-14') },
    { firstName: 'Viola',      lastName: 'Nakayiza',   phone: '+256700000030', gender: 'FEMALE', dob: new Date('1996-06-27') },
    { firstName: 'Julius',     lastName: 'Kasozi',     phone: '+256700000031', gender: 'MALE',   dob: new Date('1983-01-19') },
    { firstName: 'Robinah',    lastName: 'Namulondo',  phone: '+256700000032', gender: 'FEMALE', dob: new Date('1990-08-06') },
    { firstName: 'Nicholas',   lastName: 'Ssentamu',   phone: '+256700000033', gender: 'MALE',   dob: new Date('1978-03-12') },
    { firstName: 'Edith',      lastName: 'Namazzi',    phone: '+256700000034', gender: 'FEMALE', dob: new Date('2003-10-25') },
    { firstName: 'David',      lastName: 'Ssekamate',  phone: '+256700000035', gender: 'MALE',   dob: new Date('1986-05-09') },
    { firstName: 'Proscovia',  lastName: 'Namusisi',   phone: '+256700000036', gender: 'FEMALE', dob: new Date('1994-02-18') },
  ]
  const upsertedPatients: any[] = []
  for (const p of patientList) {
    const pt = await prisma.patient.upsert({ where: { phone: p.phone }, update: {}, create: p })
    upsertedPatients.push(pt)
  }
  console.log(`[startup] ${upsertedPatients.length} patients upserted.`)

  // Appointments: 2-4 per patient spread over last 90 days + next 30 days
  const existingAppts = await prisma.appointment.count()
  if (existingAppts < 30) {
    const statuses = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'CONFIRMED', 'PENDING', 'NO_SHOW']
    const now = new Date()
    let created = 0
    for (let i = 0; i < upsertedPatients.length; i++) {
      const patient = upsertedPatients[i]
      const doctor  = allDoctors[i % allDoctors.length]
      const svc     = allServices[i % allServices.length]
      // Past appointment
      const pastDate = new Date(now.getTime() - (Math.floor(Math.random() * 60) + 1) * 86400000)
      await prisma.appointment.create({
        data: {
          patientId: patient.id, doctorId: doctor.id, serviceId: svc.id,
          startAt: pastDate, endAt: new Date(pastDate.getTime() + svc.durationMins * 60000),
          status: 'COMPLETED', createdById: adminUser.id,
        },
      }).catch(() => {})
      // Future appointment
      const futureDate = new Date(now.getTime() + (i % 14 + 1) * 86400000)
      futureDate.setHours(8 + (i % 9), (i % 2) * 30, 0, 0)
      await prisma.appointment.create({
        data: {
          patientId: patient.id, doctorId: doctor.id, serviceId: svc.id,
          startAt: futureDate, endAt: new Date(futureDate.getTime() + svc.durationMins * 60000),
          status: statuses[i % statuses.length] as any, createdById: adminUser.id,
        },
      }).catch(() => {})
      created += 2
    }
    console.log(`[startup] ~${created} demo appointments created.`)
  }

  // Dental charts for all patients
  const teethNums = ['11','12','13','14','15','16','17','18','21','22','23','24','25','26','27','28',
                     '31','32','33','34','35','36','37','38','41','42','43','44','45','46','47','48']
  const surfaces  = ['occlusal','buccal','lingual','mesial','distal']
  const statsList = ['Healthy','Healthy','Healthy','Caries','Composite','Amalgam','Sealant']
  const conditions = [[], [], ['Root Canal'], ['Crown'], ['Missing'], []]

  for (const patient of upsertedPatients) {
    const existing = await prisma.dentalChart.findFirst({ where: { patientId: patient.id } })
    if (existing) continue
    const teeth: Record<string, any> = {}
    for (const t of teethNums.slice(0, 20 + (patient.id.charCodeAt(0) % 12))) {
      const cIdx = patient.id.charCodeAt(0) % conditions.length
      teeth[t] = {
        conditions: conditions[cIdx].map((c: string, i: number) => ({ id: `${c}-${i}`, condition: c })),
        surfaces:   Object.fromEntries(surfaces.map(s => [s, statsList[(t.charCodeAt(0) + s.length) % statsList.length]])),
        notes:      '',
        history:    [],
      }
    }
    await prisma.dentalChart.create({
      data: { patientId: patient.id, teeth: JSON.stringify(teeth) },
    }).catch(() => {})
  }
  console.log('[startup] Dental charts seeded.')

  // Treatment plans
  const treatmentTypes = [
    { title: 'Composite Filling — Tooth 16', status: 'PLANNED',    cost: 90000  },
    { title: 'Dental Cleaning (Scaling)',     status: 'COMPLETED',  cost: 80000  },
    { title: 'Root Canal — Tooth 26',         status: 'IN_PROGRESS',cost: 350000 },
    { title: 'Crown — Tooth 36',              status: 'PLANNED',    cost: 700000 },
    { title: 'Teeth Whitening',               status: 'COMPLETED',  cost: 250000 },
  ]
  for (const patient of upsertedPatients) {
    const tpCount = await prisma.treatmentPlan.count({ where: { patientId: patient.id } })
    if (tpCount >= 2) continue
    const doctor = allDoctors[patient.id.charCodeAt(0) % allDoctors.length]
    for (let i = 0; i < 3; i++) {
      const tp = treatmentTypes[(patient.id.charCodeAt(0) + i) % treatmentTypes.length]
      await prisma.treatmentPlan.create({
        data: {
          patientId: patient.id, doctorId: doctor.id,
          title: tp.title, status: tp.status as any,
          estimatedCost: tp.cost, currency: 'UGX',
        },
      }).catch(() => {})
    }
  }
  console.log('[startup] Treatment plans seeded.')
}
