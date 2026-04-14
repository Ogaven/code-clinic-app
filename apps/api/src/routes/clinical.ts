import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'
import { uploadAvatar, getPublicUrl } from '../services/storage/r2'

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Helper: log activity ─────────────────────────────────────────────────
async function logActivity(patientId: string, userId: string, userName: string, action: string, metadata?: any) {
  try {
    await prisma.patientActivity.create({
      data: {
        patientId,
        userId,
        userName,
        action,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
  } catch (e) {
    console.error('[activity log]', e)
  }
}

// ─── DENTAL CHART ─────────────────────────────────────────────────────────

// GET /clinical/patients/:id/dental-chart
router.get('/patients/:id/dental-chart', requireAuth, async (req, res) => {
  try {
    const chart = await prisma.dentalChart.findUnique({ where: { patientId: req.params.id } })
    if (!chart) {
      res.json({ teeth: {}, periodontal: {}, aiSummary: null, aiPerioSummary: null })
      return
    }
    res.json({
      ...chart,
      teeth: JSON.parse(chart.teeth || '{}'),
      periodontal: JSON.parse(chart.periodontal || '{}'),
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch dental chart' })
  }
})

// PUT /clinical/patients/:id/dental-chart
router.put('/patients/:id/dental-chart', requireAuth, async (req, res) => {
  try {
    const { teeth, periodontal } = req.body
    const chart = await prisma.dentalChart.upsert({
      where: { patientId: req.params.id },
      create: {
        patientId: req.params.id,
        teeth: JSON.stringify(teeth || {}),
        periodontal: JSON.stringify(periodontal || {}),
      },
      update: {
        teeth: JSON.stringify(teeth || {}),
        periodontal: JSON.stringify(periodontal || {}),
      },
    })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, 'Dental chart updated')
    res.json({ ...chart, teeth: JSON.parse(chart.teeth), periodontal: JSON.parse(chart.periodontal) })
  } catch (e) {
    res.status(500).json({ error: 'Failed to save dental chart' })
  }
})

// POST /clinical/patients/:id/dental-chart/ai-summary
router.post('/patients/:id/dental-chart/ai-summary', requireAuth, async (req, res) => {
  try {
    const { chartData, type } = req.body
    const isPerio = type === 'perio'

    const systemPrompt = isPerio
      ? 'You are a periodontist. Analyze the periodontal chart data and provide a professional clinical summary. Include: BOP percentage, suggested 2017 AAP classification staging and grading, areas of concern, and recommended treatment priorities. Use clear clinical language suitable for a patient file.'
      : 'You are a dental assistant. Analyze the following dental chart data (in JSON format, using FDI notation) and provide a concise, professional summary for a patient file. Focus on active issues (caries, planned treatments), significant restorations (crowns, implants, root canals), and missing teeth. Be specific about tooth numbers.'

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(chartData) }],
    })

    const summary = message.content[0].type === 'text' ? message.content[0].text : ''

    const field = isPerio ? 'aiPerioSummary' : 'aiSummary'
    const chart = await prisma.dentalChart.upsert({
      where: { patientId: req.params.id },
      create: { patientId: req.params.id, [field]: summary },
      update: { [field]: summary },
    })

    res.json({ summary })
  } catch (e: any) {
    console.error('[ai-summary]', e)
    res.status(500).json({ error: e.message || 'Failed to generate AI summary' })
  }
})

// POST /clinical/dental-chart/smart-entry
router.post('/dental-chart/smart-entry', requireAuth, async (req, res) => {
  try {
    const { command } = req.body

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `You are a dental charting assistant. Parse natural language into JSON commands. Use FDI notation. Return ONLY valid JSON with no markdown.
Format: { "commands": [{ "toothNumber": "string", "type": "surface"|"condition", "surface"?: "occlusal"|"buccal"|"lingual"|"mesial"|"distal", "status"?: "Healthy"|"Caries"|"Planned Treatment"|"Amalgam"|"Composite"|"Gold"|"Sealant", "condition"?: "Missing"|"Implant"|"Root Canal"|"Crown"|"Fracture"|"To be Extracted"|"Impacted"|"Mobile"|"Supraerupted"|"Bridge Abutment"|"Pontic"|"Denture" }]}
Examples:
Input: "Caries on 16 occlusal" -> {"commands":[{"toothNumber":"16","type":"surface","surface":"occlusal","status":"Caries"}]}
Input: "Mark 48 as missing" -> {"commands":[{"toothNumber":"48","type":"condition","condition":"Missing"}]}
Input: "Crown on 25" -> {"commands":[{"toothNumber":"25","type":"condition","condition":"Crown"}]}`,
      messages: [{ role: 'user', content: command }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const parsed = JSON.parse(text)
    res.json(parsed)
  } catch (e: any) {
    res.status(500).json({ error: 'Could not parse command', commands: [] })
  }
})

// ─── TREATMENT PLANS ─────────────────────────────────────────────────────

// GET /clinical/patients/:id/treatment-plans
router.get('/patients/:id/treatment-plans', requireAuth, async (req, res) => {
  try {
    const plans = await prisma.treatmentPlan.findMany({
      where: { patientId: req.params.id },
      orderBy: { dateAdded: 'desc' },
    })
    res.json(plans)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch treatment plans' })
  }
})

// POST /clinical/patients/:id/treatment-plans
router.post('/patients/:id/treatment-plans', requireAuth, async (req, res) => {
  try {
    const { serviceId, toothNumber, quantity, costPerUnit, discount, notes, status } = req.body
    const plan = await prisma.treatmentPlan.create({
      data: {
        patientId: req.params.id,
        serviceId: serviceId || null,
        toothNumber: toothNumber || null,
        quantity: Number(quantity) || 1,
        costPerUnit: Number(costPerUnit) || 0,
        discount: Number(discount) || 0,
        notes,
        status: status || 'Planned',
      },
    })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, `Treatment plan item added: ${toothNumber || 'General'}`)
    res.status(201).json(plan)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create treatment plan' })
  }
})

// PUT /clinical/patients/:id/treatment-plans/:planId
router.put('/patients/:id/treatment-plans/:planId', requireAuth, async (req, res) => {
  try {
    const { serviceId, toothNumber, quantity, costPerUnit, discount, notes, status } = req.body
    const plan = await prisma.treatmentPlan.update({
      where: { id: req.params.planId },
      data: {
        serviceId: serviceId || null,
        toothNumber: toothNumber || null,
        quantity: Number(quantity) || 1,
        costPerUnit: Number(costPerUnit) || 0,
        discount: Number(discount) || 0,
        notes,
        status,
      },
    })
    if (status === 'Completed') {
      await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, `Treatment completed: ${toothNumber || 'General'}`)
    }
    res.json(plan)
  } catch (e) {
    res.status(500).json({ error: 'Failed to update treatment plan' })
  }
})

// DELETE /clinical/patients/:id/treatment-plans/:planId
router.delete('/patients/:id/treatment-plans/:planId', requireAuth, async (req, res) => {
  try {
    await prisma.treatmentPlan.delete({ where: { id: req.params.planId } })
    res.json({ message: 'Deleted' })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete treatment plan' })
  }
})

// ─── TREATMENT NOTES ─────────────────────────────────────────────────────

// GET /clinical/patients/:id/treatment-notes
router.get('/patients/:id/treatment-notes', requireAuth, async (req, res) => {
  try {
    const notes = await prisma.treatmentNote.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(notes)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notes' })
  }
})

// POST /clinical/patients/:id/treatment-notes
router.post('/patients/:id/treatment-notes', requireAuth, async (req, res) => {
  try {
    const { content } = req.body
    if (!content?.trim()) { res.status(400).json({ error: 'Content required' }); return }
    const note = await prisma.treatmentNote.create({
      data: { patientId: req.params.id, content, authorId: req.user!.id },
    })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, 'Treatment note added')
    res.status(201).json(note)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create note' })
  }
})

// PUT /clinical/patients/:id/treatment-notes/:noteId
router.put('/patients/:id/treatment-notes/:noteId', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.treatmentNote.findUnique({ where: { id: req.params.noteId } })
    if (!existing) { res.status(404).json({ error: 'Note not found' }); return }
    if (existing.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only the author can edit this note' }); return
    }
    const note = await prisma.treatmentNote.update({
      where: { id: req.params.noteId },
      data: { content: req.body.content },
    })
    res.json(note)
  } catch (e) {
    res.status(500).json({ error: 'Failed to update note' })
  }
})

// DELETE /clinical/patients/:id/treatment-notes/:noteId
router.delete('/patients/:id/treatment-notes/:noteId', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.treatmentNote.findUnique({ where: { id: req.params.noteId } })
    if (!existing) { res.status(404).json({ error: 'Note not found' }); return }
    if (existing.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Only the author can delete this note' }); return
    }
    await prisma.treatmentNote.delete({ where: { id: req.params.noteId } })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, 'Treatment note deleted')
    res.json({ message: 'Deleted' })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete note' })
  }
})

// ─── DOCUMENTS ────────────────────────────────────────────────────────────

// GET /clinical/patients/:id/documents
router.get('/patients/:id/documents', requireAuth, async (req, res) => {
  try {
    const docs = await prisma.patientDocument.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(docs)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch documents' })
  }
})

// POST /clinical/patients/:id/documents
router.post('/patients/:id/documents', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file && !req.body.fileUrl) { res.status(400).json({ error: 'No file provided' }); return }

    let fileUrl = req.body.fileUrl || ''

    if (req.file) {
      try {
        const r2Key = await uploadAvatar(req.file.buffer, req.file.mimetype, 'patients', req.params.id + '-doc-' + Date.now())
        fileUrl = getPublicUrl(r2Key)
      } catch {
        // Fallback: store as base64 data URL
        const b64 = req.file.buffer.toString('base64')
        fileUrl = `data:${req.file.mimetype};base64,${b64}`
      }
    }

    const doc = await prisma.patientDocument.create({
      data: {
        patientId: req.params.id,
        fileName: req.file?.originalname || req.body.fileName || 'document',
        fileType: req.file?.mimetype || req.body.fileType || 'application/octet-stream',
        fileUrl,
        uploadedBy: `${req.user!.firstName} ${req.user!.lastName}`,
      },
    })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, `Document uploaded: ${doc.fileName}`)
    res.status(201).json(doc)
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to upload document' })
  }
})

// DELETE /clinical/patients/:id/documents/:docId
router.delete('/patients/:id/documents/:docId', requireAuth, async (req, res) => {
  try {
    const doc = await prisma.patientDocument.findUnique({ where: { id: req.params.docId } })
    if (!doc) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.patientDocument.delete({ where: { id: req.params.docId } })
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, `Document deleted: ${doc.fileName}`)
    res.json({ message: 'Deleted' })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete document' })
  }
})

// ─── ACTIVITY ─────────────────────────────────────────────────────────────

// GET /clinical/patients/:id/activity
router.get('/patients/:id/activity', requireAuth, async (req, res) => {
  try {
    const activities = await prisma.patientActivity.findMany({
      where: { patientId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json(activities)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch activity' })
  }
})

// POST /clinical/patients/:id/activity (internal)
router.post('/patients/:id/activity', requireAuth, async (req, res) => {
  try {
    const { action, metadata } = req.body
    await logActivity(req.params.id, req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, action, metadata)
    res.status(201).json({ message: 'Logged' })
  } catch (e) {
    res.status(500).json({ error: 'Failed to log activity' })
  }
})

// ─── ANALYTICS ────────────────────────────────────────────────────────────

// GET /clinical/analytics/patient-journey
router.get('/analytics/patient-journey', requireAuth, async (req, res) => {
  try {
    const [totalPatients, appointments, plans] = await Promise.all([
      prisma.patient.count({ where: { isActive: true } }),
      prisma.appointment.findMany({ select: { patientId: true, status: true, createdAt: true } }),
      prisma.treatmentPlan.findMany({ select: { patientId: true, status: true } }),
    ])

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const newPatients = await prisma.patient.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    })

    const patientWithAppts = new Set(appointments.map(a => a.patientId))
    const patientWithMultiple = new Map<string, number>()
    appointments.forEach(a => {
      patientWithMultiple.set(a.patientId, (patientWithMultiple.get(a.patientId) || 0) + 1)
    })
    const returning = Array.from(patientWithMultiple.values()).filter(c => c > 1).length
    const activeTreatment = new Set(plans.filter(p => p.status === 'In Progress' || p.status === 'Planned').map(p => p.patientId)).size
    const completed = new Set(plans.filter(p => p.status === 'Completed').map(p => p.patientId)).size

    res.json({
      leads: await prisma.lead.count(),
      newPatients,
      returning,
      activeTreatment,
      completed,
      total: totalPatients,
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch analytics' })
  }
})

// GET /clinical/analytics/treatment-acceptance
router.get('/analytics/treatment-acceptance', requireAuth, async (req, res) => {
  try {
    const [planned, completed] = await Promise.all([
      prisma.treatmentPlan.count(),
      prisma.treatmentPlan.count({ where: { status: 'Completed' } }),
    ])
    const rate = planned > 0 ? Math.round((completed / planned) * 100) : 0
    res.json({ planned, completed, rate })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch treatment acceptance' })
  }
})

// GET /clinical/analytics/service-mix
router.get('/analytics/service-mix', requireAuth, async (req, res) => {
  try {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const appointments = await prisma.appointment.findMany({
      where: { createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
      include: { service: { select: { name: true, colour: true } } },
    })

    const serviceCount = new Map<string, { name: string; colour: string; count: number }>()
    appointments.forEach(a => {
      const key = a.serviceId
      const existing = serviceCount.get(key)
      if (existing) existing.count++
      else serviceCount.set(key, { name: a.service.name, colour: a.service.colour, count: 1 })
    })

    const sorted = Array.from(serviceCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    res.json(sorted)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch service mix' })
  }
})

// GET /clinical/analytics/provider-workload
router.get('/analytics/provider-workload', requireAuth, async (req, res) => {
  try {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const appointments = await prisma.appointment.findMany({
      where: { createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
      include: {
        doctor: {
          select: { colour: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    })

    const providerMap = new Map<string, { name: string; colour: string; count: number }>()
    appointments.forEach(a => {
      const key = a.doctorId
      const existing = providerMap.get(key)
      const name = `Dr. ${a.doctor.user.firstName} ${a.doctor.user.lastName}`
      if (existing) existing.count++
      else providerMap.set(key, { name, colour: a.doctor.colour, count: 1 })
    })

    res.json(Array.from(providerMap.values()).sort((a, b) => b.count - a.count))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch provider workload' })
  }
})

export default router
