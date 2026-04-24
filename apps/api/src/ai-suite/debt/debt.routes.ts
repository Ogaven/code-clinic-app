import { Router } from 'express'
import { triggerDebtOutreach } from './debt-outreach.service'

const router = Router()

// POST /ai-suite/debt/trigger
// Body: { patientId, balanceAmount, currency? }
// Called by the accounts module when a patient has an outstanding balance.

router.post('/trigger', async (req, res) => {
  try {
    const { patientId, balanceAmount, currency } = req.body as {
      patientId:     string
      balanceAmount: number
      currency?:     string
    }

    if (!patientId || balanceAmount === undefined) {
      return res.status(400).json({ error: 'patientId and balanceAmount are required' })
    }

    await triggerDebtOutreach(patientId, Number(balanceAmount), currency)
    res.json({ success: true })
  } catch (err: any) {
    console.error('[DebtOutreach] trigger error:', err.message)
    res.status(500).json({ error: err.message || 'Failed to trigger debt outreach' })
  }
})

export default router
