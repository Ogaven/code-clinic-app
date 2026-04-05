import { execSync } from 'child_process'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const DB_DIR = path.resolve(__dirname, '../../../packages/database')
const PRISMA_BIN = path.join(DB_DIR, 'node_modules/.bin/prisma')

export async function runStartup() {
  // ── 1. Run migrations ─────────────────────────────────────────
  try {
    console.log('[startup] Running prisma migrate deploy...')
    execSync(`"${PRISMA_BIN}" migrate deploy --schema="${path.join(DB_DIR, 'prisma/schema.prisma')}"`, {
      stdio: 'inherit',
      env: { ...process.env },
    })
    console.log('[startup] Migrations complete.')
  } catch (e: any) {
    console.error('[startup] Migration failed:', e.message?.split('\n')[0])
  }

  // ── 2. Seed if database is empty ──────────────────────────────
  try {
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      console.log(`[startup] Database already has ${userCount} users — skipping seed.`)
      return
    }

    console.log('[startup] Empty database — seeding...')
    await seed()
    console.log('[startup] Seed complete.')
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
}
