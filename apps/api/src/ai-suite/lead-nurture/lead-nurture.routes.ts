import { Router } from 'express'
import { triggerLeadNurture, scheduleFollowUpSequence } from './lead-nurture.service'

const router = Router()

// POST /ai-suite/lead-nurture/trigger
// Called by quiz/scorecard forms when a visitor submits their results.
// Body: { phone, name, quizTopic, score? }

router.post('/trigger', async (req, res) => {
  try {
    const { phone, name, quizTopic, score } = req.body as {
      phone:      string
      name:       string
      quizTopic:  string
      score?:     string
    }

    if (!phone || !name || !quizTopic) {
      return res.status(400).json({ error: 'phone, name, and quizTopic are required' })
    }

    await triggerLeadNurture(phone, name, quizTopic, score)
    await scheduleFollowUpSequence(phone, name, quizTopic)

    res.json({ success: true, message: `Lead nurture sequence started for ${name}` })
  } catch (err: any) {
    console.error('[LeadNurture] trigger error:', err.message)
    res.status(500).json({ error: 'Failed to trigger lead nurture sequence' })
  }
})

export default router
