import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff, adminOnly, adminAndReceptionist } from '../middleware/rbac'
import { auditLog } from '../middleware/audit'
import { validate } from '../middleware/validate'
import { getPublicUrl } from '../services/storage/r2'
import { formatPatientId } from '../lib/utils'
import multer from 'multer'
import { uploadAvatar, deleteFile } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'
import { prisma } from '../lib/prisma'
import { logAudit } from '../services/audit.service'

const createPatientSchema = z.object({
  firstName:          z.string().min(1),
  lastName:           z.string().min(1),
  phone:              z.string().min(1),
  email:              z.string().email().optional().or(z.literal('')),
  gender:             z.enum(['MALE', 'FEMALE', 'OTHER']).optional(), // OTHER kept for backward compat
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

const updatePatientSchema = createPatientSchema.partial().extend({
  guardianId:   z.string().nullable().optional(),
  isMinor:      z.boolean().optional(),
  relationship: z.string().nullable().optional(),
})

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

const MONTH_MAP: Record<string, string> = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
}

function parseDob(raw: string): Date | null {
  const s = raw?.trim()
  if (!s) return null

  // Excel serial date (4-5 digit number, e.g. 32831 = 1989-11-06)
  if (/^\d{4,5}$/.test(s)) {
    const serial = parseInt(s, 10)
    // Excel epoch: Dec 30 1899 (accounts for Excel's 1900 leap year bug)
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) return d
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
  }

  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [day, mon, yr] = s.split('-')
    const d = new Date(`${yr}-${mon.padStart(2,'0')}-${day.padStart(2,'0')}`)
    if (!isNaN(d.getTime())) return d
  }

  // MM/DD/YYYY or DD/MM/YYYY — prefer DD/MM for Uganda; if first part > 12 it must be the day
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [a, b, yr] = s.split('/')
    const ai = parseInt(a), bi = parseInt(b)
    if (ai > 12) {
      // a must be day → DD/MM/YYYY
      const d = new Date(`${yr}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`)
      if (!isNaN(d.getTime())) return d
    }
    // Try MM/DD/YYYY (US)
    const us = new Date(`${yr}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`)
    if (!isNaN(us.getTime()) && ai <= 12 && bi <= 31) return us
    // Try DD/MM/YYYY (Uganda)
    const ug = new Date(`${yr}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`)
    if (!isNaN(ug.getTime())) return ug
  }

  // "Month DD, YYYY" or "Month DD YYYY"
  const mdy = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/)
  if (mdy) {
    const mo = MONTH_MAP[mdy[1].toLowerCase().substring(0, 3)]
    if (mo) {
      const d = new Date(`${mdy[3]}-${mo}-${mdy[2].padStart(2,'0')}`)
      if (!isNaN(d.getTime())) return d
    }
  }

  // Last resort: native parse (handles many locale-specific formats)
  const d = new Date(s)
  if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) return d

  return null
}

function normalizePhone(raw: string): string {
  // Strip spaces, dashes, parentheses but keep leading +
  const stripped = raw.trim()
  const digits   = stripped.replace(/\D/g, '')
  if (stripped.startsWith('+'))          return '+' + digits          // +256... → keep
  if (digits.startsWith('256') && digits.length >= 12) return '+' + digits  // 256772... → +256772...
  if (digits.startsWith('0')   && digits.length >= 9)  return '+256' + digits.slice(1)  // 0772... → +256772...
  return stripped  // unknown format — leave unchanged
}

function cleanError(msg: string): string {
  // Strip Prisma boilerplate — keep only the human-readable part
  const lines = msg.split('\n')
  const first = lines[0].replace(/^(PrismaClientKnownRequestError|PrismaClientValidationError):\s*/i, '')
  return first.substring(0, 120)
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
              { firstName: { contains: q,                       mode: 'insensitive' } },
              { lastName:  { contains: q,                       mode: 'insensitive' } },
              { phone:     { contains: q.replace(/[\s-]/g, '')                      } },
              { email:     { contains: q,                       mode: 'insensitive' } },
            ],
          }
    ) : {}

    // Build filter clause
    const filterWhere: any = {}
    if (filter === 'record_only') {
      // No completed appointments of any kind
      filterWhere.appointments = { none: { status: { in: ['COMPLETED', 'DEPARTED', 'SESSION_COMPLETE'] } } }
    } else if (filter === 'new_patient') {
      // First COMPLETED appointment within last 30 days, not imported
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id
        FROM patients p
        WHERE (p."importSource" IS NULL OR p."importSource" = '')
        AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a."patientId" = p.id AND a.status = 'COMPLETED'
        )
        AND (
          SELECT MIN(a."startAt") FROM appointments a
          WHERE a."patientId" = p.id AND a.status = 'COMPLETED'
        ) >= ${thirtyDaysAgo}
      `
      filterWhere.id = { in: rows.map(r => r.id) }
    } else if (filter === 'returning') {
      // More than one COMPLETED appointment
      const rows = await prisma.$queryRaw<{ patientId: string }[]>`
        SELECT "patientId"
        FROM appointments
        WHERE status = 'COMPLETED'
        GROUP BY "patientId"
        HAVING COUNT(*) > 1
      `
      filterWhere.id = { in: rows.map(r => r.patientId) }
    } else if (filter === 'new_today') {
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
    if (sortBy === 'name')      orderBy = [{ lastName: 'asc' }, { firstName: 'asc' }]
    if (sortBy === 'balance')   orderBy = { accountBalance: 'desc' }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          _count: { select: { appointments: true, treatmentPlans: true, dependents: true } },
          treatmentNotes: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, followUpStatus: true } },
          guardian: { select: { id: true, firstName: true, lastName: true } },
        },
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
      referralSource, importSource,
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
        referralSource:    referralSource    || undefined,
        ...(importSource ? { importSource, status: 'ACTIVE' as any } : {}),
      },
    })
    logAudit({ userId: req.user!.id, actionType: 'CREATE', entityType: 'PATIENT', entityId: patient.id, entityName: `${patient.firstName} ${patient.lastName}`, req })
    res.status(201).json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to create patient' }) }
})

// POST /patients/import-csv — batch import with phone-based deduplication (skip if phone exists)
// Body: { records: Array<{ firstName, lastName, phone, email?, gender?, dob?, address?, referralSource? }> }
router.post('/import-csv', requireAuth, async (req, res) => {
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: 'records array required' }); return
    }

    let created = 0, skipped = 0
    const errors: string[] = []

    for (let i = 0; i < records.length; i++) {
      try {
        const r = records[i]
        const firstName      = (r.firstName || '').trim()
        const normalizedPhone = normalizePhone((r.phone || '').trim())
        if (!firstName || !normalizedPhone) {
          skipped++
          errors.push(`Row ${i + 1}: missing first name or phone`)
          continue
        }

        const existing = await prisma.patient.findFirst({ where: { phone: normalizedPhone } })
        if (existing) { skipped++; continue }

        let genderEnum: 'MALE' | 'FEMALE' | undefined
        if (r.gender?.toLowerCase().startsWith('m')) genderEnum = 'MALE'
        if (r.gender?.toLowerCase().startsWith('f')) genderEnum = 'FEMALE'
        const dobDate = r.dob ? parseDob(r.dob) ?? undefined : undefined

        await prisma.patient.create({
          data: {
            firstName,
            lastName:      (r.lastName || firstName).trim(),
            phone:         normalizedPhone,
            email:         r.email          || undefined,
            gender:        genderEnum,
            dob:           dobDate,
            address:       r.address        || undefined,
            referralSource: r.referralSource || undefined,
            status:        'ACTIVE' as any,
            importSource:  'CSV',
          },
        })
        created++
      } catch (err: any) {
        errors.push(`Row ${i + 1}: ${cleanError(err.message)}`)
        skipped++
      }
    }

    console.log(`[patients/import-csv] created=${created} skipped=${skipped}`)
    res.json({ created, skipped, total: records.length, errors })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
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

        const normalizedPhone = normalizePhone(phone)
        if (!firstName || !normalizedPhone) { skipped++; errors.push(`Row ${i + 1}: missing first name or phone`); continue }

        let genderEnum: 'MALE' | 'FEMALE' | undefined
        if (gender.toLowerCase().startsWith('m')) genderEnum = 'MALE'
        if (gender.toLowerCase().startsWith('f')) genderEnum = 'FEMALE'

        // parseDob returns null for invalid dates — never skip a row for bad DOB
        const dobDate = parseDob(dob) ?? undefined

        const existing = await prisma.patient.findFirst({ where: { phone: normalizedPhone } })
        if (existing) {
          await prisma.patient.update({
            where: { id: existing.id },
            data: {
              firstName,
              lastName: lastName || existing.lastName,
              email:   email    || existing.email   || undefined,
              dob:     dobDate  ?? existing.dob     ?? undefined,
              gender:  genderEnum                   ?? existing.gender ?? undefined,
              address: address  || existing.address || undefined,
            },
          })
          updated++
        } else {
          await prisma.patient.create({
            data: {
              firstName,
              lastName: lastName || firstName,
              phone:    normalizedPhone,
              email:    email   || undefined,
              dob:      dobDate,
              gender:   genderEnum,
              address:  address || undefined,
              status:   'ACTIVE' as any,
              importSource: 'SHEET',
            },
          })
          created++
        }
      } catch (err: any) { errors.push(`Row ${i + 1}: ${cleanError(err.message)}`); skipped++ }
    }
    res.json({ created, updated, skipped, total: lines.length - 1, errors })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// POST /patients/bulk-delete — admin + receptionist only
router.post('/bulk-delete', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const { patientIds } = req.body
    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      res.status(400).json({ error: 'patientIds array required' }); return
    }
    const ids: string[] = patientIds
    let deleted = 0
    await prisma.$transaction(async (tx) => {
      // Null out optional patient FKs
      await tx.nurtureLog.updateMany({ where: { patientId: { in: ids } }, data: { patientId: null } })
      await tx.agentLog.updateMany({ where: { patientId: { in: ids } }, data: { patientId: null } })
      await tx.agentMemory.deleteMany({ where: { patientId: { in: ids } } })
      await tx.aiConversation.updateMany({ where: { patientId: { in: ids } }, data: { patientId: null } })
      // Required FKs — delete first
      await tx.aiScheduledMessage.deleteMany({ where: { patientId: { in: ids } } })
      await tx.outboundQueue.deleteMany({ where: { patientId: { in: ids } } })
      // Appointments and their dependents
      const apptIds = (await tx.appointment.findMany({ where: { patientId: { in: ids } }, select: { id: true } })).map(a => a.id)
      if (apptIds.length > 0) {
        await tx.patientFeedback.deleteMany({ where: { appointmentId: { in: apptIds } } })
        await tx.invoice.updateMany({ where: { appointmentId: { in: apptIds } }, data: { appointmentId: null } })
      }
      await tx.patientFeedback.deleteMany({ where: { patientId: { in: ids } } })
      await tx.appointment.deleteMany({ where: { patientId: { in: ids } } })
      // Invoices and payments
      await tx.payment.deleteMany({ where: { patientId: { in: ids } } })
      await tx.invoice.deleteMany({ where: { patientId: { in: ids } } })
      // Patient rows (TreatmentPlan/Note/DentalChart/PatientDocument/PatientActivity have onDelete:Cascade)
      const result = await tx.patient.deleteMany({ where: { id: { in: ids } } })
      deleted = result.count
    })
    res.json({ deleted })
  } catch (e: any) {
    console.error('[patients] bulk-delete error:', e)
    res.status(500).json({ error: e.message })
  }
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

    const NOT_RECORDED = 'Not Recorded'
    const statsMap: Record<string, { count: number; revenue: number; thisMonth: number }> = {}
    for (const p of patients) {
      // NULL and empty-string both go to 'Not Recorded' — kept separate from named sources
      const src = p.referralSource?.trim() || NOT_RECORDED
      if (!statsMap[src]) statsMap[src] = { count: 0, revenue: 0, thisMonth: 0 }
      statsMap[src].count++
      statsMap[src].revenue += p.invoices.reduce((s, inv) => s + Number(inv.paidUGX), 0)
      if (new Date(p.createdAt) >= startOfMonth) statsMap[src].thisMonth++
    }

    // Named sources sorted by count descending; 'Not Recorded' always last
    const named = Object.entries(statsMap)
      .filter(([src]) => src !== NOT_RECORDED)
      .map(([source, d]) => ({ source, ...d }))
      .sort((a, b) => b.count - a.count)
    const notRecorded = statsMap[NOT_RECORDED]
    const stats = notRecorded
      ? [...named, { source: NOT_RECORDED, ...notRecorded }]
      : named

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
        guardian: { select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true } },
        dependents: {
          select: { id: true, firstName: true, lastName: true, phone: true, patientNumber: true, relationship: true, isMinor: true, accountBalance: true },
          orderBy: { firstName: 'asc' },
        },
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
      dependents: patient.dependents.map(d => ({ ...d, accountBalance: Number(d.accountBalance) })),
    })
  } catch { res.status(500).json({ error: 'Failed to fetch patient' }) }
})

// GET /patients/:id/family-balance — guardian's own balance + all dependents
router.get('/:id/family-balance', requireAuth, async (req, res) => {
  try {
    const guardian = await prisma.patient.findUnique({
      where: { id: req.params.id },
      select: { id: true, firstName: true, lastName: true, accountBalance: true, patientNumber: true, dependents: {
        select: { id: true, firstName: true, lastName: true, accountBalance: true, patientNumber: true, relationship: true },
        orderBy: { firstName: 'asc' },
      } },
    })
    if (!guardian) { res.status(404).json({ error: 'Patient not found' }); return }
    const guardianBalance = Number(guardian.accountBalance)
    const dependentBalances = guardian.dependents.map(d => ({ ...d, accountBalance: Number(d.accountBalance) }))
    const familyTotal = guardianBalance + dependentBalances.reduce((s, d) => s + d.accountBalance, 0)
    res.json({ guardianBalance, dependents: dependentBalances, familyTotal })
  } catch { res.status(500).json({ error: 'Failed to fetch family balance' }) }
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
      referralSource, status, guardianId, isMinor, relationship,
    } = req.body
    // Prevent a patient from being their own guardian
    if (guardianId !== undefined && guardianId === req.params.id) {
      res.status(400).json({ error: 'A patient cannot be their own guardian' }); return
    }
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
        ...(guardianId !== undefined ? { guardianId: guardianId || null } : {}),
        ...(isMinor !== undefined ? { isMinor } : {}),
        ...(relationship !== undefined ? { relationship: relationship || null } : {}),
      },
    })
    logAudit({ userId: req.user!.id, actionType: 'UPDATE', entityType: 'PATIENT', entityId: patient.id, entityName: `${patient.firstName} ${patient.lastName}`, req })
    res.json({ ...patient, patientId: formatPatientId(patient.patientNumber), accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to update patient' }) }
})

// DELETE /patients/:id — admin + receptionist only
router.delete('/:id', requireAuth, adminAndReceptionist, auditLog('patients'), async (req, res) => {
  try {
    const id = req.params.id
    const patientForAudit = await prisma.patient.findUnique({ where: { id }, select: { firstName: true, lastName: true } })
    // Safety check — refuse deletion if patient has appointments or treatment records
    const [apptCount, planCount] = await Promise.all([
      prisma.appointment.count({ where: { patientId: id } }),
      prisma.treatmentPlan.count({ where: { patientId: id } }),
    ])
    if (apptCount > 0 || planCount > 0) {
      res.status(409).json({
        error: `Cannot delete — patient has ${apptCount} appointment(s) and ${planCount} treatment record(s). Deactivate instead.`,
      }); return
    }
    await prisma.$transaction(async (tx) => {
      // Null out optional patient FKs
      await tx.nurtureLog.updateMany({ where: { patientId: id }, data: { patientId: null } })
      await tx.agentLog.updateMany({ where: { patientId: id }, data: { patientId: null } })
      await tx.agentMemory.deleteMany({ where: { patientId: id } })
      await tx.aiConversation.updateMany({ where: { patientId: id }, data: { patientId: null } })
      // Required FKs — delete first
      await tx.aiScheduledMessage.deleteMany({ where: { patientId: id } })
      await tx.outboundQueue.deleteMany({ where: { patientId: id } })
      // Appointments and their dependents
      const apptIds = (await tx.appointment.findMany({ where: { patientId: id }, select: { id: true } })).map(a => a.id)
      if (apptIds.length > 0) {
        await tx.patientFeedback.deleteMany({ where: { appointmentId: { in: apptIds } } })
        await tx.invoice.updateMany({ where: { appointmentId: { in: apptIds } }, data: { appointmentId: null } })
      }
      await tx.patientFeedback.deleteMany({ where: { patientId: id } })
      await tx.appointment.deleteMany({ where: { patientId: id } })
      // Invoices and payments
      await tx.payment.deleteMany({ where: { patientId: id } })
      await tx.invoice.deleteMany({ where: { patientId: id } })
      // Patient row (TreatmentPlan/Note/DentalChart/PatientDocument/PatientActivity have onDelete:Cascade)
      await tx.patient.delete({ where: { id } })
    })
    logAudit({ userId: req.user!.id, actionType: 'DELETE', entityType: 'PATIENT', entityId: id, entityName: patientForAudit ? `${patientForAudit.firstName} ${patientForAudit.lastName}` : id, severity: 'WARNING', req })
    res.json({ deleted: true })
  } catch (e: any) {
    console.error('[patients] delete error:', e)
    res.status(500).json({ error: 'Failed to delete patient' })
  }
})

// POST /patients/:id/merge — admin + receptionist
router.post('/:id/merge', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const targetId = req.params.id
    const { sourceId } = req.body
    if (!sourceId || sourceId === targetId) {
      res.status(400).json({ error: 'Invalid source patient' }); return
    }
    const [target, source] = await Promise.all([
      prisma.patient.findUnique({ where: { id: targetId } }),
      prisma.patient.findUnique({ where: { id: sourceId } }),
    ])
    if (!target || !source) {
      res.status(404).json({ error: 'Patient not found' }); return
    }

    await prisma.$transaction(async (tx) => {
      // Re-parent all clinical records to target
      await tx.appointment.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.invoice.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.payment.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.patientFeedback.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.treatmentPlan.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.treatmentNote.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.patientDocument.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })
      await tx.patientActivity.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } })

      // Null out agent/AI logs (not clinically attributed)
      await tx.nurtureLog.updateMany({ where: { patientId: sourceId }, data: { patientId: null } })
      await tx.agentLog.updateMany({ where: { patientId: sourceId }, data: { patientId: null } })
      await tx.aiConversation.updateMany({ where: { patientId: sourceId }, data: { patientId: null } })

      // Delete non-re-parentable records
      await tx.agentMemory.deleteMany({ where: { patientId: sourceId } })
      await tx.aiScheduledMessage.deleteMany({ where: { patientId: sourceId } })
      await tx.outboundQueue.deleteMany({ where: { patientId: sourceId } })

      // Handle DentalChart unique constraint — keep target's if it exists
      const sourceDental = await tx.dentalChart.findUnique({ where: { patientId: sourceId } })
      if (sourceDental) {
        const targetDental = await tx.dentalChart.findUnique({ where: { patientId: targetId } })
        if (!targetDental) {
          await tx.dentalChart.update({ where: { patientId: sourceId }, data: { patientId: targetId } })
        } else {
          await tx.dentalChart.delete({ where: { patientId: sourceId } })
        }
      }

      // Merge text fields — append source's into target's if target doesn't have them
      const mergedAllergies = [target.allergies, source.allergies].filter(Boolean).join('; ') || null
      const mergedHistory = [target.medicalHistory, source.medicalHistory].filter(Boolean).join('\n\n---\n\n') || null
      await tx.patient.update({
        where: { id: targetId },
        data: { allergies: mergedAllergies, medicalHistory: mergedHistory },
      })

      // Delete source patient (PatientDocument/Activity already re-parented above)
      await tx.patient.delete({ where: { id: sourceId } })
    })

    res.json({ merged: true, targetId })
  } catch (e: any) {
    console.error('[patients] merge error:', e)
    res.status(500).json({ error: 'Failed to merge patients' })
  }
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
