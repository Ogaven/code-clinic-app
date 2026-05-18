/**
 * Code Clinic Demo Seed Script
 * Run: npx tsx --env-file=.env scripts/seed-demo.ts
 * Alt: npx ts-node --esModuleInterop scripts/seed-demo.ts
 */

// Load .env from repo root if DATABASE_URL not already in environment
if (!process.env.DATABASE_URL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config()
  } catch {
    // dotenv not installed — DATABASE_URL must already be in process.env
  }
}

import { PrismaClient, Gender, AppointmentStatus, InvoiceStatus } from '@prisma/client'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcryptjs') as typeof import('bcryptjs')

const prisma = new PrismaClient()

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysAgo(n: number, hour = 9, min = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, min, 0, 0)
  return d
}

function daysFromNow(n: number, hour = 9, min = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hour, min, 0, 0)
  return d
}

function today(hour = 9, min = 0): Date {
  const d = new Date()
  d.setHours(hour, min, 0, 0)
  return d
}

function yearsAgo(n: number): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Code Clinic Demo Seed ===\n')

  // ── 1. STAFF ──────────────────────────────────────────────────────────────
  console.log('[1/9] Staff...')
  const demoHash = await bcrypt.hash('Demo2026!', 12)

  const james = await prisma.user.upsert({
    where: { email: 'james@codeclinic.ug' },
    update: {},
    create: {
      email: 'james@codeclinic.ug',
      passwordHash: demoHash,
      role: 'DOCTOR',
      firstName: 'James',
      lastName: 'Okello',
      phone: '256701100001',
      isActive: true,
    },
  })

  let jamesDoc = await prisma.doctor.findUnique({ where: { userId: james.id } })
  if (!jamesDoc) {
    jamesDoc = await prisma.doctor.create({
      data: {
        userId: james.id,
        specialisation: 'General Dentistry & Oral Surgery',
        colour: '#1565C0',
        workingDays: '[1,2,3,4,5]',
        workingHours: '{"start":"08:00","end":"18:00"}',
      },
    })
  }

  const sarah = await prisma.user.upsert({
    where: { email: 'sarah@codeclinic.ug' },
    update: {},
    create: {
      email: 'sarah@codeclinic.ug',
      passwordHash: demoHash,
      role: 'DOCTOR',
      firstName: 'Sarah',
      lastName: 'Namukasa',
      phone: '256774100002',
      isActive: true,
    },
  })

  let sarahDoc = await prisma.doctor.findUnique({ where: { userId: sarah.id } })
  if (!sarahDoc) {
    sarahDoc = await prisma.doctor.create({
      data: {
        userId: sarah.id,
        specialisation: 'Orthodontics & Cosmetic Dentistry',
        colour: '#29ABE2',
        workingDays: '[1,2,3,4,5,6]',
        workingHours: '{"start":"08:00","end":"17:00"}',
      },
    })
  }

  const mary = await prisma.user.upsert({
    where: { email: 'mary@codeclinic.ug' },
    update: {},
    create: {
      email: 'mary@codeclinic.ug',
      passwordHash: demoHash,
      role: 'RECEPTIONIST',
      firstName: 'Mary',
      lastName: 'Nakato',
      phone: '256750100003',
      isActive: true,
    },
  })

  const john = await prisma.user.upsert({
    where: { email: 'john@codeclinic.ug' },
    update: {},
    create: {
      email: 'john@codeclinic.ug',
      passwordHash: demoHash,
      role: 'ACCOUNTS',
      firstName: 'John',
      lastName: 'Ssebulime',
      phone: '256779100004',
      isActive: true,
    },
  })

  console.log('  ✓ Dr. James Okello, Dr. Sarah Namukasa, Mary Nakato, John Ssebulime')

  // ── 2. SERVICES ───────────────────────────────────────────────────────────
  console.log('[2/9] Services...')

  const svcDefs = [
    { name: 'Dental Checkup',      description: 'Comprehensive oral examination and health assessment',           category: 'Preventive',   durationMins: 30,  priceUGX: 50000,  colour: '#4CAF50' },
    { name: 'Teeth Cleaning',      description: 'Professional scaling and polishing to remove plaque and tartar', category: 'Preventive',   durationMins: 45,  priceUGX: 80000,  colour: '#2196F3' },
    { name: 'Tooth Filling',       description: 'Composite resin or amalgam filling for cavities',               category: 'Restorative',  durationMins: 60,  priceUGX: 150000, colour: '#FF9800' },
    { name: 'Tooth Extraction',    description: 'Simple or surgical removal of a tooth',                         category: 'Oral Surgery', durationMins: 45,  priceUGX: 120000, colour: '#F44336' },
    { name: 'Teeth Whitening',     description: 'Professional in-office whitening treatment',                    category: 'Cosmetic',     durationMins: 90,  priceUGX: 300000, colour: '#9C27B0' },
    { name: 'Root Canal',          description: 'Endodontic treatment to save an infected tooth',                category: 'Endodontics',  durationMins: 120, priceUGX: 500000, colour: '#795548' },
    { name: 'Dental Crown',        description: 'Full porcelain or metal-ceramic crown to restore a damaged tooth', category: 'Restorative', durationMins: 90, priceUGX: 800000, colour: '#607D8B' },
    { name: 'Braces Consultation', description: 'Orthodontic assessment and treatment planning',                  category: 'Orthodontics', durationMins: 30,  priceUGX: 100000, colour: '#E91E63' },
    { name: 'Dental X-ray',        description: 'Digital periapical or panoramic X-ray imaging',                 category: 'Diagnostic',   durationMins: 20,  priceUGX: 60000,  colour: '#00BCD4' },
    { name: 'Emergency Dental Care', description: 'Urgent dental treatment for pain relief or trauma',           category: 'Emergency',    durationMins: 60,  priceUGX: 200000, colour: '#FF5722' },
  ]

  const services: any[] = []
  for (const s of svcDefs) {
    const svc = await prisma.service.upsert({
      where: { name: s.name },
      update: {},
      create: { ...s, vatApplicable: false, isActive: true },
    })
    services.push(svc)
  }
  console.log(`  ✓ ${services.length} services`)

  // ── 3. PATIENTS ───────────────────────────────────────────────────────────
  console.log('[3/9] Patients...')

  const existingPtCount = await prisma.patient.count()
  let patients: any[] = []

  const ptDefs = [
    // 0
    { firstName: 'David',     lastName: 'Mukasa',    phone: '256774234567', gender: Gender.MALE,   dob: yearsAgo(34), address: 'Plot 12, Kampala Road, Kampala',    district: 'Kampala', nextOfKinName: 'Susan Mukasa',    nextOfKinPhone: '256701234568', nextOfKinRelation: 'Wife',    allergies: null,           medicalHistory: 'Hypertension — on Amlodipine 5mg daily' },
    // 1
    { firstName: 'Grace',     lastName: 'Nakamya',   phone: '256701345678', gender: Gender.FEMALE, dob: yearsAgo(28), address: 'Ntinda, Kampala',                   district: 'Kampala', nextOfKinName: 'Peter Nakamya',   nextOfKinPhone: '256779345679', nextOfKinRelation: 'Husband', allergies: 'Penicillin',    medicalHistory: null },
    // 2
    { firstName: 'Robert',    lastName: 'Ssemakula', phone: '256779456789', gender: Gender.MALE,   dob: yearsAgo(45), address: 'Nansana, Wakiso',                   district: 'Wakiso',  nextOfKinName: 'Jane Ssemakula',  nextOfKinPhone: '256750456790', nextOfKinRelation: 'Wife',    allergies: null,           medicalHistory: 'Type 2 Diabetes — HbA1c 7.2%, on Metformin 500mg BD' },
    // 3
    { firstName: 'Sarah',     lastName: 'Namutebi',  phone: '256750567890', gender: Gender.FEMALE, dob: yearsAgo(22), address: 'Kololo, Kampala',                   district: 'Kampala', nextOfKinName: 'Mary Namutebi',   nextOfKinPhone: '256774567891', nextOfKinRelation: 'Mother',  allergies: 'Latex',         medicalHistory: null },
    // 4
    { firstName: 'Emmanuel',  lastName: 'Katumba',   phone: '256774678901', gender: Gender.MALE,   dob: yearsAgo(52), address: 'Makindye, Kampala',                 district: 'Kampala', nextOfKinName: 'Ruth Katumba',    nextOfKinPhone: '256701678902', nextOfKinRelation: 'Wife',    allergies: null,           medicalHistory: 'Asthma — on Salbutamol PRN; Aspirin sensitivity noted' },
    // 5
    { firstName: 'Harriet',   lastName: 'Nansubuga', phone: '256701789012', gender: Gender.FEMALE, dob: yearsAgo(38), address: 'Kireka, Kampala',                   district: 'Kampala', nextOfKinName: 'Simon Nansubuga', nextOfKinPhone: '256779789013', nextOfKinRelation: 'Husband', allergies: null,           medicalHistory: null },
    // 6
    { firstName: 'Ivan',      lastName: 'Mugisha',   phone: '256779890123', gender: Gender.MALE,   dob: yearsAgo(15), address: 'Rubaga, Kampala',                   district: 'Kampala', nextOfKinName: 'Patricia Mugisha',nextOfKinPhone: '256750890124', nextOfKinRelation: 'Mother',  allergies: null,           medicalHistory: null },
    // 7
    { firstName: 'Mary',      lastName: 'Najjuko',   phone: '256750901234', gender: Gender.FEMALE, dob: yearsAgo(67), address: 'Mengo, Kampala',                    district: 'Kampala', nextOfKinName: 'Francis Najjuko', nextOfKinPhone: '256774901235', nextOfKinRelation: 'Son',     allergies: 'Sulfonamides', medicalHistory: 'Hypertension; Osteoporosis; Type 2 Diabetes' },
    // 8
    { firstName: 'Patrick',   lastName: 'Odhiambo',  phone: '256774012345', gender: Gender.MALE,   dob: yearsAgo(41), address: 'Bukoto, Kampala',                   district: 'Kampala', nextOfKinName: 'Agness Odhiambo', nextOfKinPhone: '256701012346', nextOfKinRelation: 'Wife',    allergies: null,           medicalHistory: 'HIV positive — on ART regimen; inform dentist before invasive procedures' },
    // 9
    { firstName: 'Christine', lastName: 'Nalwoga',   phone: '256701123456', gender: Gender.FEMALE, dob: yearsAgo(31), address: 'Kiwatule, Kampala',                 district: 'Kampala', nextOfKinName: 'Daniel Nalwoga',  nextOfKinPhone: '256779123457', nextOfKinRelation: 'Husband', allergies: null,           medicalHistory: null },
    // 10
    { firstName: 'Moses',     lastName: 'Wasswa',    phone: '256779234567', gender: Gender.MALE,   dob: yearsAgo(8),  address: 'Entebbe, Wakiso',                   district: 'Wakiso',  nextOfKinName: 'Rebecca Wasswa',  nextOfKinPhone: '256750234568', nextOfKinRelation: 'Mother',  allergies: null,           medicalHistory: null },
    // 11
    { firstName: 'Agnes',     lastName: 'Nampijja',  phone: '256750345678', gender: Gender.FEMALE, dob: yearsAgo(55), address: 'Bwaise, Kampala',                   district: 'Kampala', nextOfKinName: 'John Nampijja',   nextOfKinPhone: '256774345679', nextOfKinRelation: 'Son',     allergies: 'Codeine',      medicalHistory: 'Hypertension — on Lisinopril; Osteoarthritis both knees' },
    // 12
    { firstName: 'Henry',     lastName: 'Kibirige',  phone: '256774456789', gender: Gender.MALE,   dob: yearsAgo(29), address: 'Mutungo, Kampala',                  district: 'Kampala', nextOfKinName: 'Susan Kibirige',  nextOfKinPhone: '256701456790', nextOfKinRelation: 'Mother',  allergies: null,           medicalHistory: null },
    // 13
    { firstName: 'Florence',  lastName: 'Nabuuma',   phone: '256701567890', gender: Gender.FEMALE, dob: yearsAgo(44), address: 'Nakawa, Kampala',                   district: 'Kampala', nextOfKinName: 'Fred Nabuuma',    nextOfKinPhone: '256779567891', nextOfKinRelation: 'Husband', allergies: 'Ibuprofen',    medicalHistory: 'Fibromyalgia; Mild asthma — on Fluticasone inhaler' },
    // 14
    { firstName: 'Samuel',    lastName: 'Sserwanga', phone: '256779678901', gender: Gender.MALE,   dob: yearsAgo(63), address: 'Kawempe, Kampala',                  district: 'Kampala', nextOfKinName: 'Lydia Sserwanga', nextOfKinPhone: '256750678902', nextOfKinRelation: 'Wife',    allergies: null,           medicalHistory: 'Coronary artery disease — on Warfarin (INR target 2.0–3.0); Hypertension' },
    // 15
    { firstName: 'Judith',    lastName: 'Nalubega',  phone: '256750789012', gender: Gender.FEMALE, dob: yearsAgo(19), address: 'Kyebando, Kampala',                 district: 'Kampala', nextOfKinName: 'Martha Nalubega', nextOfKinPhone: '256774789013', nextOfKinRelation: 'Mother',  allergies: null,           medicalHistory: null },
    // 16
    { firstName: 'Richard',   lastName: 'Matovu',    phone: '256774890123', gender: Gender.MALE,   dob: yearsAgo(37), address: 'Konge, Kampala',                    district: 'Kampala', nextOfKinName: 'Helen Matovu',    nextOfKinPhone: '256701890124', nextOfKinRelation: 'Wife',    allergies: 'Amoxicillin',  medicalHistory: 'Epilepsy — on Phenytoin 100mg BD; ensure no drug interactions' },
    // 17
    { firstName: 'Priscilla', lastName: 'Nakato',    phone: '256701901234', gender: Gender.FEMALE, dob: yearsAgo(48), address: 'Kisaasi, Kampala',                  district: 'Kampala', nextOfKinName: 'George Nakato',   nextOfKinPhone: '256779901235', nextOfKinRelation: 'Husband', allergies: null,           medicalHistory: 'Hypothyroidism — on Levothyroxine 50mcg daily' },
    // 18
    { firstName: 'Benjamin',  lastName: 'Omoding',   phone: '256779012345', gender: Gender.MALE,   dob: yearsAgo(25), address: 'Luzira, Kampala',                   district: 'Kampala', nextOfKinName: 'Anne Omoding',    nextOfKinPhone: '256750012346', nextOfKinRelation: 'Sister',  allergies: null,           medicalHistory: null },
    // 19
    { firstName: 'Betty',     lastName: 'Kagwa',     phone: '256750123456', gender: Gender.FEMALE, dob: yearsAgo(71), address: 'Ggaba, Kampala',                    district: 'Kampala', nextOfKinName: 'Joseph Kagwa',    nextOfKinPhone: '256774123457', nextOfKinRelation: 'Son',     allergies: 'NSAIDs',       medicalHistory: 'Hypertension; Type 2 Diabetes; Chronic Kidney Disease stage 2' },
  ]

  if (existingPtCount < 5) {
    for (const p of ptDefs) {
      const pt = await prisma.patient.create({ data: p })
      patients.push(pt)
    }
    console.log(`  ✓ Created ${patients.length} patients`)
  } else {
    patients = await prisma.patient.findMany({ take: 20, orderBy: { createdAt: 'asc' } })
    console.log(`  ℹ Skipped — ${existingPtCount} patients already exist, using first ${patients.length}`)
  }

  if (patients.length < 10) {
    console.log('  ✗ Not enough patients to continue. Aborting appointments section.')
  }

  // ── 4. APPOINTMENTS ───────────────────────────────────────────────────────
  console.log('[4/9] Appointments...')

  const existingApptCount = await prisma.appointment.count()
  const createdAppts: any[] = []

  type ApptDef = {
    pIdx: number            // patient index
    dIdx: number            // doctor index (0=james, 1=sarah)
    sIdx: number            // service index
    day: number             // negative=past, 0=today, positive=future
    hour: number
    min: number
    status: AppointmentStatus
    notes?: string
  }

  const apptDefs: ApptDef[] = [
    // ── Past 7 days (COMPLETED) ──────────────────────────────────────────────
    { pIdx:  0, dIdx: 0, sIdx: 0, day: -7, hour:  8, min:  0, status: 'COMPLETED', notes: 'Full oral examination completed. Good oral hygiene overall. Advised improved interdental cleaning. Next review in 6 months.' },
    { pIdx:  1, dIdx: 1, sIdx: 4, day: -7, hour: 10, min:  0, status: 'COMPLETED', notes: 'In-office whitening session completed. Pre-treatment shade A3, post-treatment shade A1. Patient very satisfied. Sensitivity noted — advised Sensodyne for 1 week.' },
    { pIdx:  2, dIdx: 0, sIdx: 2, day: -6, hour:  9, min:  0, status: 'COMPLETED', notes: 'UR6 composite filling placed under rubber dam isolation. Adequate depth of cure. Blood sugar reported as 9.4 mmol/L — noted, patient reminded to review with physician.' },
    { pIdx:  3, dIdx: 1, sIdx: 1, day: -6, hour: 11, min:  0, status: 'COMPLETED', notes: 'Full mouth supragingival and subgingival scaling completed. Generalised gingivitis with BOP. Oral hygiene instructions reinforced. 3-month recall advised.' },
    { pIdx:  4, dIdx: 0, sIdx: 3, day: -5, hour:  8, min: 30, status: 'COMPLETED', notes: 'LR5 simple extraction under Lignocaine 2% with adrenaline (2 carpules). No complications. Sutures not required. Prescribed Paracetamol 1g TDS (Aspirin sensitivity noted — avoided NSAIDs).' },
    { pIdx:  5, dIdx: 1, sIdx: 7, day: -5, hour: 14, min:  0, status: 'COMPLETED', notes: 'Orthodontic consultation completed. Study models and CBCT advised. Patient suitable for full upper and lower fixed appliances. Estimated treatment 18–22 months. Cost plan provided.' },
    { pIdx:  6, dIdx: 0, sIdx: 8, day: -4, hour:  8, min:  0, status: 'COMPLETED', notes: 'OPG panoramic radiograph obtained. Unerupted UR8 (third molar) identified — adequate space, monitoring recommended. No active carious lesions on X-ray.' },
    { pIdx:  7, dIdx: 1, sIdx: 0, day: -4, hour:  9, min: 30, status: 'COMPLETED', notes: 'Dental checkup completed. Multiple missing teeth — 14, 15, 16, 24, 25, 26 absent. Discussed full upper acrylic denture vs implant-retained option. Patient to consider and return.' },
    { pIdx:  8, dIdx: 0, sIdx: 5, day: -3, hour: 10, min:  0, status: 'COMPLETED', notes: 'LL6 root canal therapy completed. Three canals (MB, ML, D) instrumented to ISO 25. Irrigated with NaOCl 2.5% and EDTA. Obturated with gutta-percha and AH Plus sealer. IRM temporary seal.' },
    { pIdx:  9, dIdx: 1, sIdx: 1, day: -3, hour: 14, min: 30, status: 'COMPLETED', notes: 'Scaling and polishing completed. Mild supragingival calculus removed. BOP at UR3, UL3, LL3 — early gingivitis. Oral hygiene score improved from last visit.' },
    { pIdx: 10, dIdx: 0, sIdx: 0, day: -2, hour:  8, min:  0, status: 'COMPLETED', notes: 'Paediatric dental checkup. Mixed dentition stage. Excellent oral hygiene. No active caries detected. Fluoride varnish (Duraphat) applied. Parents advised on reducing sugary snacks.' },
    { pIdx: 11, dIdx: 1, sIdx: 2, day: -2, hour: 10, min: 30, status: 'COMPLETED', notes: 'UL5 Class II composite restoration placed. Rubber dam isolation. Matrix band and wedge used for adequate proximal contact. Patient asked about whitening — provided leaflet.' },
    { pIdx: 12, dIdx: 0, sIdx: 3, day: -1, hour:  9, min:  0, status: 'COMPLETED', notes: 'LR7 surgical extraction. Tooth sectioned into 2 pieces for removal. Lignocaine 2% with adrenaline — 3 carpules. Interrupted sutures placed (4-0 Vicryl). Review appointment booked in 7 days.' },
    { pIdx: 13, dIdx: 1, sIdx: 9, day: -1, hour: 11, min:  0, status: 'COMPLETED', notes: 'Emergency visit — severe dental pain UL6. Peri-apical abscess confirmed on PA radiograph. Incision and drainage performed. Prescribed Metronidazole 400mg TDS x 5 days. Referred for root canal.' },
    { pIdx: 14, dIdx: 0, sIdx: 6, day: -4, hour: 14, min:  0, status: 'COMPLETED', notes: 'UR4 full porcelain crown cemented with RelyX Unicem. Occlusion adjusted — high point at buccal cusp corrected. Patient satisfied with aesthetics. Post-care instructions given.' },
    { pIdx: 15, dIdx: 1, sIdx: 4, day: -3, hour:  9, min:  0, status: 'COMPLETED', notes: 'Whitening treatment completed — 2 shades improvement. Patient reported mild sensitivity during procedure. Post-whitening care instructions provided. Home whitening kit dispensed.' },
    { pIdx: 16, dIdx: 0, sIdx: 8, day: -6, hour: 14, min: 30, status: 'COMPLETED', notes: 'Periapical radiograph UL1 — periapical radiolucency confirmed, consistent with chronic periapical abscess. Root canal treatment planned. Prescribd Amoxicillin 500mg TDS (allergy to Amoxicillin — CORRECTION: used Metronidazole 400mg TDS instead).' },
    { pIdx: 17, dIdx: 1, sIdx: 0, day: -5, hour:  9, min: 30, status: 'COMPLETED', notes: 'Routine dental assessment. Levothyroxine noted in medical history — no significant dental interactions. Mild enamel erosion on palatal surfaces of upper anteriors. Dietary advice given.' },
    { pIdx: 18, dIdx: 0, sIdx: 2, day: -7, hour: 14, min:  0, status: 'COMPLETED', notes: 'UR5 and UR6 composite restorations placed in single session. Both Class I cavities. Good access. Patient comfortable throughout. Advised avoid eating on that side for 1 hour.' },
    { pIdx: 19, dIdx: 1, sIdx: 1, day: -2, hour: 14, min:  0, status: 'COMPLETED', notes: 'Full mouth scaling. Heavy supra and subgingival calculus — significant deposits lingual lower anteriors. Patient reminded of importance of regular hygiene appointments. 3-month recall.' },

    // ── Today (mix of statuses) ───────────────────────────────────────────────
    { pIdx:  0, dIdx: 0, sIdx: 5, day: 0, hour:  8, min: 30, status: 'COMPLETED',   notes: 'UR6 root canal session 2. Canals re-instrumented to ISO 30. Permanent obturation with gutta-percha. Core build-up placed. Crown advised — referred to prosthodontic chair.' },
    { pIdx:  2, dIdx: 1, sIdx: 7, day: 0, hour:  9, min:  0, status: 'ARRIVED',     notes: undefined },
    { pIdx:  5, dIdx: 0, sIdx: 3, day: 0, hour: 10, min:  0, status: 'IN_PROGRESS', notes: undefined },
    { pIdx:  9, dIdx: 1, sIdx: 0, day: 0, hour: 11, min:  0, status: 'CONFIRMED',   notes: undefined },
    { pIdx: 12, dIdx: 0, sIdx: 1, day: 0, hour: 14, min:  0, status: 'CONFIRMED',   notes: undefined },
    { pIdx: 16, dIdx: 1, sIdx: 5, day: 0, hour: 15, min:  0, status: 'CONFIRMED',   notes: undefined },

    // ── Next 7 days (CONFIRMED) ───────────────────────────────────────────────
    { pIdx:  1, dIdx: 0, sIdx: 6, day: 1, hour:  9, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx:  3, dIdx: 1, sIdx: 4, day: 1, hour: 10, min: 30, status: 'CONFIRMED', notes: undefined },
    { pIdx:  6, dIdx: 0, sIdx: 0, day: 2, hour:  8, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx:  7, dIdx: 1, sIdx: 2, day: 2, hour:  9, min: 30, status: 'CONFIRMED', notes: undefined },
    { pIdx:  8, dIdx: 0, sIdx: 6, day: 3, hour: 10, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 10, dIdx: 1, sIdx: 1, day: 3, hour: 14, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 11, dIdx: 0, sIdx: 8, day: 4, hour:  9, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 13, dIdx: 1, sIdx: 5, day: 4, hour: 11, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 14, dIdx: 0, sIdx: 3, day: 5, hour:  8, min: 30, status: 'CONFIRMED', notes: undefined },
    { pIdx: 15, dIdx: 1, sIdx: 7, day: 5, hour: 10, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 17, dIdx: 0, sIdx: 9, day: 6, hour:  9, min: 30, status: 'CONFIRMED', notes: undefined },
    { pIdx: 18, dIdx: 1, sIdx: 0, day: 6, hour: 14, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx: 19, dIdx: 0, sIdx: 2, day: 7, hour: 10, min:  0, status: 'CONFIRMED', notes: undefined },
    { pIdx:  4, dIdx: 1, sIdx: 3, day: 7, hour: 11, min: 30, status: 'CONFIRMED', notes: undefined },
  ]

  const docArr = [jamesDoc, sarahDoc]

  if (existingApptCount < 20 && patients.length >= 10) {
    for (const def of apptDefs) {
      if (def.pIdx >= patients.length) continue

      let startAt: Date
      if (def.day < 0)      startAt = daysAgo(-def.day, def.hour, def.min)
      else if (def.day > 0) startAt = daysFromNow(def.day, def.hour, def.min)
      else                  startAt = today(def.hour, def.min)

      const svc    = services[def.sIdx]
      const endAt  = new Date(startAt.getTime() + svc.durationMins * 60_000)
      const isCompleted = def.status === 'COMPLETED'
      const hasArrived  = def.status !== 'CONFIRMED' && def.status !== 'PENDING'

      const appt = await prisma.appointment.create({
        data: {
          patientId:  patients[def.pIdx].id,
          doctorId:   docArr[def.dIdx].id,
          serviceId:  svc.id,
          startAt,
          endAt,
          status:     def.status,
          notes:      def.notes ?? undefined,
          createdById: mary.id,
          arrivedAt:  hasArrived  ? new Date(startAt.getTime() - 10 * 60_000) : undefined,
          departedAt: isCompleted ? new Date(endAt.getTime()  + 10 * 60_000) : undefined,
        },
      })
      createdAppts.push(appt)
    }
    console.log(`  ✓ Created ${createdAppts.length} appointments`)
  } else {
    console.log(`  ℹ Skipped — ${existingApptCount} appointments already exist`)
  }

  // ── 5. TREATMENT NOTES ────────────────────────────────────────────────────
  console.log('[5/9] Treatment notes...')

  const existingNoteCount = await prisma.treatmentNote.count()
  const docUserArr = [james, sarah]

  const noteBank = [
    'Routine dental assessment completed. Patient in good general health. No contraindications to dental treatment. Reviewed medical history — no changes since last visit. Advised on fluoride use and electric toothbrush.',
    'Scaling and polishing performed. Generalised marginal gingivitis — BOP at 14 sites. Oral hygiene score: fair. Full OHI given including Bass brushing technique demonstration. 3-month recall set.',
    'Composite resin restoration (Class II, MO surface) placed on tooth 36 using rubber dam, sectional matrix and G-ring. Bite adjusted. Patient comfortable. Post-operative care instructions given.',
    'Tooth 47 — simple extraction under inferior alveolar nerve block. Lignocaine 2% with 1:80,000 adrenaline — 2 carpules. Tooth elevated and delivered without complication. Haemostasis achieved. Post-op instructions given.',
    'Professional teeth whitening completed. Pre-treatment: shade B3. Post-treatment: shade A1. Desensitising gel applied. Home whitening trays with 10% carbamide peroxide dispensed for maintenance.',
    'Root canal treatment tooth 16 (three canals: MB1, MB2, P). Working lengths confirmed with apex locator and radiograph. Instrumented to ISO 30. Irrigated with NaOCl 2.5% and 17% EDTA. Obturated with Thermafil system.',
    'Crown preparation for tooth 45. Chamfer margin placed supragingival buccally, equigingival lingually. Impressions: upper — Impregum, lower — alginate. Shade: A2 vita. Temporary crown with Protemp. Instructions given.',
    'Orthodontic brace review — 4 weeks since placement. Minor soreness reported initially, now resolved. Upper and lower archwires progressed from 0.014 NiTi to 0.016 NiTi. Oral hygiene around brackets — fair, reinforced.',
    'Periapical radiograph taken of tooth 21. Apical widening noted — possible periapical pathology. Root canal treatment recommended. Patient counselled and referred to endodontic chair. Prescribed Amoxicillin 500mg TDS x5 days.',
    'Emergency appointment — fractured cusp tooth 26 (upper left 6). Cusp fracture extending into dentine — no pulp exposure. Temporary dressing with Cavit placed. Definitive restoration planned next appointment.',
    'Paediatric review — patient aged 8. First permanent molars (16, 26, 36, 46) fully erupted. Fissure sealants applied to 16 and 26 using resin-based sealant. OHI given to child and parent. Dietary counselling — reduce frequency of sugary drinks.',
    'Full lower denture fitting appointment. Denture inserted — good suction achieved. Occlusion checked and minor equilibration performed. Patient instructed on insertion, removal and cleaning. Review in 1 week.',
    'Tooth sensitivity review — patient reports sensitivity to cold at tooth 25 following filling 10 days ago. Tooth WNL on percussion and palpation. Vitality test positive. Dentinal hypersensitivity diagnosis. Prescribed Sensodyne toothpaste, applied GC Tooth Mousse.',
    'Post-extraction review — 7 days following LL7 surgical extraction. Socket healing well — no evidence of dry socket. Sutures removed (3 × 4-0 Vicryl). Mild trismus resolving. Patient discharged from surgical care.',
    'TMJ assessment — patient presenting with clicking and discomfort on wide opening. Measurements: maximum opening 38mm, lateral excursion R 8mm, L 9mm. Splint therapy initiated — Michigan-style hard acrylic upper splint fabricated.',
    'Denture review — upper acrylic partial denture. Clasps adjusted on 13 and 23 — improved retention. Sore spot on palate — relief added. Patient advised on overnight removal and soaking in denture cleaner.',
    'Gingival assessment — generalised chronic periodontitis. BPE score: 3, 4, 4 / 3, 4, 3. Full-mouth debridement commenced — quadrant 1 completed today. Local anaesthesia: UL block. Review in 6 weeks post-debridement.',
    'Composite veneer placed on UL1 — tooth discoloured following trauma 2 years ago. Tooth etched with 37% phosphoric acid, bonded with Optibond FL, layered composite (Enamel Plus HFO). Excellent result — patient very pleased.',
    'Fluoride therapy session — high caries risk patient. Multiple active caries: UR4 (Class I), UR5 (Class II), LR4 (Class II). Treatment plan agreed. 2.26% fluoride varnish applied. Recall in 3 months.',
    'Implant review — osseointegration check for implant placed 4 months ago at position 36. Clinical stability confirmed — no peri-implant tenderness or mobility. Periapical radiograph: crestal bone at implant shoulder. Crown impressions taken.',
  ]

  if (existingNoteCount < 10 && createdAppts.length > 0) {
    const completedAppts = createdAppts.filter(a => a.status === 'COMPLETED')
    let ni = 0
    for (const appt of completedAppts) {
      await prisma.treatmentNote.create({
        data: {
          patientId: appt.patientId,
          content:   noteBank[ni % noteBank.length],
          authorId:  docUserArr[ni % 2].id,
        },
      })
      ni++
    }
    console.log(`  ✓ Created ${ni} treatment notes`)
  } else {
    console.log(`  ℹ Skipped — ${existingNoteCount} treatment notes already exist`)
  }

  // ── 6. DENTAL CHARTS ──────────────────────────────────────────────────────
  console.log('[6/9] Dental charts...')

  const existingChartCount = await prisma.dentalChart.count()

  if (existingChartCount < 3 && patients.length >= 10) {
    const chartDefs = [
      {
        pIdx: 0,
        teeth: JSON.stringify({
          '11': { status: 'healthy' }, '12': { status: 'healthy' }, '13': { status: 'healthy' },
          '14': { status: 'healthy' }, '15': { status: 'healthy' }, '16': { status: 'filled', note: 'Composite filling' },
          '17': { status: 'healthy' }, '21': { status: 'healthy' }, '22': { status: 'healthy' },
          '23': { status: 'healthy' }, '24': { status: 'healthy' }, '25': { status: 'caries', note: 'Early caries' },
          '26': { status: 'healthy' }, '27': { status: 'healthy' },
          '31': { status: 'healthy' }, '32': { status: 'healthy' }, '33': { status: 'healthy' },
          '34': { status: 'healthy' }, '35': { status: 'healthy' }, '36': { status: 'rct', note: 'Root canal completed' },
          '37': { status: 'healthy' }, '41': { status: 'healthy' }, '42': { status: 'healthy' },
          '43': { status: 'healthy' }, '44': { status: 'healthy' }, '45': { status: 'healthy' },
          '46': { status: 'missing', note: 'Extracted 2024' }, '47': { status: 'healthy' },
        }),
        periodontal: JSON.stringify({ generalNote: 'Mild generalised gingivitis. BPE 2/2/2.' }),
        aiSummary: 'Patient presents with mild gingivitis and a missing lower right 6. Root canal completed on lower left 6. Monitor early caries on upper left 5.',
      },
      {
        pIdx: 7,
        teeth: JSON.stringify({
          '11': { status: 'healthy' }, '12': { status: 'missing' }, '13': { status: 'healthy' },
          '14': { status: 'missing' }, '15': { status: 'missing' }, '16': { status: 'missing' },
          '17': { status: 'missing' }, '18': { status: 'missing' },
          '21': { status: 'healthy' }, '22': { status: 'missing' }, '23': { status: 'healthy' },
          '24': { status: 'missing' }, '25': { status: 'missing' }, '26': { status: 'missing' },
          '27': { status: 'missing' }, '28': { status: 'missing' },
          '31': { status: 'healthy' }, '32': { status: 'healthy' }, '33': { status: 'healthy' },
          '34': { status: 'missing' }, '35': { status: 'missing' }, '36': { status: 'missing' },
          '37': { status: 'missing' },
          '41': { status: 'healthy' }, '42': { status: 'healthy' }, '43': { status: 'healthy' },
          '44': { status: 'missing' }, '45': { status: 'missing' }, '46': { status: 'missing' },
          '47': { status: 'missing' },
        }),
        periodontal: JSON.stringify({ generalNote: 'Moderate bone loss on remaining teeth. BPE 3/3/3.' }),
        aiSummary: 'Severely dentate patient with multiple missing posterior teeth upper and lower. Suitable candidate for full upper denture and lower partial denture. Remaining anterior teeth relatively well maintained.',
      },
      {
        pIdx: 14,
        teeth: JSON.stringify({
          '11': { status: 'healthy' }, '12': { status: 'healthy' }, '13': { status: 'healthy' },
          '14': { status: 'crown', note: 'Porcelain crown cemented' }, '15': { status: 'healthy' },
          '16': { status: 'filled', note: 'Old amalgam' }, '17': { status: 'healthy' },
          '21': { status: 'healthy' }, '22': { status: 'healthy' }, '23': { status: 'healthy' },
          '24': { status: 'healthy' }, '25': { status: 'healthy' }, '26': { status: 'filled', note: 'Composite' },
          '31': { status: 'healthy' }, '32': { status: 'healthy' }, '33': { status: 'healthy' },
          '34': { status: 'healthy' }, '35': { status: 'healthy' }, '36': { status: 'healthy' },
          '37': { status: 'healthy' },
          '41': { status: 'healthy' }, '42': { status: 'healthy' }, '43': { status: 'healthy' },
          '44': { status: 'healthy' }, '45': { status: 'healthy' }, '46': { status: 'healthy' },
          '47': { status: 'healthy' },
        }),
        periodontal: JSON.stringify({ generalNote: 'Controlled periodontitis post-treatment. BPE 2/2/2. Maintained on 6-month recall.' }),
        aiSummary: 'Patient on Warfarin — INR must be within range before any invasive procedure. Crown UR4 placed. Old amalgam fillings present — monitor. Good periodontal status on maintenance programme.',
      },
      {
        pIdx: 2,
        teeth: JSON.stringify({
          '11': { status: 'healthy' }, '12': { status: 'healthy' }, '13': { status: 'healthy' },
          '14': { status: 'healthy' }, '15': { status: 'healthy' }, '16': { status: 'filled', note: 'Composite — new' },
          '17': { status: 'healthy' },
          '21': { status: 'healthy' }, '22': { status: 'healthy' }, '23': { status: 'healthy' },
          '24': { status: 'healthy' }, '25': { status: 'healthy' }, '26': { status: 'filled', note: 'Old composite' },
          '31': { status: 'healthy' }, '32': { status: 'healthy' }, '33': { status: 'healthy' },
          '34': { status: 'healthy' }, '35': { status: 'healthy' }, '36': { status: 'filled', note: 'Amalgam' },
          '37': { status: 'healthy' },
          '41': { status: 'healthy' }, '42': { status: 'healthy' }, '43': { status: 'healthy' },
          '44': { status: 'healthy' }, '45': { status: 'healthy' }, '46': { status: 'healthy' },
          '47': { status: 'healthy' },
        }),
        periodontal: JSON.stringify({ generalNote: 'Mild gingivitis. BPE 2/2/2.' }),
        aiSummary: 'Diabetic patient — healing may be impaired post extractions. Multiple filled teeth with no active caries currently. Good oral hygiene given education at previous appointments.',
      },
      {
        pIdx: 8,
        teeth: JSON.stringify({
          '11': { status: 'healthy' }, '12': { status: 'healthy' }, '13': { status: 'healthy' },
          '14': { status: 'healthy' }, '15': { status: 'healthy' }, '16': { status: 'healthy' },
          '21': { status: 'healthy' }, '22': { status: 'healthy' }, '23': { status: 'healthy' },
          '24': { status: 'healthy' }, '25': { status: 'healthy' }, '26': { status: 'healthy' },
          '31': { status: 'healthy' }, '32': { status: 'healthy' }, '33': { status: 'healthy' },
          '34': { status: 'healthy' }, '35': { status: 'healthy' }, '36': { status: 'rct', note: 'RCT completed — crown planned' },
          '37': { status: 'healthy' },
          '41': { status: 'healthy' }, '42': { status: 'healthy' }, '43': { status: 'healthy' },
          '44': { status: 'healthy' }, '45': { status: 'healthy' }, '46': { status: 'healthy' },
          '47': { status: 'healthy' },
        }),
        periodontal: JSON.stringify({ generalNote: 'Healthy periodontium. BPE 0/0/0.' }),
        aiSummary: 'Patient on ART — consult prescribing physician if prescribing antibiotics to check for interactions with ARV regimen. Root canal completed on LL6 — crown placement pending.',
      },
    ]

    for (const c of chartDefs) {
      if (c.pIdx >= patients.length) continue
      const existing = await prisma.dentalChart.findUnique({ where: { patientId: patients[c.pIdx].id } })
      if (!existing) {
        await prisma.dentalChart.create({
          data: {
            patientId:   patients[c.pIdx].id,
            teeth:       c.teeth,
            periodontal: c.periodontal,
            aiSummary:   c.aiSummary,
          },
        })
      }
    }
    console.log(`  ✓ Created up to 5 dental charts`)
  } else {
    console.log(`  ℹ Skipped — ${existingChartCount} charts already exist`)
  }

  // ── 7. INVOICES & PAYMENTS ────────────────────────────────────────────────
  console.log('[7/9] Invoices & payments...')

  const existingInvCount = await prisma.invoice.count()
  let invoicesCreated = 0

  const invoiceConfigs: Array<{ status: InvoiceStatus; paidFrac: number; method: string }> = [
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'MTN_MOMO'     },
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'AIRTEL_MONEY' },
    { status: 'PAID',    paidFrac: 1.0, method: 'VISA'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'MTN_MOMO'     },
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'MTN_MOMO'     },
    { status: 'PAID',    paidFrac: 1.0, method: 'AIRTEL_MONEY' },
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'PAID',    paidFrac: 1.0, method: 'CASH'         },
    { status: 'UNPAID',  paidFrac: 0,   method: 'CASH'         },
    { status: 'UNPAID',  paidFrac: 0,   method: 'CASH'         },
    { status: 'UNPAID',  paidFrac: 0,   method: 'CASH'         },
    { status: 'UNPAID',  paidFrac: 0,   method: 'CASH'         },
    { status: 'UNPAID',  paidFrac: 0,   method: 'CASH'         },
    { status: 'PARTIAL', paidFrac: 0.5, method: 'CASH'         },
    { status: 'PARTIAL', paidFrac: 0.5, method: 'MTN_MOMO'     },
    { status: 'PARTIAL', paidFrac: 0.5, method: 'CASH'         },
  ]

  if (existingInvCount < 10 && createdAppts.length > 0) {
    const completedForInv = createdAppts.filter(a => a.status === 'COMPLETED')

    for (let i = 0; i < Math.min(completedForInv.length, 20); i++) {
      const appt  = completedForInv[i]
      const svc   = services.find((s: any) => s.id === appt.serviceId) ?? services[0]
      const price = svc.priceUGX
      const conf  = invoiceConfigs[i] ?? invoiceConfigs[0]
      const paid  = Math.round(price * conf.paidFrac)
      const invNo = `DEMO-2026-${String(i + 1).padStart(4, '0')}`

      // Skip if appointment already has an invoice
      const existingInv = await prisma.invoice.findFirst({ where: { appointmentId: appt.id } })
      if (existingInv) continue

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: invNo,
          patientId:     appt.patientId,
          appointmentId: appt.id,
          lineItems:     JSON.stringify([{
            description: svc.name,
            quantity:    1,
            unitPrice:   price,
            total:       price,
          }]),
          subtotalUGX: price,
          vatUGX:      0,
          totalUGX:    price,
          paidUGX:     paid,
          status:      conf.status,
          dueDate:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          notes:       conf.status === 'PARTIAL' ? 'Partial payment received. Balance outstanding.' : undefined,
        },
      })

      if (paid > 0) {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            patientId: appt.patientId,
            amountUGX: paid,
            method:    conf.method,
            paidAt:    appt.startAt,
          },
        })
      }

      invoicesCreated++
    }
    console.log(`  ✓ Created ${invoicesCreated} invoices with payments`)
  } else {
    console.log(`  ℹ Skipped — ${existingInvCount} invoices already exist`)
  }

  // ── 8. EXPENSES ───────────────────────────────────────────────────────────
  console.log('[8/9] Expenses...')

  const existingExpCount = await prisma.expense.count()

  if (existingExpCount < 5) {
    const expDefs = [
      { category: 'Dental Supplies',    description: 'Composite resin and bonding adhesive — 10 syringes Tetric EvoCeram A2/A3',    amountUGX:  450000, daysAgoN:  3 },
      { category: 'Dental Supplies',    description: 'Monthly consumables: gloves, masks, sterilisation pouches, cotton rolls',      amountUGX:  280000, daysAgoN:  5 },
      { category: 'Equipment Service',  description: 'Annual dental chair servicing (2 chairs) and autoclave calibration — Kerioth', amountUGX: 1200000, daysAgoN:  8 },
      { category: 'Utilities',          description: 'Electricity bill — April 2026, UMEME account 70401234',                        amountUGX:  380000, daysAgoN: 10 },
      { category: 'Dental Supplies',    description: 'Local anaesthetic: Lignocaine 2% with adrenaline — 50 carpule pack',          amountUGX:  320000, daysAgoN: 12 },
      { category: 'Office Expenses',    description: 'Printing: appointment cards, prescription pads, patient consent forms',        amountUGX:   85000, daysAgoN: 14 },
      { category: 'Dental Supplies',    description: 'Dental X-ray periapical films and developing solutions — 200 film pack',       amountUGX:  210000, daysAgoN: 16 },
      { category: 'Equipment Purchase', description: 'Intraoral camera — Dentsply Sirona Schick — upgrade from analogue system',    amountUGX: 3500000, daysAgoN: 20 },
      { category: 'Utilities',          description: 'Water bill — April 2026, NWSC account',                                       amountUGX:   95000, daysAgoN: 22 },
      { category: 'Dental Supplies',    description: 'Impression materials: Alginate 5kg, Polyvinyl siloxane heavy and light body',  amountUGX:  360000, daysAgoN: 28 },
    ]

    for (const e of expDefs) {
      await prisma.expense.create({
        data: {
          category:     e.category,
          description:  e.description,
          amountUGX:    e.amountUGX,
          recordedById: john.id,
          date:         daysAgo(e.daysAgoN, 12, 0),
        },
      })
    }
    console.log(`  ✓ Created ${expDefs.length} expenses`)
  } else {
    console.log(`  ℹ Skipped — ${existingExpCount} expenses already exist`)
  }

  // ── 9. STOCK ITEMS ────────────────────────────────────────────────────────
  console.log('[9/9] Stock items...')

  const existingStockCount = await prisma.stockItem.count()

  if (existingStockCount < 5) {
    const stockDefs = [
      { name: 'Disposable Gloves (Medium)',             category: 'Consumables',     quantity: 500,  unit: 'boxes',  reorderLevel: 50,  unitCost:  8000, supplier: 'MedSupply Uganda Ltd' },
      { name: 'Face Masks 3-ply (Surgical)',            category: 'Consumables',     quantity: 300,  unit: 'boxes',  reorderLevel: 30,  unitCost:  6500, supplier: 'MedSupply Uganda Ltd' },
      { name: 'Dental Syringes (Aspirating)',           category: 'Equipment',       quantity: 200,  unit: 'units',  reorderLevel: 20,  unitCost:  4500, supplier: 'DentaProf Ltd Kampala' },
      { name: 'Composite Resin A2 (4g syringe)',        category: 'Dental Materials', quantity:  50,  unit: 'units',  reorderLevel: 10,  unitCost: 45000, supplier: 'Ivoclar Vivadent Uganda' },
      { name: 'Dental X-ray Film (Periapical D-speed)', category: 'Diagnostic',      quantity: 100,  unit: 'sheets', reorderLevel: 20,  unitCost:  2200, supplier: 'DiagnoTech East Africa' },
      { name: 'Sterilisation Pouches (Self-seal 57x100mm)', category: 'Consumables', quantity: 400,  unit: 'units',  reorderLevel: 50,  unitCost:   800, supplier: 'MedSupply Uganda Ltd' },
      { name: 'Lignocaine 2% w/ Adrenaline (1.8ml)',   category: 'Pharmacy',        quantity: 150,  unit: 'carpules', reorderLevel: 30, unitCost:  3500, supplier: 'Kampala Pharma Distributors' },
      { name: 'Carbide Bur FG Round #4',                category: 'Equipment',       quantity:  30,  unit: 'units',  reorderLevel: 10,  unitCost: 35000, supplier: 'DentaProf Ltd Kampala' },
      { name: 'Cotton Rolls (Medium)',                  category: 'Consumables',     quantity: 1000, unit: 'units',  reorderLevel: 100, unitCost:   150, supplier: 'MedSupply Uganda Ltd' },
      { name: 'Zinc Oxide Eugenol Cement (IRM)',        category: 'Dental Materials', quantity:  40,  unit: 'units',  reorderLevel: 10,  unitCost: 28000, supplier: 'DentaProf Ltd Kampala' },
    ]

    for (const s of stockDefs) {
      await prisma.stockItem.create({ data: s })
    }
    console.log(`  ✓ Created ${stockDefs.length} stock items`)
  } else {
    console.log(`  ℹ Skipped — ${existingStockCount} stock items already exist`)
  }

  // ── WHATSAPP CONVERSATIONS ─────────────────────────────────────────────────
  console.log('[+] WhatsApp conversations...')

  const existingConvCount = await prisma.aiConversation.count()

  if (existingConvCount < 3 && patients.length >= 8) {
    type MsgDef = { role: string; content: string }
    type ConvDef = { pIdx: number; messages: MsgDef[] }

    const convDefs: ConvDef[] = [
      {
        pIdx: 0,
        messages: [
          { role: 'AGENT', content: 'Hello David! 👋 This is Sarah from Code Clinic Dental. Just a friendly reminder that you have a *Dental Checkup* appointment tomorrow (Monday) at *8:00 AM* with Dr. James Okello.\n\nPlease reply *YES* to confirm or call us on *0701 100 001* if you need to reschedule.' },
          { role: 'USER',  content: 'Yes confirmed, I will be there' },
          { role: 'AGENT', content: 'Perfect! We look forward to seeing you tomorrow, David 😊 Please arrive 5–10 minutes early to complete any paperwork. Remember to bring your patient card if you have one. See you then! 🦷' },
        ],
      },
      {
        pIdx: 1,
        messages: [
          { role: 'USER',  content: 'Hi I would like to book an appointment for teeth cleaning please' },
          { role: 'AGENT', content: 'Hello! Welcome to Code Clinic Dental 🦷 I\'m Sarah, your AI dental assistant. I\'d be happy to help you book a *Teeth Cleaning* appointment!\n\nWe have availability this week with Dr. Sarah Namukasa. Do you prefer *morning* or *afternoon*?' },
          { role: 'USER',  content: 'Tuesday morning would work for me' },
          { role: 'AGENT', content: 'Great! We have *Tuesday at 10:00 AM* with Dr. Sarah Namukasa available for Teeth Cleaning (45 minutes, 80,000 UGX).\n\nShall I go ahead and book that for you? Please confirm your *full name* to proceed.' },
          { role: 'USER',  content: 'Grace Nakamya, yes please confirm it' },
          { role: 'AGENT', content: '✅ Done! Your appointment is confirmed:\n\n📅 Tuesday, 19 May 2026\n⏰ 10:00 AM\n👩‍⚕️ Dr. Sarah Namukasa\n🦷 Teeth Cleaning\n💰 80,000 UGX\n\nPlease arrive 5 minutes early. See you Tuesday, Grace! 😊' },
        ],
      },
      {
        pIdx: 2,
        messages: [
          { role: 'USER',  content: 'Hello I had a filling 3 days ago and I have some pain when biting. Is that normal?' },
          { role: 'AGENT', content: 'Hello Robert! I\'m sorry to hear you\'re experiencing discomfort after your filling. 😟 Mild sensitivity or pain when biting for a few days after a composite filling can be normal, but I want to make sure you\'re okay.\n\nCan you describe the pain?\n\n1️⃣ Mild sensitivity to cold/hot\n2️⃣ Dull ache when biting\n3️⃣ Severe or throbbing pain\n4️⃣ Any swelling around the tooth' },
          { role: 'USER',  content: 'Its a dull ache when I bite but not severe at all' },
          { role: 'AGENT', content: 'That\'s reassuring, Robert! A dull ache when biting is very common after a filling — your tooth needs 1–2 weeks to fully settle. ✅\n\nYou can take *Paracetamol 500mg* if needed. Avoid hard or crunchy foods on that side for now.\n\nHowever, if the pain *worsens* or you notice swelling, please call us immediately on *0701 100 001* or come in for a review — bite adjustment is done at no charge. 🦷' },
        ],
      },
      {
        pIdx: 4,
        messages: [
          { role: 'AGENT', content: 'Hello Emmanuel! 👋 This is a follow-up from Code Clinic Dental. You had a *tooth extraction* 3 days ago with Dr. James. How are you feeling? Any swelling, bleeding or pain? 🦷' },
          { role: 'USER',  content: 'Am feeling better. There is still some swelling but its going down' },
          { role: 'AGENT', content: 'That\'s great to hear, Emmanuel! 😊 Swelling for 3–5 days after an extraction is completely normal and should continue to reduce.\n\n✅ Continue taking your medication as directed\n✅ Rinse gently with warm salty water 3× daily\n✅ Avoid hard foods and that side for now\n✅ No smoking or drinking through a straw\n\nYou have a *follow-up review in 4 days*. We\'ll send you a reminder the day before!' },
          { role: 'USER',  content: 'Ok thank you very much' },
          { role: 'AGENT', content: 'You\'re very welcome, Emmanuel! Take care and don\'t hesitate to reach out if anything changes. See you at your review appointment! 🦷😊' },
        ],
      },
      {
        pIdx: 7,
        messages: [
          { role: 'USER',  content: 'Good morning. How much does a full set of dentures cost?' },
          { role: 'AGENT', content: 'Good morning! 😊 Thank you for contacting Code Clinic Dental.\n\nRegarding dentures, the cost depends on the type:\n\n🦷 *Full Upper or Lower Acrylic Denture:* 1,500,000 – 2,500,000 UGX\n🦷 *Partial Acrylic Denture:* 800,000 – 1,200,000 UGX\n🦷 *Flexible (Valplast) Denture:* 1,800,000 – 2,800,000 UGX\n\nWe recommend starting with a *consultation* with Dr. James Okello (50,000 UGX) to assess your specific needs and get an accurate quote. Would you like to book?' },
          { role: 'USER',  content: 'Yes please book me for next week if possible' },
          { role: 'AGENT', content: 'Wonderful! 🎉 To book your consultation, I need a few details:\n\n1. Your *full name*\n2. Preferred *day* next week (Mon–Fri or Sat morning)\n3. Morning or afternoon preference\n\nPlease share those and I\'ll confirm your appointment right away! 😊' },
          { role: 'USER',  content: 'Mary Najjuko, Wednesday morning please' },
          { role: 'AGENT', content: '✅ Booking confirmed, Mary!\n\n📅 Wednesday, 20 May 2026\n⏰ 9:00 AM\n👨‍⚕️ Dr. James Okello\n🦷 Denture Consultation\n💰 50,000 UGX\n\nPlease bring any previous dental records or X-rays if you have them. See you Wednesday! 🦷' },
        ],
      },
    ]

    for (const def of convDefs) {
      if (def.pIdx >= patients.length) continue
      const conversation = await prisma.aiConversation.create({
        data: {
          patientId:    patients[def.pIdx].id,
          channel:      'WHATSAPP',
          phoneNumber:  patients[def.pIdx].phone,
          status:       'ACTIVE',
          agentEnabled: true,
        },
      })

      const baseTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      for (let mi = 0; mi < def.messages.length; mi++) {
        await prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role:           def.messages[mi].role,
            content:        def.messages[mi].content,
            createdAt:      new Date(baseTime.getTime() + mi * 7 * 60 * 1000),
          },
        })
      }
    }
    console.log(`  ✓ Created 5 WhatsApp conversation threads`)
  } else {
    console.log(`  ℹ Skipped — ${existingConvCount} conversations already exist`)
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  const [ptCount, apptCount, invCount, expCount, stockCount, convCount, noteCount] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.invoice.count(),
    prisma.expense.count(),
    prisma.stockItem.count(),
    prisma.aiConversation.count(),
    prisma.treatmentNote.count(),
  ])

  console.log('\n══════════════════ SEED COMPLETE ══════════════════')
  console.log(`  Patients:         ${ptCount}`)
  console.log(`  Appointments:     ${apptCount}`)
  console.log(`  Treatment notes:  ${noteCount}`)
  console.log(`  Invoices:         ${invCount}`)
  console.log(`  Expenses:         ${expCount}`)
  console.log(`  Stock items:      ${stockCount}`)
  console.log(`  WA conversations: ${convCount}`)
  console.log('════════════════════════════════════════════════════')
  console.log('\nDemo login credentials (password: Demo2026!)')
  console.log('  james@codeclinic.ug  — Dr. James Okello   (DOCTOR)')
  console.log('  sarah@codeclinic.ug  — Dr. Sarah Namukasa (DOCTOR)')
  console.log('  mary@codeclinic.ug   — Mary Nakato        (RECEPTIONIST)')
  console.log('  john@codeclinic.ug   — John Ssebulime     (ACCOUNTS)')
  console.log('')
}

main()
  .catch((e) => { console.error('\nSeed failed:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
