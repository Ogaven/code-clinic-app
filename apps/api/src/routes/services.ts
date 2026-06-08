import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { adminOnly, allStaff } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { uploadFile, deleteFile, getPublicUrl } from '../services/storage/r2'
import { uploadLimiter } from '../middleware/rateLimit'
import { prisma } from '../lib/prisma'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

function withPhotoUrl(s: any) {
  return {
    ...s,
    priceUGX: Number(s.priceUGX),
    photoUrl: s.photoR2Key ? getPublicUrl(s.photoR2Key) : null,
  }
}

// GET /services
router.get('/', requireAuth, async (_req, res) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    res.json(services.map(withPhotoUrl))
  } catch { res.status(500).json({ error: 'Failed to fetch services' }) }
})

// GET /services/all (all staff — includes inactive)
router.get('/all', requireAuth, allStaff, async (_req, res) => {
  try {
    const services = await prisma.service.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
    res.json(services.map(withPhotoUrl))
  } catch { res.status(500).json({ error: 'Failed to fetch services' }) }
})

// POST /services
const createServiceSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.string().optional(),
  durationMins: z.number().int().min(5),
  priceUGX: z.number().int().min(0),
  priceUSD: z.number().optional(),
  vatApplicable: z.boolean().optional(),
  colour: z.string().optional(),
})

router.post('/', requireAuth, adminOnly, validate(createServiceSchema), async (req, res) => {
  try {
    const service = await prisma.service.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        category: req.body.category || 'General',
        durationMins: req.body.durationMins,
        priceUGX: req.body.priceUGX,
        priceUSD: req.body.priceUSD ?? req.body.priceUGX / 3700,
        vatApplicable: req.body.vatApplicable ?? true,
        colour: req.body.colour || '#29ABE2',
      },
    })
    res.status(201).json(withPhotoUrl(service))
  } catch (e: any) {
    if (e.code === 'P2002') { res.status(409).json({ error: 'Service name already exists' }); return }
    res.status(500).json({ error: 'Failed to create service' })
  }
})

// PATCH /services/:id
const updateServiceSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  durationMins: z.number().int().min(5).optional(),
  priceUGX: z.number().int().min(0).optional(),
  priceUSD: z.number().optional(),
  vatApplicable: z.boolean().optional(),
  colour: z.string().optional(),
  isActive: z.boolean().optional(),
})

router.patch('/:id', requireAuth, adminOnly, validate(updateServiceSchema), async (req, res) => {
  try {
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data: req.body,
    })
    res.json(withPhotoUrl(service))
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Service not found' }); return }
    res.status(500).json({ error: 'Failed to update service' })
  }
})

// DELETE /services/:id (soft delete — set isActive=false, or hard delete if ?hard=1)
router.delete('/:id', requireAuth, adminOnly, async (req, res) => {
  try {
    if (req.query.hard === '1') {
      // Hard delete — remove from DB (only if no appointments exist)
      const apptCount = await prisma.appointment.count({ where: { serviceId: req.params.id } })
      if (apptCount > 0) {
        res.status(409).json({ error: `Cannot delete: ${apptCount} appointment(s) use this service. Deactivate instead.` })
        return
      }
      const svc = await prisma.service.findUnique({ where: { id: req.params.id } })
      if (svc?.photoR2Key) await deleteFile(svc.photoR2Key).catch(() => {})
      await prisma.service.delete({ where: { id: req.params.id } })
      res.json({ message: 'Service deleted' })
    } else {
      await prisma.service.update({ where: { id: req.params.id }, data: { isActive: false } })
      res.json({ message: 'Service deactivated' })
    }
  } catch { res.status(500).json({ error: 'Failed to delete service' }) }
})

// POST /services/:id/photo — upload service icon/photo
router.post('/:id/photo', requireAuth, adminOnly, uploadLimiter, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only JPEG, PNG or WebP allowed' })
    }

    const svc = await prisma.service.findUnique({ where: { id: req.params.id } })
    if (!svc) return res.status(404).json({ error: 'Service not found' })

    // Delete old photo if exists
    if (svc.photoR2Key && !svc.photoR2Key.startsWith('data:')) {
      await deleteFile(svc.photoR2Key).catch(() => {})
    }

    let photoUrl: string
    let photoR2Key: string

    try {
      const { uploadAvatar } = await import('../services/storage/r2')
      photoR2Key = await uploadAvatar(req.file.buffer, req.file.mimetype, 'doctors', `service-${req.params.id}`)
      photoUrl = getPublicUrl(photoR2Key)
    } catch {
      // base64 fallback
      const base64 = req.file.buffer.toString('base64')
      photoR2Key = `data:${req.file.mimetype};base64,${base64}`
      photoUrl = photoR2Key
    }

    await prisma.service.update({ where: { id: req.params.id }, data: { photoR2Key } })
    res.json({ photoUrl })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

export default router
