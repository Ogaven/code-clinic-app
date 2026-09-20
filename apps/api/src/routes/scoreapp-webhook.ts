import { Router } from 'express'
import { normalizePhone } from '../utils/phone'
import { findOrCreateLeadForChannel } from '../crm-automation/lead-intake.service'
import { prisma } from '../lib/prisma'

const router = Router()

// ─────────────────────────────────────────────────────────────────────────
// ScoreApp (getscoreapp.com) webhook receiver — the THIRD-PARTY quiz/scoring
// tool, distinct from this codebase's own in-house Quiz Funnels feature
// (routes/quiz-funnels.ts, Quiz model). As of the 2026-09-16 lead-engine
// audit, Code Clinic has zero live integration with the real ScoreApp
// product: no SCOREAPP_WEBHOOK_SECRET was configured, no webhook URL had
// ever been registered on their ScoreApp account, and the `quizzes` table
// (the unrelated in-house feature) had never had a single row created.
//
// This receiver is built so the plumbing exists the moment the business
// registers this URL in ScoreApp's dashboard — but two things are true and
// must stay true:
//   1. Fails closed without SCOREAPP_WEBHOOK_SECRET configured (same
//      "credential presence != feature live" principle as SMS_CHANNEL_ACTIVE
//      in ai-suite/sms/sms.service.ts and CRM_MISSED_CALL_TEXTBACK_LIVE in
//      crm-automation/dry-run.ts) — an unconfigured secret must never mean
//      "accept anything," it must mean "accept nothing."
//   2. The exact payload shape below is ScoreApp's DOCUMENTED default
//      webhook contact fields (contact.email/phone/first_name/last_name,
//      result.title/score) as of this writing, but ScoreApp lets an account
//      owner customize which fields a given quiz's webhook actually sends.
//      VERIFY the real payload (log one real submission) against the field
//      lookups below once the business connects a live ScoreApp quiz to
//      this URL — do not assume this mapping is correct for their specific
//      quiz configuration without checking.
// ─────────────────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  return !!process.env.SCOREAPP_WEBHOOK_SECRET
}

function verifySecret(req: any): boolean {
  const provided = req.get('x-scoreapp-secret') || req.query.secret
  return isConfigured() && provided === process.env.SCOREAPP_WEBHOOK_SECRET
}

// Best-effort extraction across the handful of shapes ScoreApp's webhook
// payload customization commonly produces. Never throws — a field that
// isn't present just comes back null, and name/phone/email are all
// independently optional to findOrCreateLeadForChannel's caller here.
function pick(body: any, paths: string[]): string | null {
  for (const path of paths) {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), body)
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return null
}

router.post('/', async (req, res) => {
  if (!isConfigured()) {
    console.warn('[ScoreApp] Webhook received but SCOREAPP_WEBHOOK_SECRET is not configured — rejecting (fail closed)')
    res.status(501).json({ error: 'ScoreApp integration not configured' })
    return
  }
  if (!verifySecret(req)) {
    res.status(403).json({ error: 'Invalid or missing webhook secret' })
    return
  }

  res.sendStatus(200) // acknowledge immediately; ScoreApp retries on non-2xx

  try {
    const body = req.body as any

    const rawPhone = pick(body, ['contact.phone', 'contact.phone_number', 'phone', 'phone_number'])
    const email     = pick(body, ['contact.email', 'email'])
    const firstName = pick(body, ['contact.first_name', 'first_name'])
    const lastName  = pick(body, ['contact.last_name', 'last_name'])
    const fullName  = pick(body, ['contact.name', 'name']) || [firstName, lastName].filter(Boolean).join(' ') || null
    const resultTitle = pick(body, ['result.title', 'result.band', 'result_title'])
    const scoreRaw     = pick(body, ['result.score', 'score'])
    const quizName      = pick(body, ['quiz.name', 'quiz_name', 'funnel_name'])
    // Best-effort — ScoreApp's actual submission-id field is unverified (see
    // file header); when present it becomes the idempotency key below, when
    // absent this degrades gracefully to the existing phone/email dedup only.
    const submissionId = pick(body, ['submission_id', 'response_id', 'id', 'submission.id'])

    if (!rawPhone && !email) {
      console.warn('[ScoreApp] Submission has no phone or email — cannot create a lead. Raw keys:', Object.keys(body || {}))
      return
    }

    if (submissionId) {
      const alreadyProcessed = await prisma.lead.findFirst({ where: { source: 'SCOREAPP', externalSubmissionId: submissionId } })
      if (alreadyProcessed) {
        console.log(`[ScoreApp] submission_id=${submissionId} already processed (lead ${alreadyProcessed.id}) — skipping duplicate webhook delivery`)
        return
      }
    }

    const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null
    const score = scoreRaw != null ? Number(scoreRaw) : null

    await findOrCreateLeadForChannel({
      where: normalizedPhone
        ? { phone: normalizedPhone, status: { notIn: ['CONVERTED', 'LOST'] } }
        : { email: email!, status: { notIn: ['CONVERTED', 'LOST'] } },
      createData: {
        name:        fullName,
        phone:       normalizedPhone,
        email:       email || null,
        source:      'SCOREAPP',
        status:      'NEW',
        stage:       'NEW',
        score:       Number.isFinite(score) ? Math.round(score as number) : 0,
        notes:       `ScoreApp submission${quizName ? `: ${quizName}` : ''}${resultTitle ? ` — Result: ${resultTitle}` : ''}`,
        provider:             'SCOREAPP',
        formId:               quizName,
        externalSubmissionId: submissionId,
      },
      onExistingMessage: `Retook ScoreApp quiz${quizName ? `: ${quizName}` : ''}${resultTitle ? ` — Result: ${resultTitle}` : ''}`,
      intakeOptions: { skipAcknowledgement: true }, // no verified real-time channel to acknowledge on yet
      contactEvidence: normalizedPhone ? { channel: 'WHATSAPP', source: 'QUIZ' } : undefined,
    })
  } catch (e: any) {
    console.error('[ScoreApp] Webhook processing error:', e?.message)
  }
})

export default router
