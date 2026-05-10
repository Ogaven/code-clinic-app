import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { clinicalStaff } from '../middleware/rbac'
import { auditLog } from '../middleware/audit'
import { validate } from '../middleware/validate'
import { getPublicUrl } from '../services/storage/r2'
import multer from 'multer'
import { uploadAvatar, deleteFile } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'

const ugandaPhone = z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid phone number')

const createPatientSchema = z.object({
  firstName:          z.string().min(1).max(100),
  lastName:           z.string().min(1).max(100),
  phone:              ugandaPhone,
  email:              z.string().email().optional().or(z.literal('')),
  gender:             z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dob:                z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  address:            z.string().max(255).optional(),
  district:           z.string().max(100).optional(),
  nextOfKinName:      z.string().max(100).optional(),
  nextOfKinPhone:     ugandaPhone.optional(),
  nextOfKinRelation:  z.string().max(50).optional(),
  allergies:          z.string().max(500).optional(),
  medicalHistory:     z.union([z.string(), z.array(z.string())]).optional(),
})

const updatePatientSchema = createPatientSchema.partial()

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// GET /patients
router.get('/', requireAuth, async (req, res) => {
  try {
    const q        = req.query.q        as string | undefined
    const filter   = req.query.filter   as string | undefined
    const sortBy   = req.query.sortBy   as string | undefined
    const limit    = Math.min(Number(req.query.limit) || 50, 500)
    const offset   = Number(req.query.offset) || 0

    // Build search where clause
    const searchWhere: any = q ? {
      OR: [
        { firstName: { contains: q } },
        { lastName:  { contains: q } },
        { phone:     { contains: q } },
        { email:     { contains: q } },
      ],
    } : {}

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
        firstName, lastName, phone, email, gender,
        dob: dob ? new Date(dob) : undefined,
        address, district,
        nextOfKinName, nextOfKinPhone, nextOfKinRelation,
        allergies, medicalHistory: medHistory,
      },
    })
    res.status(201).json({ ...patient, accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to create patient' }) }
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
      accountBalance: Number(patient.accountBalance),
      avatarUrl,
      invoices: patient.invoices.map(i => ({ ...i, totalUGX: Number(i.totalUGX), subtotalUGX: Number(i.subtotalUGX), vatUGX: Number(i.vatUGX), paidUGX: Number(i.paidUGX) })),
    })
  } catch { res.status(500).json({ error: 'Failed to fetch patient' }) }
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
    } = req.body
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: {
        firstName, lastName, phone, email, gender,
        dob: dob ? new Date(dob) : undefined,
        address, district, isActive,
        nextOfKinName, nextOfKinPhone, nextOfKinRelation,
        allergies, medicalHistory,
      },
    })
    res.json({ ...patient, accountBalance: Number(patient.accountBalance) })
  } catch { res.status(500).json({ error: 'Failed to update patient' }) }
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
