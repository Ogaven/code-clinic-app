import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { auditLog } from '../middleware/audit'
import { validate } from '../middleware/validate'
import { getPublicUrl } from '../services/storage/r2'
import { formatPatientId } from '../lib/utils'
import multer from 'multer'
import { uploadAvatar, deleteFile } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'
import { prisma } from '../lib/prisma'

const createPatientSchema = z.object({
  firstName:          z.string().min(1),
  lastName:           z.string().min(1),
  phone:              z.string().min(1),
  email:              z.string().email().optional().or(z.literal('')),
  gender:             z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dob:                z.string().optional().or(z.literal('')),
  address:            z.string().optional().or(z.literal('')),
  district:           z.string().optional().or(z.literal('')),
  nextOfKinName:      z.string().optional().or(z.literal('')),
  nextOfKinPhone:     z.string().optional().or(z.literal('')),
  nextOfKinRelation:  z.string().optional().or(z.literal('')),
  allergies:          z.string().optional().or(z.literal('')),
  medicalHistory:     z.union([z.string(), z.array(z.string())]).optional(),
  referralSource:     z.string().optional().or(z.literal('')),
})

const updatePatientSchema = createPatientSchema.partial()

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === ',' && !inQuotes) { result.push(current); current = '' }
    else { current += char }
  }
  result.push(current)
  return result
}

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// GET /patients
router.get('/', requireAuth, async (req, res) => {
  try {
    const q        = (req.query.q || req.query.search) as string | undefined
    const filter   = req.query.filter   as string | undefined
    const sortBy   = req.query.sortBy   as string | undefined
    const limit    = Math.min(Number(req.query.limit) || 50, 500)
    const offset   = Number(req.query.offset) || 0

    // Build search where clause
    const ccMatch = q ? /^CC-(\d+)$/i.exec(q.trim()) : null
    const searchWhere: any = q ? (
      ccMatch
        ? { patientNumber: parseInt(ccMatch[1], 10) }
        : {
            OR: [
              { firstName: { contains: q } },
              { lastName:  { contains: q } },
              { phone:     { contains: q } },
              { email:     { contains: q } },
            ],
          }
    ) : {}

    // Build filter clause
    const filterWhere: any = {}
    if (filter === 'new_today') {
      const today = new Date(); today.setHours(0,0,0,0)
      filterWhere.createdAt = { gte: today }
    } else if (filter === 'has_balance') {
      filterWhere.accountBalance = { gt: 0 }
    } else if (filter === 'has_plan') {
      filterWhere.treatmentPlans = { some: {} }
    } else if (filter === 'male') {
      filterWhere.gender = 'MALE'
    } else if (filter === 'female') {
      filterWhere.gender = 'FEMALE'
    } else if (['NEW_LEAD','UPCOMING','ACTIVE','DUE_RECALL','LAPSED','DORMANT','BALANCE_OWING'].includes(filter || '')) {
      filterWhere.status = filter
    } else if (filter === 'this_month') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      filterWhere.createdAt = { gte: start, lte: end }
    }

    const where = { ...searchWhere, ...filterWhere }

    // Build order
    let orderBy: any = { createdAt: 'desc' }
    if (sortBy === 'name')      orderBy = [{ firstName: 'asc' }, { lastName: 'asc' }]
    if (sortBy === 'balance')   orderBy = { accountBalance: 'desc' }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: { _count: { select: { appointments: true, treatmentPlans: true } } },
      }),
      prisma.patient.count({ where }),
    ])
    const withUrls = patients.map((p) => ({
      ...p,
      patientId: formatPatientId(p.patientNumber),
      accountBalance: Number(p.accountBalance),
      avatarUrl: p.avatarR2Key ? getPublicUrl(p.avatarR2Key) : null,
    }))
    res.json({ data: withUrls, total, limit, offset })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch patients' }) }
})

// POST /patients — receptionist, doctor, or admin only
router.post('/', requireAuth, clinicalStaff, validate(createPatientSchema), auditLog('patients'), async (req, res) => {
  try {
    const {
      firstName, lastName, phone, email, gender, dob, address, district,
      nextOfKinName, nextOfKinPhone, nextOfKinRelation, allergies, medicalHistory,
    } = req.body
    if (!firstName || !lastName || !phone) {
      res.status(400).json({ error: 'firstName, lastName and phone are required' }); return
    }
    const medHistory = Array.isArray(medicalHistory) ? medicalHistory.join(', ') : (medicalHistory ?? undefined)
    const patient = await prisma.patient.create({
      data: {
        firstName, lastName, phone,
        email:             email             || undefined,
        gender:            gender            || undefined,
        dob:               dob               ? new Date(dob) : undefined,
        address:           address           || undefined,
        district:          district          || undefined,
        nextOfKinName:     nextOfKinName     || undefined,
        nextOfKinPhone:    nextOfKinPhone    || undefined,
        nextOfKinRelation: nextOfKinRelation || undefined,
        allergies:         allergies         || undefined,
        medicalHistory:    medHistory        || undefined,
      },
    })
    res.status(201).json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to create patient' }) }
})

// POST /patients/import-sheet — import from public Google Sheet
router.post('/import-sheet', requireAuth, async (req, res) => {
  try {
    const { sheetUrl } = req.body
    if (!sheetUrl) { res.status(400).json({ error: 'Sheet URL required' }); return }
    const match = (sheetUrl as string).match(/\/d\/([a-zA-Z0-9-_]+)/)
    if (!match) { res.status(400).json({ error: 'Invalid Google Sheets URL' }); return }
    const sheetId = match[1]
    const csvUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
    const response = await fetch(csvUrl)
    if (!response.ok) {
      res.status(400).json({ error: 'Could not access sheet. Make sure it is shared publicly (Anyone with link can view)' }); return
    }
    const csvText = await response.text()
    const lines   = csvText.trim().split('\n')
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''))
    let imported = 0, skipped = 0
    const errors: string[] = []
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i])
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => { row[h] = values[idx]?.trim() || '' })
        const firstName = row['first name'] || row['firstname'] || row['first_name'] || row['name']?.split(' ')[0] || ''
        const lastName  = row['last name']  || row['lastname']  || row['last_name']  || row['name']?.split(' ').slice(1).join(' ') || ''
        const phone     = row['phone'] || row['phone number'] || row['contact'] || row['tel'] || ''
        const email     = row['email'] || row['email address'] || ''
        const dob       = row['dob'] || row['date of birth'] || row['birth date'] || ''
        const gender    = row['gender'] || row['sex'] || ''
        const address   = row['address'] || row['location'] || ''
        if (!firstName || !phone) { skipped++; errors.push(`Row ${i + 1}: missing name or phone`); continue }
        const existing = await prisma.patient.findFirst({ where: { phone } })
        if (existing) { skipped++; continue }
        let genderEnum: 'MALE' | 'FEMALE' | undefined
        if (gender.toLowerCase().startsWith('m')) genderEnum = 'MALE'
        if (gender.toLowerCase().startsWith('f')) genderEnum = 'FEMALE'
        await prisma.patient.create({
          data: {
            firstName,
            lastName: lastName || firstName,
            phone,
            email:   email   || undefined,
            dob:     dob     ? new Date(dob) : undefined,
            gender:  genderEnum,
            address: address || undefined,
          },
        })
        imported++
      } catch (err: any) { errors.push(`Row ${i + 1}: ${err.message}`); skipped++ }
    }
    res.json({ imported, skipped, total: lines.length - 1, errors: errors.slice(0, 10) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// GET /patients/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        appointments: {
          include: {
            service: { select: { name: true, colour: true, priceUGX: true } },
            doctor: { include: { user: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: { startAt: 'desc' }, take: 20,
        },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        feedback: { orderBy: { submittedAt: 'desc' }, take: 10 },
      },
    })
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return }
    const avatarUrl = patient.avatarR2Key ? getPublicUrl(patient.avatarR2Key) : null
    res.json({
      ...patient,
      patientId: formatPatientId(patient.patientNumber),
      accountBalance: Number(patient.accountBalance),
      avatarUrl,
      invoices: patient.invoices.map(i => ({ ...i, totalUGX: Number(i.totalUGX), subtotalUGX: Number(i.subtotalUGX), vatUGX: Number(i.vatUGX), paidUGX: Number(i.paidUGX) })),
    })
  } catch { res.status(500).json({ error: 'Failed to fetch patient' }) }
})

// GET /patients/:id/timeline
router.get('/:id/timeline', requireAuth, async (req, res) => {
  try {
    const { id } = req.params

    const patient = await prisma.patient.findUnique({
      where: { id },
      select: { phone: true, createdAt: true },
    })
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return }

    const [appointments, invoices, conversations] = await Promise.all([
      prisma.appointment.findMany({
        where: { patientId: id },
        include: {
          service: { select: { name: true, colour: true } },
          doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { startAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { patientId: id },
        select: { totalUGX: true, paidUGX: true, status: true },
      }),
      prisma.aiConversation.findMany({
        where: { phoneNumber: patient.phone },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 50 },
          _count:   { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    const totalBilled  = invoices.reduce((s, i) => s + Number(i.totalUGX), 0)
    const totalPaid    = invoices.reduce((s, i) => s + Number(i.paidUGX),   0)
    const outstanding  = totalBilled - totalPaid

    const now = new Date()
    const lastCompleted = appointments.find(
      a => a.status === 'COMPLETED' && new Date(a.startAt) <= now,
    )
    let patientStatus = 'NEW_LEAD'
    if (lastCompleted) {
      const days = (now.getTime() - new Date(lastCompleted.startAt).getTime()) / 86_400_000
      if      (days <= 90)  patientStatus = 'ACTIVE'
      else if (days <= 365) patientStatus = 'LAPSED'
      else                  patientStatus = 'DORMANT'
    } else if (appointments.some(a => new Date(a.startAt) > now)) {
      patientStatus = 'UPCOMING'
    }

    res.json({
      appointments,
      financial: { totalBilled, totalPaid, outstanding, invoiceCount: invoices.length },
      conversations: conversations.map(c => ({
        id:           c.id,
        channel:      c.channel,
        phoneNumber:  c.phoneNumber,
        status:       c.status,
        agentEnabled: c.agentEnabled,
        createdAt:    c.createdAt,
        updatedAt:    c.updatedAt,
        messageCount: c._count.messages,
        messages:     c.messages,
      })),
      patientStatus,
    })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch timeline' }) }
})

// GET /patients/:id/activity
router.get('/:id/activity', requireAuth, async (req, res) => {
  try {
    const activities = await prisma.patientActivity.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json(activities)
  } catch { res.status(500).json({ error: 'Failed to fetch activities' }) }
})

// PATCH /patients/:id — clinical staff only
router.patch('/:id', requireAuth, clinicalStaff, validate(updatePatientSchema), auditLog('patients'), async (req, res) => {
  try {
    const {
      firstName, lastName, phone, email, gender, dob, address, district, isActive,
      nextOfKinName, nextOfKinPhone, nextOfKinRelation, allergies, medicalHistory,
      referralSource,
    } = req.body
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: {
        firstName, lastName, phone, email, gender,
        dob: dob ? new Date(dob) : undefined,
        address, district, isActive,
        nextOfKinName, nextOfKinPhone, nextOfKinRelation,
        allergies, medicalHistory,
        referralSource: referralSource || null,
      },
    })
    res.json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to update patient' }) }
})

// GET /patients/referral-stats — aggregate referral source data for the Referrals page
router.get('/referral-stats', requireAuth, async (_req, res) => {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const patients = await prisma.patient.findMany({
      select: {
        referralSource: true,
        createdAt:      true,
        invoices:       { select: { paidUGX: true } },
      },
    })

    const statsMap: Record<string, { count: number; revenue: number; thisMonth: number }> = {}
    for (const p of patients) {
      const src = p.referralSource || 'Unknown'
      if (!statsMap[src]) statsMap[src] = { count: 0, revenue: 0, thisMonth: 0 }
      statsMap[src].count++
      statsMap[src].revenue += p.invoices.reduce((s, inv) => s + inv.paidUGX, 0)
      if (new Date(p.createdAt) >= startOfMonth) statsMap[src].thisMonth++
    }

    const stats = Object.entries(statsMap)
      .map(([source, d]) => ({ source, ...d }))
      .sort((a, b) => b.count - a.count)

    res.json({ stats })
  } catch { res.status(500).json({ error: 'Failed to fetch referral stats' }) }
})

// POST /patients/:id/avatar
router.post('/:id/avatar', requireAuth, uploadLimiter, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }
    if (!['image/jpeg','image/png','image/webp'].includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPEG, PNG or WebP allowed' }); return
    }
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } })
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return }
    if (patient.avatarR2Key) await deleteFile(patient.avatarR2Key).catch(() => {})
    const r2Key = await uploadAvatar(req.file.buffer, req.file.mimetype, 'patients', req.params.id)
    await prisma.patient.update({ where: { id: req.params.id }, data: { avatarR2Key: r2Key } })
    const avatarUrl = getPublicUrl(r2Key)
    res.json({ avatarUrl, r2Key })
  } catch { res.status(500).json({ error: 'Upload failed' }) }
})

export default router
