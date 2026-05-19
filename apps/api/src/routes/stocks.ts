import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()

router.get('/items', requireAuth, async (_req, res) => {
  try {
    const items = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } })
    res.json(items)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/items', requireAuth, async (req, res) => {
  try {
    const { name, category, quantity, unit, reorderLevel, unitCost, supplier } = req.body
    const item = await prisma.stockItem.create({
      data: { name, category, quantity: Number(quantity), unit, reorderLevel: Number(reorderLevel), unitCost: Number(unitCost), supplier: supplier || null },
    })
    res.status(201).json(item)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.put('/items/:id', requireAuth, async (req, res) => {
  try {
    const { name, category, quantity, unit, reorderLevel, unitCost, supplier } = req.body
    const item = await prisma.stockItem.update({
      where: { id: req.params.id },
      data: { name, category, quantity: Number(quantity), unit, reorderLevel: Number(reorderLevel), unitCost: Number(unitCost), supplier: supplier || null },
    })
    res.json(item)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/items/:id', requireAuth, async (req, res) => {
  try {
    await prisma.stockItem.delete({ where: { id: req.params.id } })
    res.json({ deleted: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

export default router
