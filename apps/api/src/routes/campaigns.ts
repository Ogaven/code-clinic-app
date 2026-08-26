import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage, sendWhatsAppMessageDirect, sendWhatsAppTemplate } from '../ai-suite/whatsapp/whatsapp.service'

// Kenya WABA has no billing block and APPROVED templates — use it for all birthday sends
const KENYA_PHONE_NUMBER_ID = '1163288503545718'
const BIRTHDAY_TEMPLATE     = 'cc_birthday_greeting'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

// ── Birthday endpoints ───────────────────────────────────────────────────────

// GET /campaigns/birthdays/today — patients whose birthday is today + sent status
//
// TIMEZONE: today's month/day must be read via explicit Africa/Kampala, not
// server-local Date accessors — see birthday.service.ts for the full
// explanation of why this was previously showing birthdays a day early.
router.get('/birthdays/today', requireAuth, async (_req, res) => {
  try {
    const now        = new Date()
    const todayMonth = parseInt(now.toLocaleDateString('en-US', { month: 'numeric', timeZone: 'Africa/Kampala' }))
    const todayDay   = parseInt(now.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Africa/Kampala' }))

    const todayStart = new Date(`${now.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' })}T00:00:00+03:00`)

    const patients = await prisma.$queryRaw<Array<{
      id:        string
      firstName: string
      lastName:  string
      phone:     string
      dob:       Date
    }>>`
      SELECT id, "firstName", "lastName", phone, dob
      FROM patients
      WHERE EXTRACT(MONTH FROM dob) = ${todayMonth}
        AND EXTRACT(DAY FROM dob)   = ${todayDay}
        AND "isActive" = true
        AND phone IS NOT NULL
        AND phone != ''
      ORDER BY "firstName"
    `

    const sentLogs = await prisma.botMessageLog.findMany({
      where: { templateType: 'BIRTHDAY', sentAt: { gte: todayStart } },
      select: { recipientPhone: true },
    })
    const sentPhones = new Set(sentLogs.map(l => l.recipientPhone))

    res.json(patients.map(p => ({
      id:        p.id,
      firstName: p.firstName,
      lastName:  p.lastName,
      phone:     p.phone,
      dob:       p.dob,
      sentToday: sentPhones.has(p.phone),
    })))
  } catch (err: any) {
    console.error('[Birthdays] Error fetching today:', err)
    res.status(500).json({ error: 'Failed to fetch birthday patients' })
  }
})

// POST /campaigns/birthdays/:patientId/generate — Claude-drafted birthday message body
// Returns ONLY the middle personalized section — the template wrapper (greeting +
// clinic signature) is added automatically on send.
router.post('/birthdays/:patientId/generate', requireAuth, async (req, res) => {
  try {
    const { styleHint } = req.body as { styleHint?: string }

    const patient = await prisma.patient.findUnique({
      where:  { id: req.params.patientId },
      select: { id: true, firstName: true, dob: true },
    })
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return }

    // Kampala year for "now", UTC year for dob (dob is stored as UTC-midnight
    // for its calendar date, so .getUTCFullYear() recovers the exact year
    // originally entered, immune to server/browser ambient timezone).
    const kampalaYear = parseInt(new Date().toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Africa/Kampala' }))
    const age    = patient.dob ? kampalaYear - new Date(patient.dob).getUTCFullYear() : null
    const ageStr = age ? ` who is turning ${age} today` : ''
    const styleLine = styleHint?.trim()
      ? `\nStyle/tone guidance from staff: "${styleHint.trim()}"`
      : ''

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-5',
      max_tokens: 200,
      messages:   [{
        role:    'user',
        content: `Write the personalized body of a birthday WhatsApp message for a dental clinic patient named ${patient.firstName}${ageStr}. The clinic is Code Clinic in Kampala, Uganda.

The message is automatically prefixed with "Happy Birthday from Code Clinic! 🎂" and signed "— The Code Clinic Team, Kampala 🦷". Write ONLY the middle 2-3 sentence body — do NOT include any greeting, "Happy Birthday", or clinic signature.

Include a warm personal touch and a gentle promotional nudge (e.g. a complimentary birthday check-up this month).${styleLine}

Plain text only — no markdown, no asterisks, no bullet points.`,
      }],
    })

    const block = response.content[0]
    const draft = block?.type === 'text' ? block.text.trim() : null
    if (!draft) { res.status(500).json({ error: 'No response from AI' }); return }

    res.json({ draft })
  } catch (err: any) {
    console.error('[Birthdays] Generate error:', err)
    res.status(500).json({ error: err.message || 'Failed to generate message' })
  }
})

// POST /campaigns/birthdays/:patientId/send — explicit staff-triggered send only.
// Routes via approved cc_birthday_greeting template on Kenya WABA (no 24h window limit,
// no billing block). Falls back to freeform on the same WABA if template is still pending.
router.post('/birthdays/:patientId/send', requireAuth, async (req, res) => {
  try {
    const { message } = req.body
    if (!message?.trim()) { res.status(400).json({ error: 'Message required' }); return }

    const patient = await prisma.patient.findUnique({
      where:  { id: req.params.patientId },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const alreadySent = await prisma.botMessageLog.findFirst({
      where: { recipientPhone: patient.phone, templateType: 'BIRTHDAY', sentAt: { gte: todayStart } },
    })
    if (alreadySent) { res.status(409).json({ error: 'Birthday message already sent today' }); return }

    const body = message.trim()
    let sentVia = 'template'

    try {
      // Preferred path: approved template bypasses 24h re-engagement window
      await sendWhatsAppTemplate(patient.phone, BIRTHDAY_TEMPLATE, [body], true, KENYA_PHONE_NUMBER_ID)
    } catch (templateErr: any) {
      // Template pending approval or rejected — fall back to freeform on Kenya WABA
      console.warn(`[Birthdays] Template send failed (${templateErr.message}), falling back to freeform`)
      await sendWhatsAppMessageDirect(patient.phone, body, KENYA_PHONE_NUMBER_ID)
      sentVia = 'freeform'
    }

    await prisma.botMessageLog.create({
      data: {
        patientId:      patient.id,
        recipientPhone: patient.phone,
        channel:        'WHATSAPP',
        templateType:   'BIRTHDAY',
        messageBody:    body,
        deliveryStatus: 'sent',
      },
    })

    console.log(`[Birthdays] Sent to ${patient.firstName} ${patient.lastName} via ${sentVia}`)
    res.json({ ok: true, sentVia })
  } catch (err: any) {
    console.error('[Birthdays] Send error:', err)
    res.status(500).json({ error: err.message || 'Failed to send — WhatsApp returned an error' })
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
