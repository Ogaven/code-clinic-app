import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { auditLog } from '../middleware/audit'
import { getSignedDownloadUrl } from '../services/storage/r2'
import multer from 'multer'
import { uploadAvatar, deleteFile } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// GET /patients
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = req.query.q as string | undefined
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const offset = Number(req.query.offset) || 0
    const where = q ? {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' as const } },
        { lastName: { contains: q, mode: 'insensitive' as const } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' as const } },
      ],
    } : undefined
    const [patients, total] = await Promise.all([
      prisma.patient.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      prisma.patient.count({ where }),
    ])
    const withUrls = await Promise.all(patients.map(async (p) => ({
      ...p,
      accountBalance: Number(p.accountBalance),
      avatarUrl: p.avatarR2Key ? await getSignedDownloadUrl(p.avatarR2Key).catch(() => null) : null,
    })))
    res.json({ data: withUrls, total, limit, offset })
  } catch (e) { res.status(500).json({ error: 'Failed to fetch patients' }) }
})

// POST /patients
router.post('/', requireAuth, auditLog('patients'), async (req, res) => {
  try {
    const { firstName, lastName, phone, email, gender, dob, address, district } = req.body
    if (!firstName || !lastName || !phone) {
      res.status(400).json({ error: 'firstName, lastName and phone are required' }); return
    }
    const existing = await prisma.patient.findFirst({ where: { phone } })
    if (existing) { res.status(409).json({ error: 'A patient with this phone number already exists' }); return }
    const patient = await prisma.patient.create({
      data: { firstName, lastName, phone, email, gender, dob: dob ? new Date(dob) : undefined, address, district },
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
    const avatarUrl = patient.avatarR2Key ? await getSignedDownloadUrl(patient.avatarR2Key).catch(() => null) : null
    res.json({
      ...patient,
      accountBalance: Number(patient.accountBalance),
      avatarUrl,
      invoices: patient.invoices.map(i => ({ ...i, totalUGX: Number(i.totalUGX), subtotalUGX: Number(i.subtotalUGX), vatUGX: Number(i.vatUGX), paidUGX: Number(i.paidUGX) })),
    })
  } catch { res.status(500).json({ error: 'Failed to fetch patient' }) }
})

// PATCH /patients/:id
router.patch('/:id', requireAuth, auditLog('patients'), async (req, res) => {
  try {
    const { firstName, lastName, phone, email, gender, dob, address, district, isActive } = req.body
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: { firstName, lastName, phone, email, gender, dob: dob ? new Date(dob) : undefined, address, district, isActive },
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
    const avatarUrl = await getSignedDownloadUrl(r2Key)
    res.json({ avatarUrl, r2Key })
  } catch { res.status(500).json({ error: 'Upload failed' }) }
})

export default router
