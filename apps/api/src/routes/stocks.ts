import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { accountsOrAdmin } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

const router = Router()

// Previously requireAuth-only — any authenticated user of any role could
// read/write/delete inventory via direct API calls, even though the only
// nav links and route access to /stocks (Sidebar.tsx, (admin)/layout.tsx's
// ACCOUNTS allowlist) are ADMIN and ACCOUNTS. No Receptionist/Doctor UI or
// product requirement ever existed for this data (see WORKSTREAM A final
// closure pass). Restricted to match the existing, unambiguous product
// design rather than inventing new policy.
router.use(requireAuth, accountsOrAdmin)

router.get('/items', async (_req, res) => {
  try {
    const items = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } })
    res.json(items)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/items', async (req, res) => {
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

router.put('/items/:id', async (req, res) => {
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

router.delete('/items/:id', async (req, res) => {
  try {
    await prisma.stockItem.delete({ where: { id: req.params.id } })
    res.json({ deleted: true })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

export default router