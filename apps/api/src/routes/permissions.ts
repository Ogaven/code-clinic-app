import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

const router = Router()

// GET /staff/permissions/me — returns the calling user's live permissions from DB
router.get('/permissions/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: (req as any).user.id },
      select: { permissions: true },
    })
    let perms: Record<string, boolean> = {}
    try { perms = JSON.parse(user?.permissions || '{}') } catch {}
    res.json(perms)
  } catch {
    res.status(500).json({ error: 'Failed to fetch permissions' })
  }
})

// GET /staff/permissions
router.get('/permissions', requireAuth, adminOnly, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      where:   { isActive: true },
      select:  { id: true, firstName: true, lastName: true, email: true, role: true, permissions: true },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    })
    res.json(users)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch permissions' })
  }
})

// PATCH /staff/:userId/permissions
router.patch('/:userId/permissions', requireAuth, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.update({
      where:  { id: req.params.userId },
      data:   { permissions: JSON.stringify(req.body) },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, permissions: true },
    })
    res.json(user)
  } catch (e) {
    res.status(500).json({ error: 'Failed to update permissions' })
  }
})

export default router
