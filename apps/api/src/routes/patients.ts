import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff, adminOnly } from '../middleware/rbac'
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
  importSource:       z.string().optional(),
  status:             z.enum(['NEW_LEAD','UPCOMING','ACTIVE','DUE_RECALL','LAPSED','DORMANT','BALANCE_OWING']).optional(),
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
      importSource,
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
        ...(importSource ? { importSource, status: 'ACTIVE' as any } : {}),
      },
    })
    res.status(201).json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to create patient' }) }
})

// POST /patients/import-sheet — import from public Google Sheet
// Body:
//   { sheetUrl, previewOnly?: true }                       → returns { headers, rows (first 5) }
//   { sheetUrl, columnMap: { firstName, lastName, phone, email, dob, gender, address } }  → imports
router.post('/import-sheet', requireAuth, async (req, res) => {
  try {
    const { sheetUrl, previewOnly, columnMap } = req.body
    if (!sheetUrl) { res.status(400).json({ error: 'Sheet URL required' }); return }
    // Extract sheet ID from any Google Sheets URL format
    const match = (sheetUrl as string).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (!match) { res.status(400).json({ error: 'Invalid Google Sheets URL. Expected: https://docs.google.com/spreadsheets/d/{ID}/...' }); return }
    const sheetId = match[1]
    const csvUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
    const response = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodeClinic/1.0)' },
      redirect: 'follow',
    })
    if (!response.ok) {
      res.status(400).json({ error: 'Could not access sheet. Make sure it is shared publicly (Anyone with link → can view)' }); return
    }
    const csvText = await response.text()
    // Google returns HTML login/error page when sheet is private or doesn't exist
    if (csvText.trimStart().startsWith('<!DOCTYPE') || csvText.trimStart().startsWith('<html')) {
      res.status(400).json({ error: 'Sheet is not publicly accessible. Open the sheet → Share → Anyone with the link → Viewer.' }); return
    }
    const lines   = csvText.trim().split('\n')
    if (lines.length < 2) { res.status(400).json({ error: 'Sheet appears to be empty or has no data rows' }); return }
    const headers = parseCSVLine(lines[0]).map(h => h.trim())

    // Preview mode: return headers + first 5 data rows + total row count
    if (previewOnly) {
      const dataLines = lines.slice(1).filter(l => l.trim())
      const rows = dataLines.slice(0, 5).map(line => {
        const values = parseCSVLine(line)
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => { row[h] = values[idx]?.trim() || '' })
        return row
      })
      res.json({ headers, rows, total: dataLines.length })
      return
    }

    // Build field extractor using explicit columnMap if provided, else fall back to auto-detect
    const cm = columnMap as Record<string, string> | undefined
    const getField = (row: Record<string, string>, field: string, fallbacks: string[]): string => {
      if (cm?.[field]) return row[cm[field]] || ''
      for (const key of fallbacks) {
        const val = row[key] ?? row[key.toLowerCase()] ?? ''
        if (val) return val
      }
      return ''
    }

    let created = 0, updated = 0, skipped = 0
    const errors: string[] = []

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      try {
        const values = parseCSVLine(lines[i])
        const rawRow: Record<string, string> = {}
        headers.forEach((h, idx) => { rawRow[h] = values[idx]?.trim() || '' })
        // Also store lowercase-keyed version for auto-detect fallback
        const row: Record<string, string> = {}
        Object.entries(rawRow).forEach(([k, v]) => { row[k.toLowerCase()] = v; row[k] = v })

        const firstName = getField(row, 'firstName', ['first name', 'firstname', 'first_name']) || row['name']?.split(' ')[0] || ''
        const lastName  = getField(row, 'lastName',  ['last name', 'lastname', 'last_name'])   || row['name']?.split(' ').slice(1).join(' ') || ''
        const phone     = getField(row, 'phone',     ['phone', 'phone number', 'contact', 'tel', 'mobile'])
        const email     = getField(row, 'email',     ['email', 'email address'])
        const dob       = getField(row, 'dob',       ['dob', 'date of birth', 'birth date', 'birthdate'])
        const gender    = getField(row, 'gender',    ['gender', 'sex'])
        const address   = getField(row, 'address',   ['address', 'location'])

        if (!firstName || !phone) { skipped++; errors.push(`Row ${i + 1}: missing name or phone`); continue }

        let genderEnum: 'MALE' | 'FEMALE' | undefined
        if (gender.toLowerCase().startsWith('m')) genderEnum = 'MALE'
        if (gender.toLowerCase().startsWith('f')) genderEnum = 'FEMALE'

        const existing = await prisma.patient.findFirst({ where: { phone } })
        if (existing) {
          await prisma.patient.update({
            where: { id: existing.id },
            data: {
              firstName,
              lastName: lastName || existing.lastName,
              email:   email   || existing.email   || undefined,
              dob:     dob     ? new Date(dob)      : existing.dob   || undefined,
              gender:  genderEnum                  ?? existing.gender ?? undefined,
              address: address || existing.address || undefined,
            },
          })
          updated++
        } else {
          await prisma.patient.create({
            data: {
              firstName,
              lastName: lastName || firstName,
              phone,
              email:    email   || undefined,
              dob:      dob     ? new Date(dob) : undefined,
              gender:   genderEnum,
              address:  address || undefined,
              status:   'ACTIVE' as any,
              importSource: 'SHEET',
            },
          })
          created++
        }
      } catch (err: any) { errors.push(`Row ${i + 1}: ${err.message}`); skipped++ }
    }
    res.json({ created, updated, skipped, total: lines.length - 1, errors: errors.slice(0, 10) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// POST /patients/bulk-delete — clinical staff (receptionist, doctor, admin)
router.post('/bulk-delete', requireAuth, clinicalStaff, async (req, res) => {
  try {
    const { patientIds } = req.body
    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      res.status(400).json({ error: 'patientIds array required' }); return
    }
    const result = await prisma.patient.deleteMany({ where: { id: { in: patientIds } } })
    res.json({ deleted: result.count })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /patients/referral-stats — MUST be before /:id to avoid Express matching as param
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
      statsMap[src].revenue += p.invoices.reduce((s, inv) => s + Number(inv.paidUGX), 0)
      if (new Date(p.createdAt) >= startOfMonth) statsMap[src].thisMonth++
    }

    const stats = Object.entries(statsMap)
      .map(([source, d]) => ({ source, ...d }))
      .sort((a, b) => b.count - a.count)

    res.json({ stats })
  } catch { res.status(500).json({ error: 'Failed to fetch referral stats' }) }
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
      select: { phone: true, createdAt: true, status: true, importSource: true },
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
    // Imported patients default to ACTIVE if no appointment history yet
    let patientStatus: string = patient.importSource ? 'ACTIVE' : 'NEW_LEAD'
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
      savedStatus: patient.status,  // stored DB status for the override dropdown
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
      referralSource, status,
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
        ...(status ? { status: status as any } : {}),
      },
    })
    res.json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to update patient' }) }
})

// DELETE /patients/:id — clinical staff (receptionist, doctor, admin)
router.delete('/:id', requireAuth, clinicalStaff, auditLog('patients'), async (req, res) => {
  try {
    await prisma.patient.delete({ where: { id: req.params.id } })
    res.json({ deleted: true })
  } catch { res.status(500).json({ error: 'Failed to delete patient' }) }
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
