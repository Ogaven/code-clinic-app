import { Router } from 'express'
import OpenAI from 'openai'
import { requireAuth } from '../middleware/auth'
import { adminAndReceptionist } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage, sendWhatsAppMessageDirect, sendWhatsAppTemplate } from '../ai-suite/whatsapp/whatsapp.service'
import { getPatientsSeen, splitNewAndReturning, type Range } from '../services/patient-analytics.service'
import {
  kampalaTodayRange, kampalaWeekToDateRange, kampalaMonthToDateRange,
  startOfKampalaDay, endOfKampalaDay,
} from '../utils/kampala-time'

// Kenya WABA has no billing block and APPROVED templates — use it for all birthday sends
const KENYA_PHONE_NUMBER_ID = '1163288503545718'
const BIRTHDAY_TEMPLATE     = 'cc_birthday_greeting'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const router = Router()

// Full label set — still used to render/count LEGACY status-coded segments
// (already-scheduled Campaign rows, and the separate templates.ts send flow,
// which has its own independent segment list and is unaffected by this
// redesign). segmentWhere() below must keep understanding every one of these
// so an already-scheduled campaign fires correctly at its scheduled time.
const SEGMENT_LABELS: Record<string, string> = {
  ALL:           'All Patients',
  NEW_LEAD:      'New Lead',
  UPCOMING:      'Upcoming',
  ACTIVE:        'Active Patients',
  DUE_RECALL:    'Due Recall',
  LAPSED:        'Lapsed',
  DORMANT:       'Dormant',
  BALANCE_OWING: 'Balance Owing',
  NEW:           'New Patients',
}

// The audience selector for NEW broadcasts (POST /whatsapp/broadcast and its
// GET /segment-count preview) is deliberately narrowed to these three, per
// clinic feedback that the full 8-option status list didn't map to how staff
// actually think about who to message. ACTIVE keeps its existing, already-
// established definition (patient.status, computed by patient-status.service
// — a completed appointment within the last 90 days) unchanged; NEW is a
// different kind of segment entirely — see newPatientIdsForSpec() below.
export const BROADCAST_SEGMENTS = ['ALL', 'ACTIVE', 'NEW']

export type RangePreset = 'today' | 'week' | 'month' | 'custom'

export interface SegmentSpec {
  segment: string // 'ALL' | 'ACTIVE' | 'NEW' | any legacy PatientStatus code
  preset?: RangePreset
  from?: string // custom range only, YYYY-MM-DD
  to?: string
}

// Campaign.targetSegment is `String? // JSON string` in schema — legacy rows
// store a bare segment code ("ACTIVE"), which isn't valid JSON, so JSON.parse
// throws and we fall back to treating the whole string as the segment code.
// Only the new NEW+range case actually needs the JSON encoding.
export function parseTargetSegment(raw: string | null | undefined): SegmentSpec {
  if (!raw) return { segment: 'ALL' }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.segment === 'string') return parsed
  } catch {}
  return { segment: raw }
}

export function encodeTargetSegment(spec: SegmentSpec): string {
  return spec.segment === 'NEW' ? JSON.stringify(spec) : spec.segment
}

export function resolveRange(spec: SegmentSpec): Range {
  const preset = spec.preset || 'today'
  if (preset === 'today') return kampalaTodayRange()
  if (preset === 'week')  return kampalaWeekToDateRange()
  if (preset === 'month') return kampalaMonthToDateRange()
  // custom
  const start = spec.from ? startOfKampalaDay(new Date(spec.from)) : startOfKampalaDay()
  const end   = spec.to   ? endOfKampalaDay(new Date(spec.to))     : endOfKampalaDay()
  return { start, end }
}

// "New Patients" reuses patient-analytics.service's canonical "new" definition
// (first-ever ATTENDED appointment falls inside the range; imported patients
// with no known prior visit are excluded) — the same definition Dashboard and
// Daily/Weekly Reports already use — rather than inventing a campaign-local
// one, or reusing the time-agnostic NEW_LEAD status (which has no concept of
// "this week" / "this month" at all).
export async function newPatientIdsForSpec(spec: SegmentSpec): Promise<string[]> {
  const range = resolveRange(spec)
  const seen = await getPatientsSeen(range)
  const { newIds } = await splitNewAndReturning(seen.patientIds, range.start)
  return newIds
}

export function segmentWhere(segment: string): any {
  const where: any = { phone: { not: '' } }
  if (segment !== 'ALL') where.status = segment
  return where
}

async function patientsForSpec(spec: SegmentSpec): Promise<Array<{ id: string; phone: string }>> {
  if (spec.segment === 'NEW') {
    const ids = await newPatientIdsForSpec(spec)
    if (ids.length === 0) return []
    return prisma.patient.findMany({ where: { id: { in: ids }, phone: { not: '' } }, select: { id: true, phone: true } })
  }
  return prisma.patient.findMany({ where: segmentWhere(spec.segment), select: { id: true, phone: true } })
}

async function runBroadcast(campaignId: string, targetSegmentRaw: string, message: string) {
  try {
    const spec = parseTargetSegment(targetSegmentRaw)
    const patients = await patientsForSpec(spec)

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
router.get('/', requireAuth, adminAndReceptionist, async (_req, res) => {
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
// GET /campaigns/segment-count?segment=NEW&preset=week
// GET /campaigns/segment-count?segment=NEW&preset=custom&from=2026-09-01&to=2026-09-18
router.get('/segment-count', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'ALL'
    if (!BROADCAST_SEGMENTS.includes(segment)) {
      res.status(400).json({ error: 'Invalid segment' }); return
    }
    if (segment === 'NEW') {
      const spec: SegmentSpec = {
        segment: 'NEW',
        preset: (req.query.preset as RangePreset) || 'today',
        from:   req.query.from as string | undefined,
        to:     req.query.to as string | undefined,
      }
      const ids = await newPatientIdsForSpec(spec)
      const count = ids.length === 0 ? 0 : await prisma.patient.count({ where: { id: { in: ids }, phone: { not: '' } } })
      res.json({ count })
      return
    }
    const count = await prisma.patient.count({ where: segmentWhere(segment) })
    res.json({ count })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to count segment' })
  }
})

// POST /campaigns/whatsapp/broadcast
router.post('/whatsapp/broadcast', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const { segment, message, scheduleAt, preset, from, to } = req.body

    if (!segment || !BROADCAST_SEGMENTS.includes(segment)) {
      res.status(400).json({ error: 'Invalid segment' }); return
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message is required' }); return
    }
    if (segment === 'NEW' && preset === 'custom' && (!from || !to)) {
      res.status(400).json({ error: 'Custom range requires from and to' }); return
    }

    const spec: SegmentSpec = segment === 'NEW' ? { segment: 'NEW', preset: preset || 'today', from, to } : { segment }
    const encodedSegment = encodeTargetSegment(spec)

    const scheduledAt = scheduleAt ? new Date(scheduleAt) : null
    const isFuture    = scheduledAt && scheduledAt > new Date()

    const campaign = await prisma.campaign.create({
      data: {
        type:            'BROADCAST',
        name:            `${SEGMENT_LABELS[segment] || segment} — ${new Date().toLocaleDateString('en-GB')}`,
        channel:         'WHATSAPP',
        messageTemplate: message.trim(),
        targetSegment:   encodedSegment,
        scheduledAt:     scheduledAt ?? undefined,
        status:          isFuture ? 'SCHEDULED' : 'SENDING',
        sentCount:       0,
      },
    })

    if (!isFuture) {
      runBroadcast(campaign.id, encodedSegment, message.trim()).catch(() => {})
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
router.get('/birthdays/today', requireAuth, adminAndReceptionist, async (_req, res) => {
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

// POST /campaigns/birthdays/:patientId/generate — AI-drafted birthday message body
// Returns ONLY the middle personalized section — the template wrapper (greeting +
// clinic signature) is added automatically on send.
router.post('/birthdays/:patientId/generate', requireAuth, adminAndReceptionist, async (req, res) => {
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

    const response = await openai.responses.create({
      model: 'gpt-5.6-luna',
      input: [{
        role:    'user',
        content: `Write the personalized body of a birthday WhatsApp message for a dental clinic patient named ${patient.firstName}${ageStr}. The clinic is Code Clinic in Kampala, Uganda.

The message is automatically prefixed with "Happy Birthday from Code Clinic! 🎂" and signed "— The Code Clinic Team, Kampala 🦷". Write ONLY the middle 2-3 sentence body — do NOT include any greeting, "Happy Birthday", or clinic signature.

Include a warm personal touch and a gentle promotional nudge (e.g. a complimentary birthday check-up this month).${styleLine}

Plain text only — no markdown, no asterisks, no bullet points.`,
      }],
      max_output_tokens: 200,
    })

    const draft = (response.output_text ?? '').trim() || null
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
router.post('/birthdays/:patientId/send', requireAuth, adminAndReceptionist, async (req, res) => {
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
