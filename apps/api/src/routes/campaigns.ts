import { Router } from 'express'
import OpenAI from 'openai'
import { requireAuth } from '../middleware/auth'
import { adminAndReceptionist } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { sendWhatsAppMessage, sendWhatsAppMessageDirect, sendWhatsAppTemplate } from '../ai-suite/whatsapp/whatsapp.service'
import { getPatientsSeen, splitNewAndReturning, type Range } from '../services/patient-analytics.service'
import {
  kampalaTodayRange, kampalaWeekToDateRange, kampalaMonthToDateRange, kampalaYearToDateRange,
  startOfKampalaDay, endOfKampalaDay,
} from '../utils/kampala-time'
import { getChannelConsentStatus } from '../crm-automation/consent-log.service'

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

export type RangePreset = 'today' | 'week' | 'month' | 'year' | 'custom'

export interface SegmentSpec {
  segment: string // 'ALL' | 'ACTIVE' | 'NEW' | any legacy PatientStatus code
  preset?: RangePreset
  from?: string // custom range only, YYYY-MM-DD
  to?: string
  // Date-added ("registered") filter on Patient.createdAt — combinable with
  // ANY segment (ALL/ACTIVE/NEW alike), unlike `preset`/`from`/`to` above,
  // which is NEW's own "first attended appointment" date concept and only
  // ever applies to that one segment. Deliberately separate fields/names so
  // the two date concepts can never be silently conflated.
  registeredPreset?: RangePreset
  registeredFrom?: string
  registeredTo?: string
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
  // Must JSON-encode whenever ANY range info needs to survive a scheduled
  // campaign's create-now/fire-later round trip — not just NEW's own
  // preset/from/to, but also the registered-date filter, which (unlike
  // NEW's date concept) can be set on ANY segment.
  return spec.segment === 'NEW' || spec.registeredPreset ? JSON.stringify(spec) : spec.segment
}

function resolvePresetRange(preset: RangePreset | undefined, from?: string, to?: string): Range {
  const p = preset || 'today'
  if (p === 'today') return kampalaTodayRange()
  if (p === 'week')  return kampalaWeekToDateRange()
  if (p === 'month') return kampalaMonthToDateRange()
  if (p === 'year')  return kampalaYearToDateRange()
  // custom
  const start = from ? startOfKampalaDay(new Date(from)) : startOfKampalaDay()
  const end   = to   ? endOfKampalaDay(new Date(to))     : endOfKampalaDay()
  return { start, end }
}

export function resolveRange(spec: SegmentSpec): Range {
  return resolvePresetRange(spec.preset, spec.from, spec.to)
}

// The "date added" filter — Patient.createdAt — separate from resolveRange
// above (NEW's own "first attended appointment" concept). Returns null when
// no registered-date filter was requested, so callers can tell "no filter"
// apart from "filtered to a range" without a magic sentinel range.
export function resolveRegisteredRange(spec: SegmentSpec): Range | null {
  if (!spec.registeredPreset) return null
  return resolvePresetRange(spec.registeredPreset, spec.registeredFrom, spec.registeredTo)
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

export function segmentWhere(segment: string, registeredRange?: Range | null): any {
  const where: any = { phone: { not: '' } }
  if (segment !== 'ALL') where.status = segment
  if (registeredRange) where.createdAt = { gte: registeredRange.start, lt: registeredRange.end }
  return where
}

async function patientsForSpec(spec: SegmentSpec): Promise<Array<{ id: string; phone: string }>> {
  const registeredRange = resolveRegisteredRange(spec)
  if (spec.segment === 'NEW') {
    const ids = await newPatientIdsForSpec(spec)
    if (ids.length === 0) return []
    const where: any = { id: { in: ids }, phone: { not: '' } }
    if (registeredRange) where.createdAt = { gte: registeredRange.start, lt: registeredRange.end }
    return prisma.patient.findMany({ where, select: { id: true, phone: true } })
  }
  return prisma.patient.findMany({ where: segmentWhere(spec.segment, registeredRange), select: { id: true, phone: true } })
}

// Free-text WhatsApp sends only deliver within Meta's 24h customer-service
// window (the patient messaged us in the last 24h). Outside it, Meta
// requires an APPROVED template — mirrors the exact fail-closed pattern
// already used by ai-suite/scheduler/followup.service.ts and
// crm-automation/sequence-dispatcher.ts: no env var configured = no
// template approved yet = that recipient is skipped, never sent free-form.
async function isWithinWhatsAppSessionWindow(phone: string): Promise<boolean> {
  const lastInbound = await prisma.aiMessage.findFirst({
    where: { conversation: { phoneNumber: phone }, role: 'USER' },
    orderBy: { createdAt: 'desc' },
  })
  return !!lastInbound && (Date.now() - lastInbound.createdAt.getTime()) < 24 * 60 * 60 * 1000
}

// NOTE on why this does NOT route through crm-automation/dry-run.ts's
// sendOrSimulate/CrmFeature gate: that master switch (CRM_AUTOMATION_LIVE +
// CRM_MARKETING_AUTOMATION_LIVE) is OFF in production today (verified
// 2026-09-21) — wiring campaigns through it would silently turn every real
// broadcast into a no-op dry run the moment this deploys, breaking a
// capability the clinic actively uses. Test-time safety instead comes from
// mocking sendWhatsAppMessage/sendWhatsAppTemplate directly, the same
// pattern every other test in this codebase already uses.
export async function runBroadcast(campaignId: string, targetSegmentRaw: string, message: string) {
  try {
    const spec = parseTargetSegment(targetSegmentRaw)
    const patients = await patientsForSpec(spec)

    // Duplicate-send prevention — never re-send this campaign to a patient
    // NurtureLog already has a row for (idempotent against a retry/re-fire
    // of the same campaign, e.g. runScheduledCampaigns firing twice on a
    // slow tick).
    const alreadyLogged = patients.length
      ? await prisma.nurtureLog.findMany({
          where:  { campaignId, patientId: { in: patients.map(p => p.id) } },
          select: { patientId: true },
        })
      : []
    const alreadyLoggedIds = new Set(alreadyLogged.map(l => l.patientId))
    const candidates = patients.filter(p => !alreadyLoggedIds.has(p.id))

    const templateName = process.env.WA_TEMPLATE_CAMPAIGN_BROADCAST_NAME
    const sentAt = new Date()
    let sent = 0
    const logs: Array<{ patientId: string; campaignId: string; channel: string; message: string; status: string; sentAt?: Date }> = []

    for (let i = 0; i < candidates.length; i++) {
      const patient = candidates[i]

      // Operational default-opt-in-with-fallback — the same consent
      // standard already applied to every other broad-audience send in
      // this codebase (reminders, follow-ups); see consent-log.service.ts's
      // compliance note for why the stricter hasExplicitOptIn gate is
      // deliberately reserved for the newer marketing-sequence engine
      // rather than imposed retroactively here.
      const consented = await getChannelConsentStatus(patient.id, 'WHATSAPP')
      if (!consented) {
        logs.push({ patientId: patient.id, campaignId, channel: 'WHATSAPP', message, status: 'SKIPPED_CONSENT' })
        continue
      }

      const withinWindow = await isWithinWhatsAppSessionWindow(patient.phone)
      if (!withinWindow && !templateName) {
        logs.push({ patientId: patient.id, campaignId, channel: 'WHATSAPP', message, status: 'SKIPPED_TEMPLATE_REQUIRED' })
        continue
      }

      try {
        if (withinWindow) {
          await sendWhatsAppMessage(patient.phone, message)
        } else {
          // Outside the window, only a template send is attempted — never
          // fall back to free text, which Meta would reject anyway.
          await sendWhatsAppTemplate(patient.phone, templateName!, [message], false)
        }
      } catch (sendErr: any) {
        logs.push({ patientId: patient.id, campaignId, channel: 'WHATSAPP', message, status: `FAILED: ${sendErr?.message || 'send_failed'}` })
        continue
      }

      logs.push({ patientId: patient.id, campaignId, channel: 'WHATSAPP', message, status: 'SENT', sentAt })
      sent++

      if (i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, 300))
      }
    }

    if (logs.length > 0) {
      await prisma.nurtureLog.createMany({ data: logs })
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { status: 'SENT', sentCount: sent },
    })

    console.log(`[Campaign] Broadcast ${campaignId} complete — ${sent} sent, ${logs.length - sent} skipped/failed, ${patients.length - candidates.length} already logged`)
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

// Shared by GET /segment-count and POST /whatsapp/broadcast so the preview
// count and the actual send resolve the identical registered-date filter —
// never two independently-maintained readings of the same query params.
function readRegisteredRangeParams(source: Record<string, any>): Pick<SegmentSpec, 'registeredPreset' | 'registeredFrom' | 'registeredTo'> {
  const registeredPreset = source.registeredPreset as RangePreset | undefined
  if (!registeredPreset) return {}
  return {
    registeredPreset,
    registeredFrom: source.registeredFrom as string | undefined,
    registeredTo:   source.registeredTo as string | undefined,
  }
}

function validateCustomRange(preset: RangePreset | undefined, from: unknown, to: unknown): string | null {
  if (preset !== 'custom') return null
  if (!from || !to) return 'Custom range requires from and to'
  if (Number.isNaN(new Date(from as string).getTime()) || Number.isNaN(new Date(to as string).getTime())) return 'Custom range dates are invalid'
  if (new Date(from as string) > new Date(to as string)) return 'Custom range "from" must not be after "to"'
  return null
}

// GET /campaigns/segment-count?segment=ACTIVE
// GET /campaigns/segment-count?segment=NEW&preset=week
// GET /campaigns/segment-count?segment=NEW&preset=custom&from=2026-09-01&to=2026-09-18
// GET /campaigns/segment-count?segment=ACTIVE&registeredPreset=year   (date-added filter, combinable with ANY segment)
router.get('/segment-count', requireAuth, adminAndReceptionist, async (req, res) => {
  try {
    const segment = (req.query.segment as string) || 'ALL'
    if (!BROADCAST_SEGMENTS.includes(segment)) {
      res.status(400).json({ error: 'Invalid segment' }); return
    }

    const registeredParams = readRegisteredRangeParams(req.query)
    const registeredError = validateCustomRange(registeredParams.registeredPreset, registeredParams.registeredFrom, registeredParams.registeredTo)
    if (registeredError) { res.status(400).json({ error: registeredError }); return }

    if (segment === 'NEW') {
      const newError = validateCustomRange(req.query.preset as RangePreset | undefined, req.query.from, req.query.to)
      if (newError) { res.status(400).json({ error: newError }); return }

      const spec: SegmentSpec = {
        segment: 'NEW',
        preset: (req.query.preset as RangePreset) || 'today',
        from:   req.query.from as string | undefined,
        to:     req.query.to as string | undefined,
        ...registeredParams,
      }
      const registeredRange = resolveRegisteredRange(spec)
      const ids = await newPatientIdsForSpec(spec)
      const where: any = { id: { in: ids }, phone: { not: '' } }
      if (registeredRange) where.createdAt = { gte: registeredRange.start, lt: registeredRange.end }
      const count = ids.length === 0 ? 0 : await prisma.patient.count({ where })
      res.json({ count })
      return
    }
    const registeredRange = resolveRegisteredRange({ segment, ...registeredParams })
    const count = await prisma.patient.count({ where: segmentWhere(segment, registeredRange) })
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
    const newRangeError = segment === 'NEW' ? validateCustomRange(preset, from, to) : null
    if (newRangeError) { res.status(400).json({ error: newRangeError }); return }

    const registeredParams = readRegisteredRangeParams(req.body)
    const registeredError = validateCustomRange(registeredParams.registeredPreset, registeredParams.registeredFrom, registeredParams.registeredTo)
    if (registeredError) { res.status(400).json({ error: registeredError }); return }

    const spec: SegmentSpec = {
      ...(segment === 'NEW' ? { segment: 'NEW' as const, preset: preset || 'today', from, to } : { segment }),
      ...registeredParams,
    }
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
