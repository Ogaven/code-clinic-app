import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

const router = Router()

// GET /audit-logs — paginated, filterable audit trail (admin only)
router.get('/', requireAuth, adminOnly, async (req, res) => {
  try {
    const {
      page     = '1',
      limit    = '50',
      action,
      resource,
      userId,
      from,
      to,
      q,
    } = req.query as Record<string, string>

    const where: any = {}
    if (action)   where.action   = action
    if (resource) where.resource = resource
    if (userId)   where.userId   = userId
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to)   where.createdAt.lte = new Date(to)
    }
    if (q) {
      where.OR = [
        { resource:   { contains: q, mode: 'insensitive' } },
        { resourceId: { contains: q, mode: 'insensitive' } },
        { user: { OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName:  { contains: q, mode: 'insensitive' } },
          { email:     { contains: q, mode: 'insensitive' } },
        ]}},
      ]
    }

    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(100, Math.max(1, Number(limit)))

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ])

    res.json({ logs, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) })
  } catch (e) {
    console.error('[audit-logs]', e)
    res.status(500).json({ error: 'Failed to fetch audit logs' })
  }
})

export default router
