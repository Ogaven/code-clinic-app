import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'

const prisma = new PrismaClient()

const router = Router()

// ── Leads ────────────────────────────────────────────────────────

router.get('/leads', requireAuth, async (_req: Request, res: Response) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
    })
    res.json(leads)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leads' })
  }
})

router.post('/leads', requireAuth, async (req: Request, res: Response) => {
  const { name, phone, email, source, notes } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })
  try {
    const lead = await prisma.lead.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        source: source || 'WALK_IN',
        stage: 'NEW',
        score: 0,
        notes: notes || null,
      },
    })
    res.status(201).json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create lead' })
  }
})

router.get('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    res.json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch lead' })
  }
})

router.patch('/leads/:id', requireAuth, async (req: Request, res: Response) => {
  const { stage, score, notes, name, phone, email } = req.body
  try {
    const data: any = {}
    if (stage !== undefined) data.stage = stage
    if (score !== undefined) data.score = score
    if (notes !== undefined) data.notes = notes
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone
    if (email !== undefined) data.email = email

    const lead = await prisma.lead.update({ where: { id: req.params.id }, data })
    res.json(lead)
  } catch (e) {
    res.status(500).json({ error: 'Failed to update lead' })
  }
})

router.delete('/leads/:id', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete lead' })
  }
})

// ── Quizzes ──────────────────────────────────────────────────────

router.get('/quizzes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const quizzes = await prisma.quiz.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(quizzes)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch quizzes' })
  }
})

router.post('/quizzes', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { title, questions, resultText } = req.body
  if (!title) return res.status(400).json({ error: 'Title is required' })
  try {
    const quiz = await prisma.quiz.create({
      data: { title, questions: questions || [], resultText: resultText || {} },
    })
    res.status(201).json(quiz)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create quiz' })
  }
})

router.post('/quizzes/:id/submit', async (req: Request, res: Response) => {
  const { answers, name, phone, email } = req.body
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } })
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' })

    const score = Array.isArray(answers) ? answers.reduce((s: number, a: any) => s + (a.score || 0), 0) : 0

    // Create lead from quiz submission
    const lead = await prisma.lead.create({
      data: {
        name: name || 'Quiz Submission',
        phone: phone || null,
        email: email || null,
        source: 'QUIZ',
        stage: 'NEW',
        score,
        notes: `Quiz: ${quiz.title}`,
      },
    })

    // Find result text based on score
    const resultText = quiz.resultText as Record<string, string>
    const resultKeys = Object.keys(resultText).map(Number).sort((a, b) => b - a)
    const matchedKey = resultKeys.find(k => score >= k)
    const result = matchedKey !== undefined ? resultText[String(matchedKey)] : 'Thank you for completing the quiz!'

    res.json({ lead, score, result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit quiz' })
  }
})

// ── QR Captures ──────────────────────────────────────────────────

router.get('/qr', requireAuth, async (_req: Request, res: Response) => {
  try {
    const captures = await prisma.qRCapture.findMany({ orderBy: { createdAt: 'desc' } })
    res.json(captures)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch QR captures' })
  }
})

router.post('/qr', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { name, formConfig, destination } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })
  try {
    const capture = await prisma.qRCapture.create({
      data: {
        name,
        formConfig: formConfig || {},
        destination: destination || 'CRM',
        scanCount: 0,
      },
    })
    res.status(201).json(capture)
  } catch (e) {
    res.status(500).json({ error: 'Failed to create QR capture' })
  }
})

// ── Website Visitors ──────────────────────────────────────────────

router.get('/visitors', requireAuth, async (req: Request, res: Response) => {
  try {
    const visitors = await prisma.websiteVisitor.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json(visitors)
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch visitors' })
  }
})

export default router
