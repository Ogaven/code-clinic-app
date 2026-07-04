import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'
import { prisma } from '../lib/prisma'

const router = Router()

// GET /audit-logs — paginated, filterable audit trail (admin only)
router.get('/', requireAuth, adminOnly, async (req, res) => {
  try {
    const {
      page       = '1',
      limit      = '50',
      action,
      actionType,
      resource,
      entityType,
      severity,
      userId,
      entityId,
      from,
      to,
      q,
    } = req.query as Record<string, string>

    const where: any = {}
    if (action)     where.action     = action
    if (actionType) where.actionType = actionType
    if (resource)   where.resource   = resource
    if (entityType) where.entityType = entityType
    if (severity)   where.severity   = severity
    if (userId)     where.userId     = userId
    if (entityId)   where.entityId   = entityId
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to)   where.createdAt.lte = new Date(to)
    }
    if (q) {
      where.OR = [
        { resource:    { contains: q, mode: 'insensitive' } },
        { resourceId:  { contains: q, mode: 'insensitive' } },
        { entityName:  { contains: q, mode: 'insensitive' } },
        { notes:       { contains: q, mode: 'insensitive' } },
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
          user: { select: { firstName: true, lastName: true, email: true, role: true, avatarR2Key: true } },
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

// GET /audit-logs/verify — recompute hash chain and flag tampered entries (admin only)
router.get('/verify', requireAuth, adminOnly, async (req, res) => {
  try {
    const { createHash } = await import('crypto')
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, actionType: true, entityType: true, entityId: true, entityName: true, createdAt: true, hashChain: true },
    })

    let prevHash = '0'.repeat(64)
    const tampered: string[] = []

    for (const log of logs) {
      if (!log.hashChain) { prevHash = '0'.repeat(64); continue }
      const entryData = JSON.stringify({
        userId: log.userId, actionType: log.actionType, entityType: log.entityType,
        entityId: log.entityId, entityName: log.entityName,
        timestamp: log.createdAt.toISOString(),
      })
      const expected = createHash('sha256').update(prevHash + entryData).digest('hex')
      if (expected !== log.hashChain) tampered.push(log.id)
      prevHash = log.hashChain
    }

    res.json({ total: logs.length, tampered: tampered.length, tamperedIds: tampered, intact: tampered.length === 0 })
  } catch (e) {
    console.error('[audit-logs/verify]', e)
    res.status(500).json({ error: 'Verification failed' })
  }
})

// GET /audit-logs/patient/:patientId — per-patient audit trail (admin only)
router.get('/patient/:patientId', requireAuth, adminOnly, async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { entityId: req.params.patientId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json(logs)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch patient audit trail' })
  }
})

export default router
