import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { isPushConfigured } from '../services/push.service'

const router = Router()

// GET /push/vapid-public-key — the browser needs this to call pushManager.subscribe()
router.get('/vapid-public-key', requireAuth, async (_req, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: 'Push notifications are not configured on this server' })
    return
  }
  res.json({ publicKey: env.VAPID_PUBLIC_KEY })
})

// POST /push/subscribe — store (or refresh) a browser's push subscription for the signed-in user
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'endpoint and keys.p256dh/keys.auth are required' })
      return
    }
    const userId = req.user!.id
    await prisma.pushSubscription.upsert({
      where:  { endpoint },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] || null },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] || null },
    })
    res.json({ ok: true })
  } catch (e: any) {
    console.error('[Push] subscribe error:', e.message)
    res.status(500).json({ error: 'Failed to save push subscription' })
  }
})

// DELETE /push/subscribe — remove a subscription (e.g. user disables notifications)
router.delete('/subscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body as { endpoint?: string }
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint is required' })
      return
    }
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } })
    res.json({ ok: true })
  } catch (e: any) {
    console.error('[Push] unsubscribe error:', e.message)
    res.status(500).json({ error: 'Failed to remove push subscription' })
  }
})

export default router
