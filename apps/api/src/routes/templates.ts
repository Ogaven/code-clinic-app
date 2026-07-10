import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'

const router = Router()

const CATEGORIES = ['Recall', 'Follow-up', 'Promotion', 'Appointment', 'Child health', 'General']
const VARIABLES  = ['patientName', 'doctorName', 'appointmentDate', 'serviceName', 'clinicName', 'primaryContactName']

function proper(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '' }

function fillVariables(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

// GET /templates
router.get('/', requireAuth, async (req, res) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      where: { isActive: true },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    })
    res.json(templates)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// GET /templates/meta — returns available categories and variable names
router.get('/meta', requireAuth, (_req, res) => {
  res.json({ categories: CATEGORIES, variables: VARIABLES })
})

// POST /templates
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, body, category = 'General', variables = [] } = req.body
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'title and body required' })
    const template = await prisma.messageTemplate.create({
      data: {
        title: title.trim(),
        body:  body.trim(),
        category,
        variables: JSON.stringify(variables),
        createdById: (req as any).user?.id ?? null,
      },
    })
    res.json(template)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /templates/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { title, body, category, variables } = req.body
    const template = await prisma.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(title    && { title:     title.trim() }),
        ...(body     && { body:      body.trim()  }),
        ...(category && { category }),
        ...(variables !== undefined && { variables: JSON.stringify(variables) }),
      },
    })
    res.json(template)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /templates/:id  (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await prisma.messageTemplate.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// GET /templates/:id/preview?patientId=  — resolve variables with real patient data
router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const template = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } })
    if (!template) return res.status(404).json({ error: 'Not found' })

    const patientId = req.query.patientId as string | undefined
    let vars: Record<string, string> = { clinicName: 'Code Clinic' }

    if (patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: {
          firstName: true, lastName: true,
          appointments: {
            where:   { status: { not: 'CANCELLED' }, startAt: { gte: new Date() } },
            orderBy: { startAt: 'asc' }, take: 1,
            include: {
              doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
              service: { select: { name: true } },
            },
          },
        },
      })
      if (patient) {
        vars.patientName        = proper(patient.firstName)
        vars.primaryContactName = proper(patient.firstName)
        const appt = patient.appointments[0]
        if (appt) {
          vars.doctorName      = appt.doctor?.user ? `Dr. ${proper(appt.doctor.user.firstName)} ${proper(appt.doctor.user.lastName)}` : 'your doctor'
          vars.appointmentDate = appt.startAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })
          vars.serviceName     = appt.service?.name ?? 'your treatment'
        }
      }
    } else {
      vars = { patientName: 'Sarah', clinicName: 'Code Clinic', doctorName: 'Dr. Kajumba', appointmentDate: 'Monday 14 July', serviceName: 'Dental Checkup', primaryContactName: 'Sarah' }
    }

    res.json({ preview: fillVariables(template.body, vars), vars })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// POST /templates/:id/send  — send to a patient segment with variable substitution
router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const template = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } })
    if (!template) return res.status(404).json({ error: 'Template not found' })

    const { segment = 'ALL', scheduleAt } = req.body
    const VALID = ['ALL', 'NEW_LEAD', 'UPCOMING', 'ACTIVE', 'DUE_RECALL', 'LAPSED', 'DORMANT', 'BALANCE_OWING']
    if (!VALID.includes(segment)) return res.status(400).json({ error: 'Invalid segment' })

    const where: any = { phone: { not: '' } }
    if (segment !== 'ALL') where.status = segment

    // Count recipients
    const count = await prisma.patient.count({ where })

    // Create campaign record
    const campaign = await prisma.campaign.create({
      data: {
        type:            'TEMPLATE',
        name:            template.title,
        channel:         'WHATSAPP',
        messageTemplate: template.body,
        targetSegment:   segment,
        scheduledAt:     scheduleAt ? new Date(scheduleAt) : null,
        status:          scheduleAt ? 'SCHEDULED' : 'SENDING',
        sentCount:       0,
      },
    })

    res.json({ ok: true, campaignId: campaign.id, recipientCount: count, scheduled: !!scheduleAt })

    if (!scheduleAt) {
      setImmediate(async () => {
        try {
          const patients = await prisma.patient.findMany({
            where,
            select: {
              id: true, firstName: true, lastName: true, phone: true,
              appointments: {
                where:   { status: { not: 'CANCELLED' }, startAt: { gte: new Date() } },
                orderBy: { startAt: 'asc' }, take: 1,
                include: {
                  doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
                  service: { select: { name: true } },
                },
              },
            },
          })

          let sent = 0
          for (let i = 0; i < patients.length; i++) {
            const p    = patients[i]
            const appt = p.appointments[0]
            const vars: Record<string, string> = {
              patientName:        proper(p.firstName),
              primaryContactName: proper(p.firstName),
              clinicName:         'Code Clinic',
              doctorName:         appt?.doctor?.user ? `Dr. ${proper(appt.doctor.user.firstName)} ${proper(appt.doctor.user.lastName)}` : 'your doctor',
              appointmentDate:    appt ? appt.startAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' }) : '',
              serviceName:        appt?.service?.name ?? '',
            }
            const msg = fillVariables(template.body, vars)
            await sendWhatsAppMessage(p.phone, msg)
            sent++
            if (i < patients.length - 1) await new Promise(r => setTimeout(r, 300))
          }

          await prisma.campaign.update({
            where: { id: campaign.id },
            data:  { status: 'SENT', sentCount: sent },
          })
          console.log(`[Templates] Campaign ${campaign.id} sent to ${sent} patients`)
        } catch (e: any) {
          console.error('[Templates] Send error:', e.message)
          await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'FAILED' } })
        }
      })
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
