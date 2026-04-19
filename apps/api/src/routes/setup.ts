/**
 * POST /setup/seed-production
 * One-time endpoint to seed the production database.
 * Protected by SEED_SECRET env var — delete or disable after first use.
 */
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { execSync } from 'child_process'
import path from 'path'

const router = Router()
const prisma = new PrismaClient()

// Resolve monorepo root and schema path
// __dirname in compiled output: <root>/apps/api/dist/routes
const ROOT   = path.resolve(__dirname, '..', '..', '..', '..')
const SCHEMA = path.join(ROOT, 'packages', 'database', 'prisma', 'schema.prisma')
const DB_PKG = path.join(ROOT, 'packages', 'database')

function runPrismaDbPush() {
  // Strategy: find prisma's JS entry via require.resolve (works with pnpm virtual store)
  // Falls back to known binary paths if that fails
  const attempts: Array<() => void> = [
    // 1. Resolve prisma package from the database package directory (pnpm-aware)
    () => {
      const pkgPath = require.resolve('prisma', { paths: [DB_PKG] })
      const pkgDir  = pkgPath.replace(/[/\\]package\.json$/, '')
      const entry   = path.join(pkgDir, 'build', 'index.js')
      execSync(`node "${entry}" db push --accept-data-loss --schema="${SCHEMA}"`, { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    },
    // 2. Resolve from root (if hoisted by pnpm)
    () => {
      const pkgPath = require.resolve('prisma', { paths: [ROOT] })
      const entry   = path.join(path.dirname(pkgPath), 'build', 'index.js')
      execSync(`node "${entry}" db push --accept-data-loss --schema="${SCHEMA}"`, { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    },
    // 3. database package .bin symlink
    () => {
      const bin = path.join(DB_PKG, 'node_modules', '.bin', 'prisma')
      execSync(`"${bin}" db push --accept-data-loss --schema="${SCHEMA}"`, { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    },
    // 4. root .bin symlink
    () => {
      const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
      execSync(`"${bin}" db push --accept-data-loss --schema="${SCHEMA}"`, { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    },
  ]

  const errors: string[] = []
  for (const attempt of attempts) {
    try { attempt(); return } catch (e: any) { errors.push(e.message?.slice(0, 80)) }
  }
  throw new Error(`All prisma binary attempts failed:\n${errors.join('\n')}`)
}

// POST /setup/migrate — sync schema without full seed
router.post('/migrate', async (req, res) => {
  const secret = req.headers['x-seed-secret'] || req.body?.secret
  const expected = process.env.SEED_SECRET || 'codeclinic-demo-2026'
  if (secret !== expected) return res.status(403).json({ error: 'Invalid seed secret' })
  try {
    runPrismaDbPush()
    res.json({ success: true, message: 'Schema pushed to database', root: ROOT, schema: SCHEMA })
  } catch (e: any) {
    res.status(500).json({ error: 'Migration failed', detail: e.message, root: ROOT, schema: SCHEMA })
  }
})

router.post('/seed-production', async (req, res) => {
  // ── Auth: secret key check ──────────────────────────────────
  const secret = req.headers['x-seed-secret'] || req.body?.secret
  const expected = process.env.SEED_SECRET || 'codeclinic-demo-2026'
  if (secret !== expected) {
    return res.status(403).json({ error: 'Invalid seed secret' })
  }

  const results: string[] = []
  const log = (msg: string) => { console.log('[SEED]', msg); results.push(msg) }

  try {
    // ── 0. Schema sync ─────────────────────────────────────────
    try {
      runPrismaDbPush()
      log('Schema synced via prisma db push')
    } catch (e: any) {
      log(`Schema sync warning (non-fatal): ${e.message?.slice(0, 100)}`)
    }
    // ── 1. Staff users ────────────────────────────────────────
    const adminPw  = await bcrypt.hash('Admin@2024!', 12)
    const staffPw  = await bcrypt.hash('Staff@2024!', 12)
    const doctorPw = await bcrypt.hash('Doctor@2024!', 12)

    await prisma.user.upsert({
      where:  { email: 'admin@codeclinic.ug' },
      update: {},
      create: { email: 'admin@codeclinic.ug', passwordHash: adminPw, role: 'ADMIN', firstName: 'Admin', lastName: 'User', phone: '+256700000001' },
    })
    await prisma.user.upsert({
      where:  { email: 'reception@codeclinic.ug' },
      update: {},
      create: { email: 'reception@codeclinic.ug', passwordHash: staffPw, role: 'RECEPTIONIST', firstName: 'Reception', lastName: 'Staff', phone: '+256700000002' },
    })
    await prisma.user.upsert({
      where:  { email: 'accounts@codeclinic.ug' },
      update: {},
      create: { email: 'accounts@codeclinic.ug', passwordHash: staffPw, role: 'ACCOUNTS', firstName: 'Accounts', lastName: 'Staff', phone: '+256700000003' },
    })
    log('Staff users upserted (admin, reception, accounts)')

    // ── 2. Doctors ────────────────────────────────────────────
    const doctorDefs = [
      { firstName: 'Steven',   lastName: 'Mugabe',   email: 'steven.mugabe@codeclinic.ug',    specialisation: 'General Dentistry & Oral-Systemic Health', colour: '#4A90D9' },
      { firstName: 'Angella',  lastName: 'Kissa',    email: 'angella.kissa@codeclinic.ug',     specialisation: 'Orthodontics',                               colour: '#E8A838' },
      { firstName: 'Arnold',   lastName: 'Nshimye',  email: 'arnold.nshimye@codeclinic.ug',   specialisation: 'Periodontics',                               colour: '#9B59B6' },
      { firstName: 'Lois',     lastName: 'Kisakye',  email: 'lois.kisakye@codeclinic.ug',     specialisation: 'Paediatric Dentistry',                       colour: '#2ECC71' },
      { firstName: 'Joseline', lastName: 'Babirye',  email: 'joseline.babirye@codeclinic.ug', specialisation: 'Restorative Dentistry',                      colour: '#E74C3C' },
      { firstName: 'Kutesa',   lastName: 'Eben',     email: 'kutesa.eben@codeclinic.ug',      specialisation: 'Oral Surgery',                               colour: '#1ABC9C' },
      { firstName: 'Kajumba',  lastName: 'Faith',    email: 'kajumba.faith@codeclinic.ug',    specialisation: 'Endodontics',                                colour: '#F39C12' },
      { firstName: 'Papa',     lastName: 'Joel',     email: 'papa.joel@codeclinic.ug',        specialisation: 'Prosthodontics',                             colour: '#3498DB' },
    ]
    for (const d of doctorDefs) {
      const user = await prisma.user.upsert({
        where:  { email: d.email },
        update: {},
        create: { email: d.email, passwordHash: doctorPw, role: 'DOCTOR', firstName: d.firstName, lastName: d.lastName },
      })
      await prisma.doctor.upsert({
        where:  { userId: user.id },
        update: {},
        create: {
          userId:        user.id,
          specialisation: d.specialisation,
          colour:        d.colour,
          workingDays:   JSON.stringify([1, 2, 3, 4, 5, 6]), // Mon–Sat
          workingHours:  JSON.stringify({ start: '07:00', end: '18:00' }),
        },
      })
    }
    log('8 doctors upserted')

    // ── 3. Services ───────────────────────────────────────────
    const serviceDefs = [
      { category: 'Consultation',   name: 'Check and Treat',              durationMins: 30,  priceUGX: 50000,   colour: '#3498DB' },
      { category: 'Consultation',   name: 'Review Check Up',              durationMins: 20,  priceUGX: 30000,   colour: '#2ECC71' },
      { category: 'Consultation',   name: 'Emergency Dental Consult',     durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
      { category: 'Preventive',     name: 'Dental Cleaning (Scaling)',    durationMins: 45,  priceUGX: 80000,   colour: '#2ECC71' },
      { category: 'Preventive',     name: 'Fluoride Treatment',           durationMins: 30,  priceUGX: 40000,   colour: '#27AE60' },
      { category: 'Preventive',     name: 'Dental X-Ray (Periapical)',    durationMins: 15,  priceUGX: 30000,   colour: '#2ECC71' },
      { category: 'Preventive',     name: 'Dental X-Ray (Panoramic)',     durationMins: 15,  priceUGX: 80000,   colour: '#2ECC71' },
      { category: 'Restorative',    name: 'Dental Filling (Composite)',   durationMins: 45,  priceUGX: 90000,   colour: '#F39C12' },
      { category: 'Restorative',    name: 'Dental Filling (Amalgam)',     durationMins: 45,  priceUGX: 70000,   colour: '#F39C12' },
      { category: 'Restorative',    name: 'Dental Crown (Porcelain)',     durationMins: 90,  priceUGX: 700000,  colour: '#4A90D9' },
      { category: 'Restorative',    name: 'Dental Bridge',                durationMins: 90,  priceUGX: 900000,  colour: '#4A90D9' },
      { category: 'Restorative',    name: 'Dental Inlay / Onlay',         durationMins: 60,  priceUGX: 400000,  colour: '#4A90D9' },
      { category: 'Periodontal',    name: 'Periodontal Therapy',          durationMins: 60,  priceUGX: 120000,  colour: '#9B59B6' },
      { category: 'Periodontal',    name: 'Deep Scaling & Root Planing',  durationMins: 75,  priceUGX: 180000,  colour: '#8E44AD' },
      { category: 'Endodontics',    name: 'Root Canal Treatment',         durationMins: 90,  priceUGX: 350000,  colour: '#E8A838' },
      { category: 'Endodontics',    name: 'Root Canal Retreatment',       durationMins: 90,  priceUGX: 450000,  colour: '#E8A838' },
      { category: 'Oral Surgery',   name: 'Tooth Extraction (Simple)',    durationMins: 30,  priceUGX: 60000,   colour: '#E74C3C' },
      { category: 'Oral Surgery',   name: 'Tooth Extraction (Surgical)',  durationMins: 60,  priceUGX: 150000,  colour: '#C0392B' },
      { category: 'Oral Surgery',   name: 'Wisdom Tooth Extraction',      durationMins: 75,  priceUGX: 200000,  colour: '#C0392B' },
      { category: 'Oral Surgery',   name: 'Biopsy / Lesion Removal',      durationMins: 45,  priceUGX: 120000,  colour: '#C0392B' },
      { category: 'Cosmetic',       name: 'Teeth Whitening (In-Chair)',   durationMins: 60,  priceUGX: 250000,  colour: '#1ABC9C' },
      { category: 'Cosmetic',       name: 'Teeth Whitening (Take-Home)', durationMins: 30,  priceUGX: 150000,  colour: '#1ABC9C' },
      { category: 'Cosmetic',       name: 'Dental Veneers (Porcelain)',   durationMins: 90,  priceUGX: 800000,  colour: '#16A085' },
      { category: 'Cosmetic',       name: 'Dental Veneers (Composite)',   durationMins: 60,  priceUGX: 300000,  colour: '#16A085' },
      { category: 'Orthodontics',   name: 'Braces Fitting (Metal)',       durationMins: 90,  priceUGX: 1200000, colour: '#2980B9' },
      { category: 'Orthodontics',   name: 'Braces Fitting (Ceramic)',     durationMins: 90,  priceUGX: 1800000, colour: '#29ABE2' },
      { category: 'Orthodontics',   name: 'Braces Adjustment',            durationMins: 30,  priceUGX: 80000,   colour: '#29ABE2' },
      { category: 'Orthodontics',   name: 'Clear Aligner (Invisalign)',   durationMins: 60,  priceUGX: 3500000, colour: '#5DADE2' },
      { category: 'Prosthodontics', name: 'Denture (Full)',               durationMins: 60,  priceUGX: 800000,  colour: '#34495E' },
      { category: 'Prosthodontics', name: 'Denture (Partial)',            durationMins: 45,  priceUGX: 500000,  colour: '#34495E' },
      { category: 'Prosthodontics', name: 'Dental Implant',               durationMins: 120, priceUGX: 3000000, colour: '#2C3E50' },
      { category: 'Paediatric',     name: 'Child Dental Check-Up',        durationMins: 30,  priceUGX: 40000,   colour: '#E91E63' },
      { category: 'Paediatric',     name: 'Child Tooth Extraction',       durationMins: 30,  priceUGX: 50000,   colour: '#E91E63' },
      { category: 'Paediatric',     name: 'Fissure Sealant',              durationMins: 30,  priceUGX: 35000,   colour: '#E91E63' },
      { category: 'Paediatric',     name: 'Space Maintainer',             durationMins: 30,  priceUGX: 120000,  colour: '#E91E63' },
      { category: 'Diagnostics',    name: 'Full Mouth X-Ray (OPG)',       durationMins: 15,  priceUGX: 120000,  colour: '#607D8B' },
      { category: 'Diagnostics',    name: 'Dental CT Scan (CBCT)',        durationMins: 20,  priceUGX: 250000,  colour: '#607D8B' },
      { category: 'Diagnostics',    name: 'Oral Cancer Screening',        durationMins: 30,  priceUGX: 60000,   colour: '#607D8B' },
      { category: 'Preventive',     name: 'Sports Mouth Guard',           durationMins: 30,  priceUGX: 80000,   colour: '#27AE60' },
      { category: 'Preventive',     name: 'Night Guard (Bruxism)',        durationMins: 30,  priceUGX: 200000,  colour: '#27AE60' },
    ]
    for (const s of serviceDefs) {
      await (prisma.service as any).upsert({
        where:  { name: s.name },
        update: { category: s.category, priceUGX: s.priceUGX, durationMins: s.durationMins },
        create: {
          name:         s.name,
          category:     s.category,
          durationMins: s.durationMins,
          priceUGX:     s.priceUGX,
          priceUSD:     Math.round(s.priceUGX / 3700 * 100) / 100,
          colour:       s.colour,
          vatApplicable: true,
        },
      })
    }
    log(`${serviceDefs.length} services upserted`)

    // ── 4. Demo patients ──────────────────────────────────────
    const patientDefs = [
      { firstName: 'Grace',    lastName: 'Apio',     phone: '+256700100001', gender: 'FEMALE', dob: new Date('1990-03-15') },
      { firstName: 'John',     lastName: 'Ssempala', phone: '+256700100002', gender: 'MALE',   dob: new Date('1985-07-22') },
      { firstName: 'Sarah',    lastName: 'Namukasa', phone: '+256700100003', gender: 'FEMALE', dob: new Date('1995-11-08') },
      { firstName: 'David',    lastName: 'Okello',   phone: '+256700100004', gender: 'MALE',   dob: new Date('1978-01-30') },
      { firstName: 'Peace',    lastName: 'Nakato',   phone: '+256700100005', gender: 'FEMALE', dob: new Date('2000-06-12') },
      { firstName: 'Daniel',   lastName: 'Kiggundu', phone: '+256700100006', gender: 'MALE',   dob: new Date('1982-09-05') },
      { firstName: 'Esther',   lastName: 'Nalwanga', phone: '+256700100007', gender: 'FEMALE', dob: new Date('1993-04-18') },
      { firstName: 'Joseph',   lastName: 'Tumwine',  phone: '+256700100008', gender: 'MALE',   dob: new Date('1975-12-25') },
    ]
    for (const p of patientDefs) {
      await prisma.patient.upsert({ where: { phone: p.phone }, update: {}, create: p })
    }
    log(`${patientDefs.length} demo patients upserted`)

    // ── 5. Today's demo appointments ──────────────────────────
    const adminUser  = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const allDoctors = await prisma.doctor.findMany({ include: { user: true }, take: 5 })
    const allPatients = await prisma.patient.findMany({ take: 8 })
    const allServices = await prisma.service.findMany({ take: 12 })

    if (adminUser && allDoctors.length && allPatients.length && allServices.length) {
      // Kampala today
      const kampalaStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' })
      const today = new Date(kampalaStr)
      today.setHours(0, 0, 0, 0)

      const slots = [
        { pIdx: 0, dIdx: 0, sIdx: 0,  h: 9,  m: 0,  status: 'WITH_PROVIDER' as const },
        { pIdx: 1, dIdx: 0, sIdx: 3,  h: 10, m: 0,  status: 'CONFIRMED'     as const },
        { pIdx: 2, dIdx: 1, sIdx: 1,  h: 11, m: 0,  status: 'CONFIRMED'     as const },
        { pIdx: 3, dIdx: 1, sIdx: 7,  h: 14, m: 0,  status: 'CONFIRMED'     as const },
        { pIdx: 4, dIdx: 2, sIdx: 2,  h: 15, m: 30, status: 'CONFIRMED'     as const },
      ]

      let apptCount = 0
      for (const slot of slots) {
        const doctor  = allDoctors[slot.dIdx]
        const patient = allPatients[slot.pIdx]
        const service = allServices[slot.sIdx]
        if (!doctor || !patient || !service) continue

        const startAt = new Date(today)
        startAt.setHours(slot.h, slot.m, 0, 0)
        const endAt = new Date(startAt.getTime() + service.durationMins * 60000)

        // Check if appointment already exists for this patient+doctor+startAt
        const existing = await prisma.appointment.findFirst({
          where: { patientId: patient.id, doctorId: doctor.id, startAt },
        })
        if (!existing) {
          await prisma.appointment.create({
            data: {
              patientId:   patient.id,
              doctorId:    doctor.id,
              serviceId:   service.id,
              startAt,
              endAt,
              status:      slot.status,
              createdById: adminUser.id,
            },
          })
          apptCount++
        }
      }
      log(`${apptCount} today's appointments created`)
    }

    // ── 5b. Dr. Steven Mugabe's specific appointments for today ──
    const stevenUser = await prisma.user.findFirst({ where: { email: 'steven.mugabe@codeclinic.ug' } })
    const stevenDoc  = stevenUser ? await prisma.doctor.findFirst({ where: { userId: stevenUser.id } }) : null
    if (stevenDoc && adminUser) {
      // Ensure Grace Atuhaire exists
      await prisma.patient.upsert({
        where:  { phone: '+256700100009' },
        update: {},
        create: { firstName: 'Grace', lastName: 'Atuhaire', phone: '+256700100009', gender: 'FEMALE', dob: new Date('1992-06-20') },
      })

      const stevenSlots = [
        { phone: '+256700100009', h: 8,  m: 0,  status: 'ARRIVED'       as const }, // Grace Atuhaire
        { phone: '+256700100008', h: 9,  m: 0,  status: 'WAITING'       as const }, // Joseph Tumwine
        { phone: '+256700100007', h: 9,  m: 30, status: 'IN_OPERATORY'  as const }, // Esther Nalwanga
        { phone: '+256700100006', h: 10, m: 0,  status: 'WITH_PROVIDER' as const }, // Daniel Kiggundu
        { phone: '+256700100005', h: 11, m: 0,  status: 'CONFIRMED'     as const }, // Peace Nakato
        { phone: '+256700100004', h: 14, m: 0,  status: 'CONFIRMED'     as const }, // David Okello
      ]
      const consultService = await prisma.service.findFirst({ where: { name: 'Check and Treat' } })
      const todayKampala = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
      todayKampala.setHours(0, 0, 0, 0)
      let stevenApptCount = 0
      for (const slot of stevenSlots) {
        const patient = await prisma.patient.findFirst({ where: { phone: slot.phone } })
        if (!patient || !consultService) continue
        const startAt = new Date(todayKampala)
        startAt.setHours(slot.h, slot.m, 0, 0)
        const endAt = new Date(startAt.getTime() + consultService.durationMins * 60000)
        try {
          await prisma.appointment.upsert({
            where: { doctorId_startAt: { doctorId: stevenDoc.id, startAt } },
            update: { status: slot.status },
            create: { patientId: patient.id, doctorId: stevenDoc.id, serviceId: consultService.id, startAt, endAt, status: slot.status, createdById: adminUser.id },
          })
          stevenApptCount++
        } catch { /* skip if unique conflict */ }
      }
      log(`${stevenApptCount} Dr. Steven appointments created`)
    }

    // ── 6. AgentConfig (Zoe modes) ────────────────────────────
    const agentConfigs = [
      {
        responsibility: 'INBOUND',
        systemPrompt: "You are Zoe, the AI receptionist at Code Clinic on Kiira Road, Kamwokya, Kampala. You handle inbound calls and WhatsApp messages. Your job: warmly greet patients, book appointments, answer questions about services and pricing. Always use real data from your tools — never guess prices, times, or doctor names.",
        scheduleCron: null,
      },
      {
        responsibility: 'REMINDER',
        systemPrompt: "You are Zoe from Code Clinic calling to remind a patient of their upcoming appointment. Confirm they are still coming, offer to reschedule if needed, and answer any last-minute questions.",
        scheduleCron: '0 6 * * *',
      },
      {
        responsibility: 'FOLLOWUP',
        systemPrompt: "You are Zoe from Code Clinic calling to check in after a patient's recent visit. Ask how they are feeling, request a satisfaction rating (1-5), and offer to book a follow-up if needed.",
        scheduleCron: '0 7 * * *',
      },
      {
        responsibility: 'DEBT',
        systemPrompt: "You are Zoe from Code Clinic calling about an outstanding balance. Be kind and professional. Explain the amount owed and offer payment options: MTN Mobile Money, Airtel Money, or in-person at the clinic.",
        scheduleCron: '0 8 * * 1',
      },
      {
        responsibility: 'ESCALATION',
        systemPrompt: "Transfer to a human receptionist for medical emergencies, complaints, or complex situations. Always collect patient name and callback number before transferring.",
        scheduleCron: null,
      },
    ]
    for (const cfg of agentConfigs) {
      await (prisma.agentConfig as any).upsert({
        where:  { responsibility: cfg.responsibility },
        update: { systemPrompt: cfg.systemPrompt, isActive: true },
        create: {
          responsibility: cfg.responsibility,
          isActive:       true,
          systemPrompt:   cfg.systemPrompt,
          promptHistory:  '[]',
          scheduleCron:   cfg.scheduleCron,
          maxAttempts:    3,
        },
      })
    }
    log('5 AgentConfig records upserted')

    // ── 7. Sample Escalation (for demo) ───────────────────────
    const firstPatient = await prisma.patient.findFirst()
    const existingEscalation = await (prisma.escalation as any).findFirst()
    if (!existingEscalation && firstPatient) {
      await (prisma.escalation as any).create({
        data: {
          patientId:   firstPatient.id,
          phoneNumber: firstPatient.phone,
          channel:     'WHATSAPP',
          reason:      'Patient reported tooth pain and asked to speak with a dentist urgently.',
          status:      'PENDING',
        },
      })
      log('1 sample escalation (Escalation table) created')
    }

    // Also create AgentLog escalation for receptionist dashboard
    const existingLogEscalation = await prisma.agentLog.findFirst({ where: { escalated: true } })
    if (!existingLogEscalation && firstPatient) {
      await prisma.agentLog.create({
        data: {
          patientId: firstPatient.id,
          type:      'INBOUND',
          channel:   'WHATSAPP',
          outcome:   'ESCALATED',
          escalated: true,
          transcript: 'Patient: I have severe tooth pain and my face is swelling. I need to see a dentist urgently.',
        },
      })
      log('1 sample AgentLog escalation created')
    }

    // ── 8. Sample AgentMemory ──────────────────────────────────
    if (firstPatient) {
      const existingMemory = await (prisma.agentMemory as any).count({ where: { patientId: firstPatient.id } })
      if (existingMemory === 0) {
        await (prisma.agentMemory as any).createMany({
          data: [
            {
              patientId:       firstPatient.id,
              channel:         'WHATSAPP',
              phoneNumber:     firstPatient.phone,
              interactionType: 'INBOUND',
              summary:         'Patient asked about teeth whitening prices and booked an appointment.',
              outcome:         'BOOKED',
              agentMode:       'INBOUND',
            },
            {
              patientId:       firstPatient.id,
              channel:         'VOICE',
              phoneNumber:     firstPatient.phone,
              interactionType: 'REMINDER',
              summary:         'Appointment reminder call. Patient confirmed attendance.',
              outcome:         'CONFIRMED',
              agentMode:       'REMINDER',
            },
          ],
        })
        log('2 sample AgentMemory records created')
      }
    }

    // ── 9. Agent prompts (legacy AgentPrompt model) ───────────
    const agentPrompts = [
      { type: 'INBOUND_BOOKING',    name: 'Inbound Booking Agent',      systemPrompt: 'You are Zoe, the AI receptionist at Code Clinic. Help patients book appointments.' },
      { type: 'OUTBOUND_REMINDER',  name: 'Appointment Reminder Agent', systemPrompt: 'You are Zoe from Code Clinic calling to remind patients of upcoming appointments.' },
      { type: 'FOLLOWUP',           name: 'Post-Visit Follow-up Agent', systemPrompt: 'You are Zoe following up after a patient visit. Check wellbeing and collect feedback.' },
      { type: 'DEBT_REMINDER',      name: 'Debt Reminder Agent',        systemPrompt: 'You are Zoe calling about an outstanding balance. Be kind and professional.' },
      { type: 'FAQ',                name: 'FAQ Agent',                  systemPrompt: 'You are Zoe answering FAQs. Clinic hours: Mon-Sat 7am-6pm. Location: Kiira Road, Kamwokya.' },
    ]
    for (const p of agentPrompts) {
      await prisma.agentPrompt.upsert({ where: { type: p.type }, update: { systemPrompt: p.systemPrompt }, create: p })
    }
    log('5 AgentPrompt records upserted')

    // ── 10. Extended demo patients (25 more) ─────────────────────
    const extraPatients = [
      { firstName: 'Aisha',     lastName: 'Nakigozi',  phone: '+256701200001', email: 'aisha.nakigozi@gmail.com',  gender: 'FEMALE', dob: new Date('1994-02-14'), address: 'Ntinda, Kampala',       district: 'Kampala' },
      { firstName: 'Brian',     lastName: 'Wasswa',    phone: '+256701200002', email: 'brian.wasswa@yahoo.com',    gender: 'MALE',   dob: new Date('1988-08-30'), address: 'Bukoto, Kampala',       district: 'Kampala' },
      { firstName: 'Christine', lastName: 'Akello',    phone: '+256701200003', email: 'c.akello@gmail.com',        gender: 'FEMALE', dob: new Date('1997-05-21'), address: 'Mulago, Kampala',       district: 'Kampala' },
      { firstName: 'Denis',     lastName: 'Muwonge',   phone: '+256701200004', email: 'denis.muwonge@gmail.com',   gender: 'MALE',   dob: new Date('1983-11-07'), address: 'Bweyogerere, Wakiso',   district: 'Wakiso'  },
      { firstName: 'Evelyn',    lastName: 'Atuhaire',  phone: '+256701200005', email: null,                        gender: 'FEMALE', dob: new Date('2001-09-03'), address: 'Najjera, Wakiso',       district: 'Wakiso'  },
      { firstName: 'Francis',   lastName: 'Ssebunya',  phone: '+256701200006', email: 'f.ssebunya@hotmail.com',    gender: 'MALE',   dob: new Date('1976-04-19'), address: 'Kololo, Kampala',       district: 'Kampala' },
      { firstName: 'Gloria',    lastName: 'Namanya',   phone: '+256701200007', email: null,                        gender: 'FEMALE', dob: new Date('1999-12-01'), address: 'Kira, Wakiso',          district: 'Wakiso'  },
      { firstName: 'Hassan',    lastName: 'Sserunkuma',phone: '+256701200008', email: 'hassan.s@gmail.com',        gender: 'MALE',   dob: new Date('1991-03-28'), address: 'Wandegeya, Kampala',    district: 'Kampala' },
      { firstName: 'Irene',     lastName: 'Kyomuhendo',phone: '+256701200009', email: null,                        gender: 'FEMALE', dob: new Date('1986-07-15'), address: 'Rubaga, Kampala',       district: 'Kampala' },
      { firstName: 'James',     lastName: 'Byaruhanga', phone: '+256701200010',email: 'james.bya@gmail.com',       gender: 'MALE',   dob: new Date('1979-10-22'), address: 'Muyenga, Kampala',      district: 'Kampala' },
      { firstName: 'Kasozi',    lastName: 'Raymond',   phone: '+256701200011', email: null,                        gender: 'MALE',   dob: new Date('2003-01-09'), address: 'Mengo, Kampala',        district: 'Kampala' },
      { firstName: 'Lydia',     lastName: 'Nabirye',   phone: '+256701200012', email: 'lydia.nabirye@gmail.com',   gender: 'FEMALE', dob: new Date('1992-06-30'), address: 'Bugolobi, Kampala',     district: 'Kampala' },
      { firstName: 'Michael',   lastName: 'Ochen',     phone: '+256701200013', email: null,                        gender: 'MALE',   dob: new Date('1987-08-11'), address: 'Gulu',                  district: 'Gulu'    },
      { firstName: 'Norah',     lastName: 'Nantongo',  phone: '+256701200014', email: 'norah.nantongo@gmail.com',  gender: 'FEMALE', dob: new Date('2000-04-25'), address: 'Entebbe, Wakiso',       district: 'Wakiso'  },
      { firstName: 'Oliver',    lastName: 'Tumusiime', phone: '+256701200015', email: null,                        gender: 'MALE',   dob: new Date('1995-02-18'), address: 'Nansana, Wakiso',       district: 'Wakiso'  },
      { firstName: 'Patience',  lastName: 'Alupo',     phone: '+256701200016', email: 'p.alupo@gmail.com',         gender: 'FEMALE', dob: new Date('1972-09-08'), address: 'Kololo, Kampala',       district: 'Kampala' },
      { firstName: 'Qalam',     lastName: 'Kisekka',   phone: '+256701200017', email: null,                        gender: 'MALE',   dob: new Date('1998-07-14'), address: 'Makindye, Kampala',     district: 'Kampala' },
      { firstName: 'Ruth',      lastName: 'Achan',     phone: '+256701200018', email: 'ruth.achan@gmail.com',      gender: 'FEMALE', dob: new Date('1990-11-20'), address: 'Lira',                  district: 'Lira'    },
      { firstName: 'Samuel',    lastName: 'Mugisha',   phone: '+256701200019', email: null,                        gender: 'MALE',   dob: new Date('1984-05-03'), address: 'Nakasero, Kampala',     district: 'Kampala' },
      { firstName: 'Teddy',     lastName: 'Nassali',   phone: '+256701200020', email: 'teddy.nassali@gmail.com',   gender: 'FEMALE', dob: new Date('1996-08-27'), address: 'Kawempe, Kampala',      district: 'Kampala' },
      { firstName: 'Ugaaso',    lastName: 'Awich',     phone: '+256701200021', email: null,                        gender: 'FEMALE', dob: new Date('2005-03-12'), address: 'Mbarara',               district: 'Mbarara' },
      { firstName: 'Vincent',   lastName: 'Lubega',    phone: '+256701200022', email: 'v.lubega@gmail.com',        gender: 'MALE',   dob: new Date('1981-12-04'), address: 'Kampala Road, Kampala', district: 'Kampala' },
      { firstName: 'Winnie',    lastName: 'Nalubega',  phone: '+256701200023', email: null,                        gender: 'FEMALE', dob: new Date('1993-10-16'), address: 'Portbell, Kampala',     district: 'Kampala' },
      { firstName: 'Xavier',    lastName: 'Katende',   phone: '+256701200024', email: 'x.katende@gmail.com',       gender: 'MALE',   dob: new Date('1977-06-09'), address: 'Sseguku, Wakiso',       district: 'Wakiso'  },
      { firstName: 'Yvonne',    lastName: 'Naluwooza', phone: '+256701200025', email: 'y.naluwooza@gmail.com',     gender: 'FEMALE', dob: new Date('2002-01-23'), address: 'Kireka, Wakiso',        district: 'Wakiso'  },
    ]
    for (const p of extraPatients) {
      await prisma.patient.upsert({ where: { phone: p.phone }, update: {}, create: p })
    }
    log(`${extraPatients.length} extended demo patients upserted`)

    // ── 11. Historical & future appointments (all doctors) ───────
    const adminU   = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const allDocs  = await prisma.doctor.findMany({ include: { user: true } })
    const allPats  = await prisma.patient.findMany()
    const allSvcs  = await prisma.service.findMany()
    if (adminU && allDocs.length && allPats.length && allSvcs.length) {
      const svcByName = (name: string) => allSvcs.find(s => s.name === name) || allSvcs[0]
      const doc = (i: number) => allDocs[i % allDocs.length]
      const pat = (i: number) => allPats[i % allPats.length]

      const kampalaBase = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
      kampalaBase.setHours(0, 0, 0, 0)

      const dayOffset = (d: number, h: number, m = 0) => {
        const dt = new Date(kampalaBase)
        dt.setDate(dt.getDate() + d)
        dt.setHours(h, m, 0, 0)
        return dt
      }

      const histSlots = [
        // Past 14 days — completed visits
        { d: -14, h: 8,  m: 0,  pI: 2,  docI: 1, svc: 'Braces Adjustment',           status: 'COMPLETED' as const, paid: true,  amount: 80000  },
        { d: -14, h: 9,  m: 0,  pI: 5,  docI: 2, svc: 'Periodontal Therapy',          status: 'COMPLETED' as const, paid: true,  amount: 120000 },
        { d: -14, h: 10, m: 30, pI: 8,  docI: 3, svc: 'Child Dental Check-Up',        status: 'COMPLETED' as const, paid: true,  amount: 40000  },
        { d: -14, h: 14, m: 0,  pI: 11, docI: 4, svc: 'Root Canal Treatment',         status: 'COMPLETED' as const, paid: false, amount: 350000 },
        { d: -13, h: 8,  m: 30, pI: 3,  docI: 0, svc: 'Dental Cleaning (Scaling)',    status: 'COMPLETED' as const, paid: true,  amount: 80000  },
        { d: -13, h: 10, m: 0,  pI: 6,  docI: 5, svc: 'Tooth Extraction (Simple)',    status: 'COMPLETED' as const, paid: true,  amount: 60000  },
        { d: -13, h: 11, m: 0,  pI: 9,  docI: 1, svc: 'Braces Fitting (Metal)',       status: 'COMPLETED' as const, paid: true,  amount: 1200000},
        { d: -13, h: 14, m: 30, pI: 14, docI: 6, svc: 'Dental Filling (Composite)',   status: 'NO_SHOW'   as const, paid: false, amount: 90000  },
        { d: -12, h: 9,  m: 0,  pI: 1,  docI: 3, svc: 'Fissure Sealant',             status: 'COMPLETED' as const, paid: true,  amount: 35000  },
        { d: -12, h: 10, m: 0,  pI: 4,  docI: 7, svc: 'Dental Crown (Porcelain)',     status: 'COMPLETED' as const, paid: false, amount: 700000 },
        { d: -12, h: 11, m: 30, pI: 7,  docI: 2, svc: 'Deep Scaling & Root Planing',  status: 'COMPLETED' as const, paid: true,  amount: 180000 },
        { d: -12, h: 15, m: 0,  pI: 12, docI: 0, svc: 'Teeth Whitening (In-Chair)',   status: 'COMPLETED' as const, paid: true,  amount: 250000 },
        { d: -11, h: 8,  m: 0,  pI: 15, docI: 4, svc: 'Root Canal Treatment',         status: 'COMPLETED' as const, paid: true,  amount: 350000 },
        { d: -11, h: 9,  m: 30, pI: 0,  docI: 5, svc: 'Wisdom Tooth Extraction',      status: 'COMPLETED' as const, paid: true,  amount: 200000 },
        { d: -11, h: 11, m: 0,  pI: 10, docI: 1, svc: 'Clear Aligner (Invisalign)',   status: 'COMPLETED' as const, paid: false, amount: 3500000},
        { d: -11, h: 14, m: 0,  pI: 13, docI: 6, svc: 'Dental X-Ray (Panoramic)',     status: 'CANCELLED' as const, paid: false, amount: 80000  },
        { d: -10, h: 8,  m: 30, pI: 16, docI: 0, svc: 'Check and Treat',              status: 'COMPLETED' as const, paid: true,  amount: 50000  },
        { d: -10, h: 10, m: 0,  pI: 19, docI: 3, svc: 'Space Maintainer',             status: 'COMPLETED' as const, paid: true,  amount: 120000 },
        { d: -10, h: 11, m: 0,  pI: 22, docI: 2, svc: 'Periodontal Therapy',          status: 'COMPLETED' as const, paid: true,  amount: 120000 },
        { d: -10, h: 14, m: 30, pI: 25, docI: 7, svc: 'Dental Implant',               status: 'COMPLETED' as const, paid: false, amount: 3000000},
        { d: -9,  h: 8,  m: 0,  pI: 17, docI: 1, svc: 'Braces Adjustment',           status: 'COMPLETED' as const, paid: true,  amount: 80000  },
        { d: -9,  h: 9,  m: 0,  pI: 20, docI: 5, svc: 'Biopsy / Lesion Removal',     status: 'COMPLETED' as const, paid: true,  amount: 120000 },
        { d: -9,  h: 10, m: 30, pI: 23, docI: 6, svc: 'Dental Veneers (Composite)',   status: 'COMPLETED' as const, paid: true,  amount: 300000 },
        { d: -9,  h: 14, m: 0,  pI: 26, docI: 4, svc: 'Root Canal Retreatment',       status: 'NO_SHOW'   as const, paid: false, amount: 450000 },
        { d: -7,  h: 8,  m: 0,  pI: 18, docI: 0, svc: 'Review Check Up',              status: 'COMPLETED' as const, paid: true,  amount: 30000  },
        { d: -7,  h: 9,  m: 30, pI: 21, docI: 3, svc: 'Child Tooth Extraction',       status: 'COMPLETED' as const, paid: true,  amount: 50000  },
        { d: -7,  h: 11, m: 0,  pI: 24, docI: 1, svc: 'Braces Fitting (Ceramic)',     status: 'COMPLETED' as const, paid: false, amount: 1800000},
        { d: -7,  h: 14, m: 0,  pI: 27, docI: 7, svc: 'Denture (Partial)',            status: 'COMPLETED' as const, paid: true,  amount: 500000 },
        { d: -6,  h: 9,  m: 0,  pI: 0,  docI: 2, svc: 'Fluoride Treatment',           status: 'COMPLETED' as const, paid: true,  amount: 40000  },
        { d: -6,  h: 10, m: 0,  pI: 3,  docI: 5, svc: 'Tooth Extraction (Surgical)',  status: 'COMPLETED' as const, paid: true,  amount: 150000 },
        { d: -6,  h: 11, m: 30, pI: 6,  docI: 6, svc: 'Dental Filling (Amalgam)',     status: 'CANCELLED' as const, paid: false, amount: 70000  },
        { d: -5,  h: 8,  m: 0,  pI: 9,  docI: 0, svc: 'Emergency Dental Consult',    status: 'COMPLETED' as const, paid: true,  amount: 60000  },
        { d: -5,  h: 9,  m: 30, pI: 12, docI: 4, svc: 'Root Canal Treatment',         status: 'COMPLETED' as const, paid: true,  amount: 350000 },
        { d: -5,  h: 11, m: 0,  pI: 15, docI: 1, svc: 'Braces Adjustment',           status: 'COMPLETED' as const, paid: true,  amount: 80000  },
        { d: -5,  h: 14, m: 30, pI: 18, docI: 3, svc: 'Full Mouth X-Ray (OPG)',       status: 'COMPLETED' as const, paid: true,  amount: 120000 },
        { d: -4,  h: 8,  m: 30, pI: 21, docI: 7, svc: 'Denture (Full)',               status: 'COMPLETED' as const, paid: false, amount: 800000 },
        { d: -4,  h: 10, m: 0,  pI: 24, docI: 2, svc: 'Oral Cancer Screening',        status: 'COMPLETED' as const, paid: true,  amount: 60000  },
        { d: -3,  h: 8,  m: 0,  pI: 4,  docI: 6, svc: 'Dental Veneers (Porcelain)',   status: 'COMPLETED' as const, paid: true,  amount: 800000 },
        { d: -3,  h: 9,  m: 30, pI: 7,  docI: 0, svc: 'Check and Treat',              status: 'COMPLETED' as const, paid: true,  amount: 50000  },
        { d: -3,  h: 11, m: 0,  pI: 10, docI: 5, svc: 'Tooth Extraction (Simple)',    status: 'COMPLETED' as const, paid: true,  amount: 60000  },
        { d: -3,  h: 15, m: 0,  pI: 13, docI: 1, svc: 'Clear Aligner (Invisalign)',   status: 'COMPLETED' as const, paid: false, amount: 3500000},
        { d: -2,  h: 8,  m: 0,  pI: 16, docI: 4, svc: 'Root Canal Treatment',         status: 'COMPLETED' as const, paid: true,  amount: 350000 },
        { d: -2,  h: 9,  m: 0,  pI: 19, docI: 3, svc: 'Child Dental Check-Up',        status: 'COMPLETED' as const, paid: true,  amount: 40000  },
        { d: -2,  h: 10, m: 30, pI: 22, docI: 7, svc: 'Dental CT Scan (CBCT)',        status: 'COMPLETED' as const, paid: true,  amount: 250000 },
        { d: -1,  h: 8,  m: 30, pI: 25, docI: 0, svc: 'Dental Cleaning (Scaling)',    status: 'COMPLETED' as const, paid: true,  amount: 80000  },
        { d: -1,  h: 10, m: 0,  pI: 27, docI: 2, svc: 'Deep Scaling & Root Planing',  status: 'COMPLETED' as const, paid: true,  amount: 180000 },
        { d: -1,  h: 11, m: 30, pI: 1,  docI: 5, svc: 'Wisdom Tooth Extraction',      status: 'COMPLETED' as const, paid: false, amount: 200000 },
        // Future appointments (next 7 days)
        { d: 1,  h: 8,  m: 0,  pI: 5,  docI: 1, svc: 'Braces Adjustment',            status: 'CONFIRMED' as const, paid: false, amount: 80000  },
        { d: 1,  h: 9,  m: 0,  pI: 8,  docI: 3, svc: 'Fissure Sealant',              status: 'CONFIRMED' as const, paid: false, amount: 35000  },
        { d: 1,  h: 10, m: 0,  pI: 11, docI: 0, svc: 'Review Check Up',              status: 'CONFIRMED' as const, paid: false, amount: 30000  },
        { d: 1,  h: 14, m: 0,  pI: 14, docI: 6, svc: 'Dental Filling (Composite)',   status: 'CONFIRMED' as const, paid: false, amount: 90000  },
        { d: 2,  h: 9,  m: 0,  pI: 17, docI: 2, svc: 'Periodontal Therapy',          status: 'CONFIRMED' as const, paid: false, amount: 120000 },
        { d: 2,  h: 10, m: 30, pI: 20, docI: 5, svc: 'Tooth Extraction (Surgical)',  status: 'CONFIRMED' as const, paid: false, amount: 150000 },
        { d: 2,  h: 14, m: 0,  pI: 23, docI: 7, svc: 'Dental Crown (Porcelain)',     status: 'CONFIRMED' as const, paid: false, amount: 700000 },
        { d: 3,  h: 8,  m: 0,  pI: 2,  docI: 1, svc: 'Braces Fitting (Metal)',       status: 'CONFIRMED' as const, paid: false, amount: 1200000},
        { d: 3,  h: 9,  m: 30, pI: 6,  docI: 4, svc: 'Root Canal Treatment',         status: 'CONFIRMED' as const, paid: false, amount: 350000 },
        { d: 3,  h: 11, m: 0,  pI: 9,  docI: 0, svc: 'Check and Treat',              status: 'CONFIRMED' as const, paid: false, amount: 50000  },
        { d: 4,  h: 8,  m: 30, pI: 12, docI: 6, svc: 'Teeth Whitening (In-Chair)',   status: 'CONFIRMED' as const, paid: false, amount: 250000 },
        { d: 4,  h: 10, m: 0,  pI: 15, docI: 3, svc: 'Space Maintainer',             status: 'CONFIRMED' as const, paid: false, amount: 120000 },
        { d: 5,  h: 9,  m: 0,  pI: 18, docI: 7, svc: 'Denture (Partial)',            status: 'CONFIRMED' as const, paid: false, amount: 500000 },
        { d: 5,  h: 11, m: 0,  pI: 21, docI: 2, svc: 'Oral Cancer Screening',        status: 'CONFIRMED' as const, paid: false, amount: 60000  },
        { d: 6,  h: 8,  m: 0,  pI: 24, docI: 5, svc: 'Emergency Dental Consult',    status: 'CONFIRMED' as const, paid: false, amount: 60000  },
        { d: 7,  h: 9,  m: 0,  pI: 0,  docI: 1, svc: 'Braces Adjustment',           status: 'PENDING'   as const, paid: false, amount: 80000  },
        { d: 7,  h: 10, m: 30, pI: 3,  docI: 4, svc: 'Root Canal Retreatment',       status: 'PENDING'   as const, paid: false, amount: 450000 },
        { d: 7,  h: 14, m: 0,  pI: 6,  docI: 0, svc: 'Dental Cleaning (Scaling)',    status: 'PENDING'   as const, paid: false, amount: 80000  },
      ]

      let histCount = 0
      const createdAppts: Array<{ id: string; amount: number; paid: boolean; status: string }> = []
      for (const slot of histSlots) {
        const doctor  = allDocs[slot.docI % allDocs.length]
        const patient = allPats[slot.pI  % allPats.length]
        const service = allSvcs.find(s => s.name === slot.svc) || allSvcs[0]
        if (!doctor || !patient || !service || !adminU) continue
        const startAt = dayOffset(slot.d, slot.h, slot.m)
        const endAt   = new Date(startAt.getTime() + service.durationMins * 60000)
        try {
          const appt = await prisma.appointment.upsert({
            where: { doctorId_startAt: { doctorId: doctor.id, startAt } },
            update: { status: slot.status },
            create: { patientId: patient.id, doctorId: doctor.id, serviceId: service.id, startAt, endAt, status: slot.status, createdById: adminU.id },
          })
          createdAppts.push({ id: appt.id, amount: slot.amount, paid: slot.paid, status: slot.status })
          histCount++
        } catch { /* skip conflicts */ }
      }
      log(`${histCount} historical/future appointments upserted`)

      // ── 12. Invoices + payments for completed appointments ────
      let invoiceCount = 0
      for (const a of createdAppts) {
        if (!['COMPLETED', 'DEPARTED', 'SESSION_COMPLETE'].includes(a.status)) continue
        const patient = await prisma.appointment.findUnique({ where: { id: a.id }, select: { patientId: true } })
        if (!patient) continue
        try {
          const invoice = await (prisma.invoice as any).upsert({
            where: { appointmentId: a.id },
            update: {},
            create: {
              patientId:     patient.patientId,
              appointmentId: a.id,
              subtotal:      a.amount,
              vatAmount:     Math.round(a.amount * 0.18),
              totalAmount:   Math.round(a.amount * 1.18),
              amountPaid:    a.paid ? Math.round(a.amount * 1.18) : 0,
              status:        a.paid ? 'PAID' : 'PENDING',
              dueDate:       new Date(Date.now() + 14 * 86400000),
              notes:         'Dental treatment at Code Clinic',
            },
          })
          if (a.paid) {
            const existingPayment = await (prisma.payment as any).findFirst({ where: { invoiceId: invoice.id } })
            if (!existingPayment) {
              await (prisma.payment as any).create({
                data: {
                  patientId:    patient.patientId,
                  invoiceId:    invoice.id,
                  amountPaid:   Math.round(a.amount * 1.18),
                  method:       ['CASH', 'MOBILE_MONEY', 'CARD'][Math.floor(Math.random() * 3)],
                  reference:    `CC${Date.now().toString().slice(-6)}`,
                  paidAt:       new Date(),
                },
              })
            }
          }
          invoiceCount++
        } catch { /* skip */ }
      }
      log(`${invoiceCount} invoices created`)
    }

    // ── 13. Treatment notes for demo patients ─────────────────
    const notePatients = await prisma.patient.findMany({ take: 10 })
    const adminForNotes = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const noteTemplates = [
      'Patient presented with mild sensitivity on upper left molar. Scaling and root planing performed. Advised to use sensitivity toothpaste and return in 6 weeks.',
      'Routine check-up completed. Slight calculus buildup noted on lower anteriors. Professional cleaning done. Patient educated on flossing technique.',
      'Patient complains of intermittent pain on lower right quadrant. Periapical X-ray taken. Caries detected on tooth 46 — composite filling placed. Review in 3 months.',
      'Orthodontic adjustment visit. Arch wire adjusted, elastics replaced. Oral hygiene reinforced. Patient progressing well with treatment.',
      'Root canal treatment initiated on tooth 36. Access cavity prepared, canals cleaned and shaped. Temporary dressing placed. Return in 2 weeks for obturation.',
      'Post-extraction review. Socket healing well, no signs of dry socket. Patient advised to continue salt-water rinses and soft diet for another week.',
      'Teeth whitening session completed. 3 rounds of 15-minute whitening gel application. Patient achieved 4 shades lighter. Post-care instructions given.',
      'Paediatric dental check-up. All primary teeth present and healthy. Fluoride varnish applied. Dietary counselling given to parent regarding sugar intake.',
      'Patient attended for partial denture fitting. Denture seated well with good retention. Patient instructed on removal, cleaning, and storage.',
      'Emergency visit — patient presented with severe toothache. Tooth 14 assessed, abscess confirmed. Antibiotics prescribed: Amoxicillin 500mg TDS × 5 days. Extraction scheduled for next visit.',
    ]
    if (adminForNotes) {
      for (let i = 0; i < Math.min(notePatients.length, noteTemplates.length); i++) {
        const existing = await prisma.treatmentNote.findFirst({ where: { patientId: notePatients[i].id } })
        if (!existing) {
          await prisma.treatmentNote.create({
            data: {
              patientId: notePatients[i].id,
              content:   noteTemplates[i],
              authorId:  adminForNotes.id,
            },
          })
        }
      }
      log(`${Math.min(notePatients.length, noteTemplates.length)} treatment notes created`)
    }

    // ── 14. Demo expenses (current month) ─────────────────────
    const expenseDefs = [
      { category: 'Rent',          description: 'Monthly clinic rent — Kiira Road premises',      amount: 3500000, date: -28 },
      { category: 'Utilities',     description: 'Electricity bill — UMEME',                        amount: 450000,  date: -25 },
      { category: 'Utilities',     description: 'Water bill — NWSC',                               amount: 120000,  date: -25 },
      { category: 'Supplies',      description: 'Dental consumables — gloves, masks, bibs',        amount: 680000,  date: -20 },
      { category: 'Supplies',      description: 'Dental materials — composite, bonding agents',    amount: 920000,  date: -18 },
      { category: 'Supplies',      description: 'Sterilisation pouches and autoclave solution',    amount: 280000,  date: -15 },
      { category: 'Equipment',     description: 'Dental handpiece repair and servicing',           amount: 350000,  date: -12 },
      { category: 'Marketing',     description: 'Social media advertising — Facebook & Instagram', amount: 200000,  date: -10 },
      { category: 'Salaries',      description: 'Support staff salaries — receptionist & cleaner', amount: 1800000, date: -5  },
      { category: 'Miscellaneous', description: 'Printing — appointment cards and brochures',      amount: 95000,   date: -3  },
    ]
    const adminForExp = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    if (adminForExp) {
      for (const exp of expenseDefs) {
        const expDate = new Date()
        expDate.setDate(expDate.getDate() + exp.date)
        const existing = await (prisma.expense as any).findFirst({ where: { description: exp.description } })
        if (!existing) {
          try {
            await (prisma.expense as any).create({
              data: {
                category:    exp.category,
                description: exp.description,
                amount:      exp.amount,
                date:        expDate,
                createdById: adminForExp.id,
              },
            })
          } catch { /* model may not exist */ }
        }
      }
      log(`${expenseDefs.length} expenses seeded`)
    }

    return res.json({
      success: true,
      message: 'Production database seeded successfully',
      details: results,
      credentials: {
        admin:       'admin@codeclinic.ug / Admin@2024!',
        receptionist: 'reception@codeclinic.ug / Staff@2024!',
        accounts:    'accounts@codeclinic.ug / Staff@2024!',
      },
    })
  } catch (err: any) {
    console.error('[SEED] Error:', err)
    return res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) })
  }
})

// GET /setup/status — check if DB is seeded
router.get('/status', async (req, res) => {
  try {
    const [users, doctors, services, patients] = await Promise.all([
      prisma.user.count(),
      prisma.doctor.count(),
      prisma.service.count(),
      prisma.patient.count(),
    ])
    res.json({ users, doctors, services, patients, seeded: users > 0 })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
