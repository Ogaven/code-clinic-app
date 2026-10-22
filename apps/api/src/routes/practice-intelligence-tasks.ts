import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/rbac'

const router = Router()
const allowedActions = new Set(['REVIEW_SCHEDULE', 'REVIEW_ATTENDANCE', 'REVIEW_CAPACITY', 'REVIEW_CRM'])
const allowedDecisions = new Set(['APPROVED', 'REJECTED'])

// Admin-only proposals are advisory records. Approval never executes an action.
router.get('/recommendations', requireAuth, adminOnly, async (_req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { entityType: 'PRACTICE_INTELLIGENCE', approvalStatus: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ tasks })
  } catch {
    res.status(500).json({ error: 'Unable to load review queue' })
  }
})

router.post('/recommendations', requireAuth, adminOnly, async (req, res) => {
  const { evidenceKey, title, description, proposedAction } = req.body ?? {}
  if (typeof evidenceKey !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(evidenceKey)
    || typeof title !== 'string' || !title.trim() || title.length > 200
    || (description !== undefined && (typeof description !== 'string' || description.length > 2000))
    || typeof proposedAction !== 'string' || !allowedActions.has(proposedAction)) {
    res.status(400).json({ error: 'Invalid recommendation proposal' }); return
  }
  try {
    const existing = await prisma.task.findFirst({
      where: { entityType: 'PRACTICE_INTELLIGENCE', entityId: evidenceKey, approvalStatus: 'PENDING_REVIEW' },
    })
    if (existing) { res.status(409).json({ error: 'An open review already exists', taskId: existing.id }); return }
    const task = await prisma.$transaction(async tx => {
      const created = await tx.task.create({
        data: {
          entityType: 'PRACTICE_INTELLIGENCE', entityId: evidenceKey,
          title: title.trim(), description: description?.trim() ?? null,
          proposedAction, approvalStatus: 'PENDING_REVIEW',
        },
      })
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'CREATE', resource: 'PRACTICE_INTELLIGENCE_TASK',
        resourceId: created.id, entityType: 'PRACTICE_INTELLIGENCE_TASK', entityId: created.id,
        entityName: created.title, actionType: 'CREATE', notes: 'Recommendation submitted for staff review',
      } })
      return created
    })
    res.status(201).json({ task })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      res.status(409).json({ error: 'An open review already exists' }); return
    }
    res.status(500).json({ error: 'Unable to create recommendation' })
  }
})

// Assignment is administrative coordination, never action execution.
router.get('/assignees', requireAuth, adminOnly, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['ADMIN', 'DOCTOR', 'RECEPTIONIST'] } },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    })
    res.json({ users })
  } catch {
    res.status(500).json({ error: 'Unable to load eligible staff' })
  }
})

router.post('/recommendations/:id/assign', requireAuth, adminOnly, async (req, res) => {
  const { assignedToId } = req.body ?? {}
  if (typeof assignedToId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(assignedToId)) {
    res.status(400).json({ error: 'Valid staff ID required' }); return
  }
  try {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, isActive: true, role: { in: ['ADMIN', 'DOCTOR', 'RECEPTIONIST'] } },
      select: { id: true },
    })
    if (!assignee) { res.status(400).json({ error: 'Eligible active staff member not found' }); return }
    const result = await prisma.$transaction(async tx => {
      const task = await tx.task.findFirst({
        where: { id: req.params.id, entityType: 'PRACTICE_INTELLIGENCE', approvalStatus: { in: ['PENDING_REVIEW', 'APPROVED'] } },
      })
      if (!task) return null
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { assignedToId: assignee.id },
      })
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'UPDATE', resource: 'PRACTICE_INTELLIGENCE_TASK',
        resourceId: task.id, entityType: 'PRACTICE_INTELLIGENCE_TASK', entityId: task.id,
        entityName: task.title, actionType: 'UPDATE',
        fieldChanges: JSON.stringify({ before: { assignedToId: task.assignedToId }, after: { assignedToId: assignee.id } }),
        notes: 'Administrative assignment only; no action executed',
      } })
      return updated
    })
    if (!result) { res.status(404).json({ error: 'Reviewable recommendation not found' }); return }
    res.json({ task: result, actionExecuted: false })
  } catch {
    res.status(500).json({ error: 'Unable to assign recommendation' })
  }
})

router.post('/recommendations/:id/decision', requireAuth, adminOnly, async (req, res) => {
  const { decision, notes } = req.body ?? {}
  if (!allowedDecisions.has(decision) || (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000))) {
    res.status(400).json({ error: 'Invalid review decision' }); return
  }
  try {
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.task.updateMany({
        where: { id: req.params.id, entityType: 'PRACTICE_INTELLIGENCE', approvalStatus: 'PENDING_REVIEW' },
        data: { approvalStatus: decision, reviewedById: req.user!.id, reviewedAt: new Date(), reviewNotes: notes?.trim() ?? null },
      })
      if (updated.count !== 1) return null
      const task = await tx.task.findUniqueOrThrow({ where: { id: req.params.id } })
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'STATUS_CHANGE', resource: 'PRACTICE_INTELLIGENCE_TASK',
        resourceId: task.id, entityType: 'PRACTICE_INTELLIGENCE_TASK', entityId: task.id,
        entityName: task.title, actionType: 'STATUS_CHANGE',
        fieldChanges: JSON.stringify({ before: { approvalStatus: 'PENDING_REVIEW' }, after: { approvalStatus: decision } }),
        notes: notes?.trim() || 'Staff-reviewed recommendation; no automatic execution',
      } })
      return task
    })
    if (!result) { res.status(409).json({ error: 'Recommendation not found or already reviewed' }); return }
    res.json({ task: result, actionExecuted: false })
  } catch {
    res.status(500).json({ error: 'Unable to record review decision' })
  }
})

export default router
