import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { adminOnly, adminAndReceptionist } from '../middleware/rbac'

const router = Router()

// ── Sponsor Organizations ─────────────────────────────────────────────────────

router.get('/', requireAuth, adminAndReceptionist, async (_req, res) => {
  try {
    const orgs = await prisma.sponsorOrganization.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { patientSponsors: true, feeSchedules: true } },
      },
    })
    res.json(orgs)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/', requireAuth, adminOnly, async (req, res) => {
  try {
    const { name, contactName, contactPhone, contactEmail, address, isActive } = req.body
    if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return }
    const org = await prisma.sponsorOrganization.create({
      data: { name: name.trim(), contactName, contactPhone, contactEmail, address, isActive: isActive ?? true },
    })
    res.json(org)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.put('/:id', requireAuth, adminOnly, async (req, res) => {
  try {
    const { name, contactName, contactPhone, contactEmail, address, isActive } = req.body
    const org = await prisma.sponsorOrganization.update({
      where: { id: req.params.id },
      data: { name, contactName, contactPhone, contactEmail, address, isActive },
    })
    res.json(org)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.delete('/:id', requireAuth, adminOnly, async (req, res) => {
  try {
    const activeLinks = await prisma.patientSponsor.count({
      where: { organizationId: req.params.id, eligibility: 'ACTIVE' },
    })
    if (activeLinks > 0) {
      res.status(409).json({ error: `Cannot delete — ${activeLinks} active patient link(s) exist. Terminate eligibility first.` }); return
    }
    await prisma.$transaction([
      prisma.feeSchedule.deleteMany({ where: { organizationId: req.params.id } }),
      prisma.patientSponsor.deleteMany({ where: { organizationId: req.params.id } }),
      prisma.sponsorOrganization.delete({ where: { id: req.params.id } }),
    ])
    res.json({ deleted: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ── Fee Schedules ─────────────────────────────────────────────────────────────

router.get('/:id/fee-schedules', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const schedules = await prisma.feeSchedule.findMany({
      where: { organizationId: req.params.id },
      include: { service: { select: { id: true, name: true, category: true, priceUGX: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json(schedules)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/:id/fee-schedules', requireAuth, adminOnly, async (req, res) => {
  try {
    const { serviceId, negotiatedRate, coveragePercent, notes, effectiveFrom, effectiveTo } = req.body
    const schedule = await prisma.feeSchedule.create({
      data: {
        organizationId:  req.params.id,
        serviceId:       serviceId || null,
        negotiatedRate:  negotiatedRate != null ? Number(negotiatedRate) : null,
        coveragePercent: coveragePercent != null ? Number(coveragePercent) : null,
        notes:           notes || null,
        effectiveFrom:   effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo:     effectiveTo   ? new Date(effectiveTo)   : null,
      },
      include: { service: { select: { id: true, name: true, category: true, priceUGX: true } } },
    })
    res.json(schedule)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// PUT /sponsors/fee-schedules/:scheduleId — must be before /:id to avoid param collision
router.put('/fee-schedules/:scheduleId', requireAuth, adminOnly, async (req, res) => {
  try {
    const { negotiatedRate, coveragePercent, notes, effectiveFrom, effectiveTo } = req.body
    const schedule = await prisma.feeSchedule.update({
      where: { id: req.params.scheduleId },
      data: {
        negotiatedRate:  negotiatedRate != null ? Number(negotiatedRate) : null,
        coveragePercent: coveragePercent != null ? Number(coveragePercent) : null,
        notes:           notes || null,
        effectiveFrom:   effectiveFrom ? new Date(effectiveFrom) : undefined,
        effectiveTo:     effectiveTo   ? new Date(effectiveTo)   : null,
      },
      include: { service: { select: { id: true, name: true, category: true, priceUGX: true } } },
    })
    res.json(schedule)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.delete('/fee-schedules/:scheduleId', requireAuth, adminOnly, async (req, res) => {
  try {
    await prisma.feeSchedule.delete({ where: { id: req.params.scheduleId } })
    res.json({ deleted: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// ── Patient Sponsor Links ─────────────────────────────────────────────────────

// GET /sponsors/patients/:patientId — get all sponsor links for a patient
router.get('/patients/:patientId', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const links = await prisma.patientSponsor.findMany({
      where: { patientId: req.params.patientId },
      include: {
        organization: {
          select: { id: true, name: true, contactName: true, contactPhone: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(links)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// POST /sponsors/patients/:patientId — create or update patient sponsor link
router.post('/patients/:patientId', requireAuth, adminOnly, async (req, res) => {
  try {
    const { organizationId, employeeId, department, eligibility, balancePayer, startDate, endDate } = req.body
    if (!organizationId) { res.status(400).json({ error: 'organizationId required' }); return }
    if (!startDate)      { res.status(400).json({ error: 'startDate required' }); return }
    const link = await prisma.patientSponsor.upsert({
      where: { patientId_organizationId: { patientId: req.params.patientId, organizationId } },
      create: {
        patientId:      req.params.patientId,
        organizationId,
        employeeId:     employeeId   || null,
        department:     department   || null,
        eligibility:    eligibility  || 'ACTIVE',
        balancePayer:   balancePayer || 'EMPLOYEE',
        startDate:      new Date(startDate),
        endDate:        endDate ? new Date(endDate) : null,
      },
      update: {
        employeeId:   employeeId   || null,
        department:   department   || null,
        eligibility:  eligibility  || 'ACTIVE',
        balancePayer: balancePayer || 'EMPLOYEE',
        startDate:    new Date(startDate),
        endDate:      endDate ? new Date(endDate) : null,
      },
      include: { organization: { select: { id: true, name: true, isActive: true } } },
    })
    res.json(link)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// DELETE /sponsors/patients/:patientId/:linkId — remove a patient sponsor link
router.delete('/patients/:patientId/:linkId', requireAuth, adminOnly, async (req, res) => {
  try {
    await prisma.patientSponsor.delete({ where: { id: req.params.linkId } })
    res.json({ deleted: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

export default router
