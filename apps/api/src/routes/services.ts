import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { validate } from '../middleware/validate'

const router = Router()
const prisma = new PrismaClient()

// GET /services
router.get('/', requireAuth, async (_req, res) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    res.json(services.map((s) => ({ ...s, priceUGX: Number(s.priceUGX) })))
  } catch { res.status(500).json({ error: 'Failed to fetch services' }) }
})

// GET /services/all (includes inactive)
router.get('/all', requireAuth, adminOnly, async (_req, res) => {
  try {
    const services = await prisma.service.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
    res.json(services.map((s) => ({ ...s, priceUGX: Number(s.priceUGX) })))
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
    res.status(201).json({ ...service, priceUGX: Number(service.priceUGX) })
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
    res.json({ ...service, priceUGX: Number(service.priceUGX) })
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Service not found' }); return }
    res.status(500).json({ error: 'Failed to update service' })
  }
})

// DELETE /services/:id (soft delete — set isActive=false)
router.delete('/:id', requireAuth, adminOnly, async (req, res) => {
  try {
    await prisma.service.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ message: 'Service deactivated' })
  } catch { res.status(500).json({ error: 'Failed to deactivate service' }) }
})

export default router
