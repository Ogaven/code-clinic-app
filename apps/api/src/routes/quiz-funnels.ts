import { Router } from 'express'
import QRCode from 'qrcode'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { prisma } from '../lib/prisma'
import { normalizePhone } from '../utils/phone'
import { env } from '../lib/env'
import { sendWhatsAppMessage } from '../ai-suite/whatsapp/whatsapp.service'

const router = Router()

// ── Shapes stored as JSON strings in Quiz.questions / Quiz.resultText ────────
// QuizQuestion:   { id, text, options: [{ id, text, score }] }
// QuizResultTier: { id, minScore, maxScore, title, message, cta, ctaLink? }

function parseQuiz(q: any) {
  return {
    ...q,
    questions:   safeParse(q.questions, []),
    resultTiers: safeParse(q.resultText, []),
  }
}
function safeParse(s: string, fallback: any) {
  try { return JSON.parse(s) } catch { return fallback }
}

// ── Staff CRUD ────────────────────────────────────────────────────────────

// GET /quiz-funnels — list, any authenticated staff
router.get('/', requireAuth, async (_req, res) => {
  try {
    const quizzes = await prisma.quiz.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(quizzes.map(q => {
      const parsed = parseQuiz(q)
      return { ...q, questionCount: parsed.questions.length, questions: undefined, resultText: undefined }
    }))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quizzes' })
  }
})

// GET /quiz-funnels/:id — full detail for the builder, any authenticated staff
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } })
    if (!quiz) { res.status(404).json({ error: 'Quiz not found' }); return }
    res.json(parseQuiz(quiz))
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz' })
  }
})

// POST /quiz-funnels — create, admin only. Starts unpublished until staff finish building it.
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { title, description } = req.body
  if (!title || !String(title).trim()) { res.status(400).json({ error: 'Title is required' }); return }
  try {
    const quiz = await prisma.quiz.create({
      data: {
        title:       String(title).trim(),
        description: description || null,
        questions:   JSON.stringify([]),
        resultText:  JSON.stringify([]),
        isActive:    false,
      },
    })
    res.status(201).json(parseQuiz(quiz))
  } catch (e) {
    res.status(500).json({ error: 'Failed to create quiz' })
  }
})

// PUT /quiz-funnels/:id — full update (title, description, questions, resultTiers, isActive), admin only
router.put('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { title, description, questions, resultTiers, isActive } = req.body
  try {
    const data: any = {}
    if (title       !== undefined) data.title       = String(title).trim()
    if (description  !== undefined) data.description = description || null
    if (questions    !== undefined) data.questions   = JSON.stringify(questions)
    if (resultTiers  !== undefined) data.resultText  = JSON.stringify(resultTiers)
    if (isActive     !== undefined) data.isActive    = !!isActive
    const quiz = await prisma.quiz.update({ where: { id: req.params.id }, data })
    res.json(parseQuiz(quiz))
  } catch (e) {
    res.status(500).json({ error: 'Failed to update quiz' })
  }
})

// PATCH /quiz-funnels/:id/publish — lightweight publish/unpublish toggle, admin only
router.patch('/:id/publish', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { isActive } = req.body
  if (typeof isActive !== 'boolean') { res.status(400).json({ error: 'isActive (boolean) is required' }); return }
  try {
    const quiz = await prisma.quiz.update({ where: { id: req.params.id }, data: { isActive } })
    res.json(parseQuiz(quiz))
  } catch (e) {
    res.status(500).json({ error: 'Failed to update publish status' })
  }
})

// DELETE /quiz-funnels/:id — admin only
router.delete('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.quiz.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete quiz' })
  }
})

// GET /quiz-funnels/:id/qr — staff-only QR code for the public quiz link
router.get('/:id/qr', requireAuth, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!quiz) { res.status(404).json({ error: 'Quiz not found' }); return }
    const webUrl  = env.APP_URL.split(',')[0].trim()
    const quizUrl = `${webUrl}/quiz/${quiz.id}`
    const qrDataUrl = await QRCode.toDataURL(quizUrl, { width: 480, margin: 2 })
    res.json({ url: quizUrl, qrDataUrl })
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR code' })
  }
})

// ── Public, unauthenticated ──────────────────────────────────────────────

// GET /quiz-funnels/:id/public — fetch a PUBLISHED quiz for the public quiz-taking page.
// Strips answer point values -- the client only ever sees question/option text.
router.get('/:id/public', async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } })
    if (!quiz || !quiz.isActive) { res.status(404).json({ error: 'Quiz not found' }); return }
    const questions = safeParse(quiz.questions, [])
    res.json({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      questions: questions.map((q: any) => ({
        id: q.id,
        text: q.text,
        options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text })),
      })),
    })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quiz' })
  }
})

// POST /quiz-funnels/:id/submit — public. Scores server-side (never trusts a
// client-submitted score), creates a real Lead tagged with the quiz + tier.
router.post('/:id/submit', async (req, res) => {
  const { answers, name, phone, email } = req.body
  if (!Array.isArray(answers) || answers.length === 0) { res.status(400).json({ error: 'answers required' }); return }
  if (!name || !phone) { res.status(400).json({ error: 'Name and phone are required' }); return }

  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } })
    if (!quiz || !quiz.isActive) { res.status(404).json({ error: 'Quiz not found' }); return }

    const questions   = safeParse(quiz.questions, [])
    const resultTiers = safeParse(quiz.resultText, [])

    // Recompute score from the stored quiz definition -- a client-submitted
    // score field, if present, is ignored entirely.
    const resolvedAnswers: { questionId: string; optionId: string; score: number }[] = []
    let score = 0
    for (const a of answers) {
      const q = questions.find((x: any) => x.id === a.questionId)
      const opt = q?.options?.find((o: any) => o.id === a.optionId)
      const optScore = Number(opt?.score) || 0
      score += optScore
      resolvedAnswers.push({ questionId: a.questionId, optionId: a.optionId, score: optScore })
    }

    const tier = resultTiers.find((t: any) => score >= t.minScore && score <= t.maxScore)
      || resultTiers[resultTiers.length - 1]
      || null

    const normalizedPhone = normalizePhone(String(phone))

    const lead = await prisma.lead.create({
      data: {
        name:        String(name).trim(),
        phone:       normalizedPhone,
        email:       email || null,
        source:      'QUIZ',
        status:      'NEW',
        stage:       'NEW',
        score,
        quizId:      quiz.id,
        quizAnswers: JSON.stringify(resolvedAnswers),
        notes:       `Quiz: ${quiz.title}${tier ? ` — Result: ${tier.title}` : ''}`,
      },
    })

    res.json({
      leadId: lead.id,
      score,
      tier: tier ? { title: tier.title, message: tier.message, cta: tier.cta, ctaLink: tier.ctaLink || null } : null,
    })

    // Warm WhatsApp message, same fire-and-forget pattern as manual lead creation
    if (normalizedPhone) {
      const firstName = String(name).trim().split(' ')[0] || 'there'
      const warmMsg = `Hi ${firstName}! 😊 Thanks for taking the "${quiz.title}" quiz with Code Clinic. ${tier?.cta ? tier.cta + ' — just reply here and we\'ll help you book it in.' : 'One of our team will be in touch shortly.'}`
      sendWhatsAppMessage(normalizedPhone, warmMsg).catch((e: any) =>
        console.error('[QuizFunnels] Warm message failed:', e?.message)
      )
    }
  } catch (e: any) {
    console.error('[QuizFunnels] Submit error:', e.message)
    res.status(500).json({ error: 'Failed to submit quiz' })
  }
})

export default router
