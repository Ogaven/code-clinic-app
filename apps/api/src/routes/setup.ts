/**
 * POST /setup/seed-production
 * One-time endpoint to seed the production database.
 * Protected by SEED_SECRET env var — delete or disable after first use.
 */
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { execSync } from 'child_process'

const router = Router()
const prisma = new PrismaClient()

// POST /setup/migrate — sync schema without full seed
router.post('/migrate', async (req, res) => {
  const secret = req.headers['x-seed-secret'] || req.body?.secret
  const expected = process.env.SEED_SECRET || 'codeclinic-demo-2026'
  if (secret !== expected) return res.status(403).json({ error: 'Invalid seed secret' })
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: process.cwd(), stdio: 'pipe', timeout: 120000,
    })
    res.json({ success: true, message: 'Schema pushed to database' })
  } catch (e: any) {
    res.status(500).json({ error: 'Migration failed', detail: e.message })
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
      execSync('npx prisma db push --skip-generate --accept-data-loss', {
        cwd: process.cwd(), stdio: 'pipe', timeout: 120000,
      })
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
        { pIdx: 0, dIdx: 0, sIdx: 0,  h: 9,  m: 0,  status: 'IN_PROGRESS' as const },
        { pIdx: 1, dIdx: 0, sIdx: 3,  h: 10, m: 0,  status: 'CONFIRMED'   as const },
        { pIdx: 2, dIdx: 1, sIdx: 1,  h: 11, m: 0,  status: 'CONFIRMED'   as const },
        { pIdx: 3, dIdx: 1, sIdx: 7,  h: 14, m: 0,  status: 'SCHEDULED'   as const },
        { pIdx: 4, dIdx: 2, sIdx: 2,  h: 15, m: 30, status: 'SCHEDULED'   as const },
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
