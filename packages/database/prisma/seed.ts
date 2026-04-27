import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding CodeClinic database...')

  // ─── Passwords ─────────────────────────────────────────────
  const adminPassword  = await bcrypt.hash('CodeClinic2026!', 12)
  const staffPassword  = await bcrypt.hash('Staff@2024!', 12)
  const doctorPassword = await bcrypt.hash('Doctor@2024!', 12)

  // ─── Staff Users ───────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where:  { email: 'admin@codeclinic.ug' },
    update: { passwordHash: adminPassword, firstName: 'Code Clinic', lastName: 'Admin' },
    create: { email: 'admin@codeclinic.ug', passwordHash: adminPassword, role: 'ADMIN', firstName: 'Code Clinic', lastName: 'Admin', phone: '+256700000001' },
  })
  await prisma.user.upsert({
    where:  { email: 'reception@codeclinic.ug' },
    update: {},
    create: { email: 'reception@codeclinic.ug', passwordHash: staffPassword, role: 'RECEPTIONIST', firstName: 'Reception', lastName: 'Staff', phone: '+256700000002' },
  })
  await prisma.user.upsert({
    where:  { email: 'accounts@codeclinic.ug' },
    update: {},
    create: { email: 'accounts@codeclinic.ug', passwordHash: staffPassword, role: 'ACCOUNTS', firstName: 'Accounts', lastName: 'Staff', phone: '+256700000003' },
  })
  console.log('✅ Staff users created (admin@codeclinic.ug / CodeClinic2026!)')

  // ─── Doctors ───────────────────────────────────────────────────────────────
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
      create: { email: d.email, passwordHash: doctorPassword, role: 'DOCTOR', firstName: d.firstName, lastName: d.lastName },
    })
    await prisma.doctor.upsert({
      where:  { userId: user.id },
      update: {},
      create: {
        userId:       user.id,
        specialisation: d.specialisation,
        colour:       d.colour,
        workingDays:  JSON.stringify([1, 2, 3, 4, 5]),
        workingHours: JSON.stringify({ start: '08:00', end: '18:00' }),
      },
    })
  }
  console.log('✅ 8 doctors created')

  // ─── Services ──────────────────────────────────────────────────────────────
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
    { category: 'Prosthodontics', name: 'Denture (Full)',              durationMins: 60,  priceUGX: 800000,  colour: '#34495E' },
    { category: 'Prosthodontics', name: 'Denture (Partial)',           durationMins: 60,  priceUGX: 500000,  colour: '#34495E' },
    { category: 'Prosthodontics', name: 'Implant Consultation',        durationMins: 45,  priceUGX: 100000,  colour: '#2C3E50' },
    // Paediatric
    { category: 'Paediatric',    name: 'Child Dental Check-Up',        durationMins: 30,  priceUGX: 40000,   colour: '#E91E63' },
    { category: 'Paediatric',    name: 'Child Tooth Extraction',       durationMins: 30,  priceUGX: 50000,   colour: '#E91E63' },
  ]
  for (const s of services) {
    await prisma.service.upsert({
      where:  { name: s.name } as any,
      update: { category: s.category },
      create: { name: s.name, category: s.category, durationMins: s.durationMins, priceUGX: s.priceUGX, priceUSD: s.priceUGX / 3700, colour: s.colour, vatApplicable: true },
    })
  }
  console.log(`✅ ${services.length} services created`)

  // ─── Agent Prompts ─────────────────────────────────────────────────────────
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
      where:  { type: p.type },
      update: { systemPrompt: p.systemPrompt },
      create: p,
    })
  }
  console.log('✅ 9 agent prompts created')

  // ─── Demo Patients (10 realistic Ugandan names) ────────────────────────────
  const patientsData = [
    { firstName: 'Sarah',     lastName: 'Namukasa',  phone: '+256700000001', email: 'sarah.namukasa@gmail.com',  gender: 'FEMALE', dob: new Date('1990-03-15'), address: 'Bukoto Estate, Plot 14',  district: 'Kampala',  nextOfKinName: 'James Namukasa',    nextOfKinPhone: '+256772000011', nextOfKinRelation: 'Spouse',   allergies: 'Penicillin',          medicalHistory: 'Hypertension' },
    { firstName: 'John',      lastName: 'Ssebulime', phone: '+256700000002', email: 'john.ssebulime@gmail.com',  gender: 'MALE',   dob: new Date('1985-07-22'), address: 'Ntinda, Kiwatule Road',   district: 'Kampala',  nextOfKinName: 'Rose Ssebulime',     nextOfKinPhone: '+256772000012', nextOfKinRelation: 'Spouse',   allergies: '',                    medicalHistory: 'Diabetes, Hypertension' },
    { firstName: 'Mary',      lastName: 'Nakato',    phone: '+256700000003', email: null,                        gender: 'FEMALE', dob: new Date('1995-11-08'), address: 'Kawempe, Bwaise II',      district: 'Kampala',  nextOfKinName: 'Paul Nakato',        nextOfKinPhone: '+256772000013', nextOfKinRelation: 'Brother',  allergies: 'Latex',               medicalHistory: 'Asthma' },
    { firstName: 'Peter',     lastName: 'Ochieng',   phone: '+256700000004', email: 'peter.ochieng@yahoo.com',   gender: 'MALE',   dob: new Date('1978-01-30'), address: 'Naguru, Coronation Ave',  district: 'Kampala',  nextOfKinName: 'Diana Ochieng',      nextOfKinPhone: '+256772000014', nextOfKinRelation: 'Spouse',   allergies: 'Aspirin',             medicalHistory: 'Diabetes, Heart Disease' },
    { firstName: 'Grace',     lastName: 'Auma',      phone: '+256700000005', email: null,                        gender: 'FEMALE', dob: new Date('2000-06-12'), address: 'Kireka, Namboole Road',   district: 'Wakiso',   nextOfKinName: 'Susan Auma',         nextOfKinPhone: '+256772000015', nextOfKinRelation: 'Mother',   allergies: '',                    medicalHistory: '' },
    { firstName: 'David',     lastName: 'Mukasa',    phone: '+256700000006', email: 'david.mukasa@gmail.com',    gender: 'MALE',   dob: new Date('1982-09-05'), address: 'Muyenga, Tank Hill',      district: 'Kampala',  nextOfKinName: 'Lydia Mukasa',       nextOfKinPhone: '+256772000016', nextOfKinRelation: 'Spouse',   allergies: '',                    medicalHistory: 'Ulcers' },
    { firstName: 'Agnes',     lastName: 'Namutebi',  phone: '+256700000007', email: 'agnes.namutebi@gmail.com',  gender: 'FEMALE', dob: new Date('1988-08-14'), address: 'Makindye, Salama Road',   district: 'Kampala',  nextOfKinName: 'Fred Namutebi',      nextOfKinPhone: '+256772000017', nextOfKinRelation: 'Spouse',   allergies: 'Ibuprofen',           medicalHistory: 'Hypertension, Kidney Disease' },
    { firstName: 'Robert',    lastName: 'Ssemanda',  phone: '+256700000008', email: null,                        gender: 'MALE',   dob: new Date('1975-12-25'), address: 'Entebbe Road, Zana',      district: 'Wakiso',   nextOfKinName: 'Catherine Ssemanda', nextOfKinPhone: '+256772000018', nextOfKinRelation: 'Spouse',   allergies: '',                    medicalHistory: 'Diabetes, Arthritis' },
    { firstName: 'Christine', lastName: 'Nabwire',   phone: '+256700000009', email: 'c.nabwire@outlook.com',     gender: 'FEMALE', dob: new Date('1993-04-18'), address: 'Kololo, Upper Kololo Tce',district: 'Kampala',  nextOfKinName: 'Tom Nabwire',        nextOfKinPhone: '+256772000019', nextOfKinRelation: 'Parent',   allergies: '',                    medicalHistory: '' },
    { firstName: 'Moses',     lastName: 'Opio',      phone: '+256700000010', email: 'moses.opio@gmail.com',      gender: 'MALE',   dob: new Date('1997-02-28'), address: 'Gulu Road, Lira',         district: 'Lira',     nextOfKinName: 'Esther Opio',        nextOfKinPhone: '+256772000020', nextOfKinRelation: 'Sibling',  allergies: '',                    medicalHistory: 'Epilepsy' },
  ]
  const createdPatients: { id: string; firstName: string; lastName: string }[] = []
  for (const p of patientsData) {
    const pat = await prisma.patient.upsert({
      where:  { phone: p.phone },
      update: { firstName: p.firstName, lastName: p.lastName, address: p.address, district: p.district, nextOfKinName: p.nextOfKinName, nextOfKinPhone: p.nextOfKinPhone, nextOfKinRelation: p.nextOfKinRelation, allergies: p.allergies || undefined, medicalHistory: p.medicalHistory || undefined },
      create: { firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email ?? undefined, gender: p.gender, dob: p.dob, address: p.address, district: p.district, nextOfKinName: p.nextOfKinName, nextOfKinPhone: p.nextOfKinPhone, nextOfKinRelation: p.nextOfKinRelation, allergies: p.allergies || undefined, medicalHistory: p.medicalHistory || undefined },
    })
    createdPatients.push({ id: pat.id, firstName: p.firstName, lastName: p.lastName })
  }
  console.log(`✅ ${createdPatients.length} demo patients created`)

  // ─── Sample Appointments (15 total, spread over next 30 days) ─────────────
  const allDoctors  = await prisma.doctor.findMany({ include: { user: true } })
  const allServices = await prisma.service.findMany({ where: { isActive: true } })
  const adminUser   = await prisma.user.findFirst({ where: { role: 'ADMIN' } })

  if (allDoctors.length && allServices.length && createdPatients.length) {
    // Build date relative to today so appointments always show current data
    function apptDate(offsetDays: number, hour: number, minute = 0) {
      const d = new Date()
      d.setDate(d.getDate() + offsetDays)
      d.setHours(hour, minute, 0, 0)
      return d
    }
    function svc(name: string) { return allServices.find(s => s.name.includes(name)) ?? allServices[0] }
    function doc(firstName: string) { return allDoctors.find(d => d.user.firstName === firstName) ?? allDoctors[0] }
    function pat(firstName: string) { return createdPatients.find(p => p.firstName === firstName) ?? createdPatients[0] }

    // 15 appointments: 5 confirmed, 3 completed, 2 cancelled, 2 rescheduled, 2 no-show, 1 pending
    const appts = [
      // ── CONFIRMED (today + near future) ──────────────────────────────────
      { patientId: pat('Sarah').id,     doctorId: doc('Angella').id,  serviceId: svc('Check and Treat').id,          startAt: apptDate(0,  8,  0),  status: 'CONFIRMED'   },
      { patientId: pat('John').id,      doctorId: doc('Steven').id,   serviceId: svc('Dental Cleaning').id,          startAt: apptDate(0, 10,  0),  status: 'CONFIRMED'   },
      { patientId: pat('Grace').id,     doctorId: doc('Arnold').id,   serviceId: svc('Periodontal Therapy').id,      startAt: apptDate(0, 14,  0),  status: 'CONFIRMED'   },
      { patientId: pat('Mary').id,      doctorId: doc('Joseline').id, serviceId: svc('Dental Filling (Composite)').id, startAt: apptDate(3,  9, 0), status: 'CONFIRMED'   },
      { patientId: pat('David').id,     doctorId: doc('Kutesa').id,   serviceId: svc('Tooth Extraction (Simple)').id,  startAt: apptDate(5, 11, 0), status: 'CONFIRMED'   },
      // ── COMPLETED (past appointments) ────────────────────────────────────
      { patientId: pat('Agnes').id,     doctorId: doc('Steven').id,   serviceId: svc('Check and Treat').id,          startAt: apptDate(-7,  9, 0),  status: 'COMPLETED'   },
      { patientId: pat('Peter').id,     doctorId: doc('Lois').id,     serviceId: svc('Child Dental Check').id,       startAt: apptDate(-5, 10, 0),  status: 'COMPLETED'   },
      { patientId: pat('Robert').id,    doctorId: doc('Kajumba').id,  serviceId: svc('Root Canal Treatment').id,     startAt: apptDate(-3, 14, 0),  status: 'COMPLETED'   },
      // ── CANCELLED ────────────────────────────────────────────────────────
      { patientId: pat('Christine').id, doctorId: doc('Papa').id,     serviceId: svc('Implant Consultation').id,     startAt: apptDate(7,  9, 0),   status: 'CANCELLED'   },
      { patientId: pat('Moses').id,     doctorId: doc('Angella').id,  serviceId: svc('Orthodontic Consultation').id, startAt: apptDate(10, 11, 0),  status: 'CANCELLED'   },
      // ── RESCHEDULED ──────────────────────────────────────────────────────
      { patientId: pat('John').id,      doctorId: doc('Arnold').id,   serviceId: svc('Gingivectomy').id,             startAt: apptDate(12, 14, 0),  status: 'RESCHEDULED' },
      { patientId: pat('Grace').id,     doctorId: doc('Kutesa').id,   serviceId: svc('Wisdom Tooth Extraction').id,  startAt: apptDate(15,  9, 0),  status: 'RESCHEDULED' },
      // ── NO_SHOW ───────────────────────────────────────────────────────────
      { patientId: pat('Mary').id,      doctorId: doc('Lois').id,     serviceId: svc('Fluoride Treatment').id,       startAt: apptDate(-4,  9, 0),  status: 'NO_SHOW'     },
      { patientId: pat('Peter').id,     doctorId: doc('Joseline').id, serviceId: svc('Dental Veneers').id,           startAt: apptDate(-2, 11, 0),  status: 'NO_SHOW'     },
      // ── PENDING ───────────────────────────────────────────────────────────
      { patientId: pat('Moses').id,     doctorId: doc('Steven').id,   serviceId: svc('Teeth Whitening').id,          startAt: apptDate(20,  9, 0),  status: 'PENDING'     },
    ]

    let created = 0
    for (const a of appts) {
      const service = allServices.find(s => s.id === a.serviceId) ?? allServices[0]
      const endAt   = new Date(a.startAt.getTime() + service.durationMins * 60_000)
      try {
        await prisma.appointment.upsert({
          where:  { doctorId_startAt: { doctorId: a.doctorId, startAt: a.startAt } },
          update: { status: a.status },
          create: {
            patientId: a.patientId,
            doctorId:  a.doctorId,
            serviceId: a.serviceId,
            startAt:   a.startAt,
            endAt,
            status:    a.status,
            createdById: adminUser?.id,
          },
        })
        created++
      } catch { /* skip duplicates */ }
    }
    console.log(`✅ ${created} sample appointments created (5 confirmed · 3 completed · 2 cancelled · 2 rescheduled · 2 no-show · 1 pending)`)
  }

  // ─── AiAgentConfig — Sarah ─────────────────────────────────────────────────
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
    await prisma.aiAgentConfig.update({ where: { id: existingConfig.id }, data: { systemPrompt: sarahPrompt } })
    console.log('✅ AiAgentConfig (Sarah) prompt updated')
  }

  // ─── Demo AI Conversations ─────────────────────────────────────────────────
  async function upsertConversation(
    phone: string,
    channel: string,
    agentEnabled: boolean,
    messages: { role: 'USER' | 'AGENT'; content: string; minsAgo: number }[],
  ) {
    const existing = await prisma.aiConversation.findFirst({ where: { phoneNumber: phone, channel } })
    const conv = existing ?? await prisma.aiConversation.create({
      data: { phoneNumber: phone, channel, agentEnabled, status: 'ACTIVE' },
    })
    for (const m of messages) {
      const dup = await prisma.aiMessage.findFirst({ where: { conversationId: conv.id, role: m.role, content: m.content } })
      if (!dup) {
        const createdAt = new Date(Date.now() - m.minsAgo * 60_000)
        await prisma.aiMessage.create({ data: { conversationId: conv.id, role: m.role, content: m.content, createdAt } })
      }
    }
    return conv
  }

  // Sarah Namukasa — booking via WhatsApp
  await upsertConversation('+256700000001', 'WHATSAPP', false, [
    { role: 'USER',  content: 'Hello, I need to book an appointment',                                                                                        minsAgo: 45 },
    { role: 'AGENT', content: "Hi Sarah! Welcome to Code Clinic 😊 I'd be happy to help you book an appointment. Which service are you looking for?",         minsAgo: 44 },
    { role: 'USER',  content: 'I need a dental checkup',                                                                                                      minsAgo: 43 },
    { role: 'AGENT', content: 'Perfect! We have slots available this week. Would Tuesday at 10am work for you with Dr. Angella?',                              minsAgo: 42 },
    { role: 'USER',  content: 'Yes that works',                                                                                                               minsAgo: 40 },
    { role: 'AGENT', content: "Great! I've booked you in for Tuesday at 10:00 AM with Dr. Angella for a Dental Checkup. See you then! 😊",                    minsAgo: 39 },
  ])

  // John Ssebulime — reschedule via WhatsApp
  await upsertConversation('+256700000002', 'WHATSAPP', true, [
    { role: 'USER',  content: 'Can I reschedule my appointment?',                                                                                             minsAgo: 120 },
    { role: 'AGENT', content: 'Of course John! Let me check your upcoming appointment... You have an appointment on Wednesday at 2pm with Dr. Arnold. What day works better for you?', minsAgo: 119 },
    { role: 'USER',  content: 'Can we do Friday instead?',                                                                                                    minsAgo: 118 },
    { role: 'AGENT', content: "Friday works! I've moved your appointment to Friday at 2:00 PM with Dr. Arnold. You'll receive a reminder the day before 😊",  minsAgo: 117 },
  ])

  // Mary Nakato — emergency toothache via WhatsApp
  await upsertConversation('+256700000003', 'WHATSAPP', true, [
    { role: 'USER',  content: 'I have a toothache, is there a slot today?',                                                                                   minsAgo: 30 },
    { role: 'AGENT', content: "Oh no Mary, sorry to hear that! 😟 Let me check today's availability... We have a slot at 3:30 PM today with Dr. Joseline. Shall I book that for you?", minsAgo: 29 },
    { role: 'USER',  content: 'Yes please',                                                                                                                   minsAgo: 25 },
    { role: 'AGENT', content: "Done! You're booked for today at 3:30 PM with Dr. Joseline for an Emergency Consultation. Please come 10 minutes early. Feel better soon! 💙", minsAgo: 24 },
  ])

  console.log('✅ 3 demo AI conversations created')

  console.log('\n🎉 CodeClinic seeded successfully!')
  console.log('   admin@codeclinic.ug     → CodeClinic2026!')
  console.log('   reception@codeclinic.ug → Staff@2024!')
  console.log('   accounts@codeclinic.ug  → Staff@2024!')
  console.log('   steven.mugabe@codeclinic.ug → Doctor@2024!')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
