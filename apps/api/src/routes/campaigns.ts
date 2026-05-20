import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'

const router = Router()

const SEGMENT_LABELS: Record<string, string> = {
  ALL:           'All Patients',
  NEW_LEAD:      'New Lead',
  UPCOMING:      'Upcoming',
  ACTIVE:        'Active',
  DUE_RECALL:    'Due Recall',
  LAPSED:        'Lapsed',
  DORMANT:       'Dormant',
  BALANCE_OWING: 'Balance Owing',
}

const VALID_SEGMENTS = ['ALL', 'NEW_LEAD', 'UPCOMING', 'ACTIVE', 'DUE_RECALL', 'LAPSED', 'DORMANT', 'BALANCE_OWING']

function segmentWhere(segment: string): any {
  const where: any = { phone: { not: '' } }
  if (segment !== 'ALL') where.status = segment
  return where
}

async function runBroadcast(campaignId: string, segment: string, message: string) {
  try {
    const patients = await prisma.patient.findMany({
      where: segmentWhere(segment),
      select: { id: true, phone: true },
    })

    const sentAt = new Date()
    let sent = 0

    for (let i = 0; i < patients.length; i++) {
      await sendWhatsAppMessage(patients[i].phone, message)
      sent++
      if (i < patients.length - 1) {
        await new Promise(r => setTimeout(r, 300))
      }
    }

    if (patients.length > 0) {
      await prisma.nurtureLog.createMany({
        data: patients.map(p => ({
          patientId:  p.id,
          campaignId,
          channel:    'WHATSAPP',
          message,
          status:     'SENT',
          sentAt,
        })),
      })
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { status: 'SENT', sentCount: sent },
    })

    console.log(`[Campaign] Broadcast ${campaignId} complete — ${sent}/${patients.length} sent`)
  } catch (err) {
    console.error(`[Campaign] Broadcast error for ${campaignId}:`, err)
    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { status: 'FAILED' },
    }).catch(() => {})
  }
}

// GET /campaigns — campaign history
router.get('/', requireAuth, async (_req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where:   { channel: 'WHATSAPP', type: 'BROADCAST' },
      orderBy: { createdAt: 'desc' },
      take:    100,
    })
    res.json(campaigns)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to fetch campaigns' })
  }
})

// GET /campaigns/segment-count?segment=ACTIVE
router.get('/segment-count', requireAuth, async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'ALL'
    if (!VALID_SEGMENTS.includes(segment)) {
      res.status(400).json({ error: 'Invalid segment' }); return
    }
    const count = await prisma.patient.count({ where: segmentWhere(segment) })
    res.json({ count })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to count segment' })
  }
})

// POST /campaigns/whatsapp/broadcast
router.post('/whatsapp/broadcast', requireAuth, async (req, res) => {
  try {
    const { segment, message, scheduleAt } = req.body

    if (!segment || !VALID_SEGMENTS.includes(segment)) {
      res.status(400).json({ error: 'Invalid segment' }); return
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message is required' }); return
    }

    const scheduledAt = scheduleAt ? new Date(scheduleAt) : null
    const isFuture    = scheduledAt && scheduledAt > new Date()

    const campaign = await prisma.campaign.create({
      data: {
        type:            'BROADCAST',
        name:            `${SEGMENT_LABELS[segment] || segment} — ${new Date().toLocaleDateString('en-GB')}`,
        channel:         'WHATSAPP',
        messageTemplate: message.trim(),
        targetSegment:   segment,
        scheduledAt:     scheduledAt ?? undefined,
        status:          isFuture ? 'SCHEDULED' : 'SENDING',
        sentCount:       0,
      },
    })

    if (!isFuture) {
      runBroadcast(campaign.id, segment, message.trim()).catch(() => {})
    }

    res.json({ success: true, campaignId: campaign.id, status: campaign.status })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to create campaign' })
  }
})

// Called by scheduler every 5 minutes to fire SCHEDULED campaigns whose time has passed
export async function runScheduledCampaigns() {
  const due = await prisma.campaign.findMany({
    where: {
      status:      'SCHEDULED',
      scheduledAt: { lte: new Date() },
      channel:     'WHATSAPP',
    },
  })

  for (const campaign of due) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } })
    const segment = campaign.targetSegment || 'ALL'
    runBroadcast(campaign.id, segment, campaign.messageTemplate).catch(() => {})
  }

  if (due.length > 0) {
    console.log(`[Campaign] Fired ${due.length} scheduled campaign(s)`)
  }
}

export default router
