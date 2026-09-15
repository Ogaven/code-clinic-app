// ─────────────────────────────────────────────────────────────────────────
// Real WhatsApp delivery health, Meta billing status, and CRM configuration
// readiness — new surfaces for AI Suite → Analytics & Costs, added during
// the 2026-09-15 investigation into Meta error 131042. All admin/staff-
// facing only (this whole page requires login); nothing here is exposed to
// patients.
// ─────────────────────────────────────────────────────────────────────────
import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { adminOnly } from '../../middleware/rbac'
import { getWhatsAppDeliveryHealth, getCrmReadinessSummary } from '../../services/provider-health.service'
import { getMetaBillingStatus } from '../../services/meta-billing.service'

const router = Router()

// GET /ai-suite/whatsapp-health — real delivery counts/rates, not billing.
// Raw provider error codes/messages are diagnostic detail for Admin only —
// Receptionist still gets the real status/counts, just not the technical
// error payload, whether they view the page or call this endpoint directly.
router.get('/whatsapp-health', requireAuth, async (req, res) => {
  try {
    const health = await getWhatsAppDeliveryHealth()
    if (req.user?.role !== 'ADMIN') {
      const { latestError, failureCountByCode, ...rest } = health
      return res.json(rest)
    }
    res.json(health)
  } catch (err: any) {
    console.error('[WhatsAppHealth]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /ai-suite/meta-billing — financial/account data, admin-only like /ai-usage.
router.get('/meta-billing', requireAuth, adminOnly, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true'
    res.json(await getMetaBillingStatus(forceRefresh))
  } catch (err: any) {
    console.error('[MetaBilling]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /ai-suite/crm-readiness — routing/sequence/backlog configuration counts.
router.get('/crm-readiness', requireAuth, adminOnly, async (_req, res) => {
  try {
    res.json(await getCrmReadinessSummary())
  } catch (err: any) {
    console.error('[CrmReadiness]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
