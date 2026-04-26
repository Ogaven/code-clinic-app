import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../../middleware/auth'

const router = Router()
const prisma = new PrismaClient()

async function getConfig() {
  let c = await prisma.aiAgentConfig.findFirst()
  if (!c) c = await prisma.aiAgentConfig.create({ data: { name: 'Sarah', personality: 'warm and friendly' } })
  return c
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
router.get('/connections/whatsapp', requireAuth, async (_req, res) => {
  const config = await getConfig()
  const phoneId = config.waPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null
  const token   = config.waAccessToken  || process.env.WHATSAPP_TOKEN           || null
  res.json({
    connected:     !!(phoneId && token),
    phoneNumberId: phoneId ? phoneId.slice(0, 6) + '…' : null,
    verifyToken:   process.env.WHATSAPP_VERIFY_TOKEN || 'codeclinic-whatsapp-2026',
  })
})

router.patch('/connections/whatsapp', requireAuth, async (req, res) => {
  const { phoneNumberId, accessToken } = req.body
  if (!phoneNumberId || !accessToken) {
    return res.status(400).json({ error: 'phoneNumberId and accessToken required' })
  }
  const config  = await getConfig()
  const updated = await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { waPhoneNumberId: phoneNumberId, waAccessToken: accessToken },
  })
  res.json({ connected: true, phoneNumberId: updated.waPhoneNumberId?.slice(0, 6) + '…' })
})

// ── Facebook OAuth ─────────────────────────────────────────────────────────────
router.get('/connections/facebook/oauth', requireAuth, (_req, res) => {
  const appId      = process.env.FACEBOOK_APP_ID
  const apiBase    = process.env.API_URL || 'https://api-production-4c43.up.railway.app'
  const callbackUrl = encodeURIComponent(`${apiBase}/ai-suite/connections/facebook/callback`)
  if (!appId) return res.status(503).json({ error: 'FACEBOOK_APP_ID not configured' })
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${callbackUrl}&scope=pages_messaging,pages_read_engagement,pages_manage_metadata&response_type=code`
  res.redirect(oauthUrl)
})

router.get('/connections/facebook/callback', async (req, res) => {
  const { code } = req.query as { code?: string }
  if (!code) return res.status(400).send('Missing code')
  try {
    const appId     = process.env.FACEBOOK_APP_ID || ''
    const appSecret = process.env.FACEBOOK_APP_SECRET || ''
    const apiBase   = process.env.API_URL || 'https://api-production-4c43.up.railway.app'
    const callback  = encodeURIComponent(`${apiBase}/ai-suite/connections/facebook/callback`)

    const tokenRes  = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${callback}&client_secret=${appSecret}&code=${code}`)
    const tokenData = await tokenRes.json() as { access_token?: string; error?: any }
    if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData.error))

    // Get page list
    const pagesRes  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${tokenData.access_token}`)
    const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> }
    const page      = pagesData.data?.[0]

    const config = await getConfig()
    await prisma.aiAgentConfig.update({
      where: { id: config.id },
      data: {
        facebookPageAccessToken: page?.access_token || tokenData.access_token,
        facebookPageName:        page?.name || 'Connected',
      },
    })
    res.send('<script>window.close()</script><p>Facebook connected! You can close this window.</p>')
  } catch (err: any) {
    res.status(500).send(`Error: ${err.message}`)
  }
})

router.get('/connections/facebook/status', requireAuth, async (_req, res) => {
  const config = await getConfig()
  res.json({
    connected: !!config.facebookPageAccessToken,
    pageName:  config.facebookPageName || null,
  })
})

router.delete('/connections/facebook', requireAuth, async (_req, res) => {
  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { facebookPageAccessToken: null, facebookPageName: null },
  })
  res.json({ connected: false })
})

// ── Instagram OAuth ────────────────────────────────────────────────────────────
router.get('/connections/instagram/oauth', requireAuth, (_req, res) => {
  const appId     = process.env.FACEBOOK_APP_ID
  const apiBase   = process.env.API_URL || 'https://api-production-4c43.up.railway.app'
  const callback  = encodeURIComponent(`${apiBase}/ai-suite/connections/instagram/callback`)
  if (!appId) return res.status(503).json({ error: 'FACEBOOK_APP_ID not configured' })
  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${callback}&scope=instagram_basic,instagram_manage_messages,pages_show_list&response_type=code`
  res.redirect(oauthUrl)
})

router.get('/connections/instagram/callback', async (req, res) => {
  const { code } = req.query as { code?: string }
  if (!code) return res.status(400).send('Missing code')
  try {
    const appId     = process.env.FACEBOOK_APP_ID || ''
    const appSecret = process.env.FACEBOOK_APP_SECRET || ''
    const apiBase   = process.env.API_URL || 'https://api-production-4c43.up.railway.app'
    const callback  = encodeURIComponent(`${apiBase}/ai-suite/connections/instagram/callback`)

    const tokenRes  = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${callback}&client_secret=${appSecret}&code=${code}`)
    const tokenData = await tokenRes.json() as { access_token?: string }
    if (!tokenData.access_token) throw new Error('No access token returned')

    // Get Instagram account
    const igRes  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${tokenData.access_token}`)
    const igData = await igRes.json() as { data?: Array<{ instagram_business_account?: { id: string }; name: string; access_token: string }> }
    const page   = igData.data?.[0]
    let igName   = page?.name || 'Connected'
    if (page?.instagram_business_account) {
      const igInfoRes  = await fetch(`https://graph.facebook.com/v19.0/${page.instagram_business_account.id}?fields=username&access_token=${page.access_token}`)
      const igInfoData = await igInfoRes.json() as { username?: string }
      if (igInfoData.username) igName = '@' + igInfoData.username
    }

    const config = await getConfig()
    await prisma.aiAgentConfig.update({
      where: { id: config.id },
      data: { instagramAccessToken: page?.access_token || tokenData.access_token, instagramAccountName: igName },
    })
    res.send('<script>window.close()</script><p>Instagram connected! You can close this window.</p>')
  } catch (err: any) {
    res.status(500).send(`Error: ${err.message}`)
  }
})

router.get('/connections/instagram/status', requireAuth, async (_req, res) => {
  const config = await getConfig()
  res.json({ connected: !!config.instagramAccessToken, accountName: config.instagramAccountName || null })
})

router.delete('/connections/instagram', requireAuth, async (_req, res) => {
  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { instagramAccessToken: null, instagramAccountName: null },
  })
  res.json({ connected: false })
})

// ── SMS ────────────────────────────────────────────────────────────────────────
router.get('/connections/sms', requireAuth, async (_req, res) => {
  const config = await getConfig()
  const apiKey = config.smsApiKey || process.env.AT_API_KEY || null
  res.json({
    connected:  !!(apiKey && apiKey !== 'your-key'),
    username:   config.smsUsername || process.env.AT_USERNAME || null,
    senderId:   config.smsSenderId || process.env.AT_FROM     || null,
  })
})

router.patch('/connections/sms', requireAuth, async (req, res) => {
  const { apiKey, username, senderId } = req.body
  const config  = await getConfig()
  const updated = await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: {
      ...(apiKey    !== undefined && { smsApiKey:   apiKey   }),
      ...(username  !== undefined && { smsUsername: username }),
      ...(senderId  !== undefined && { smsSenderId: senderId }),
    },
  })
  res.json({ connected: !!(updated.smsApiKey && updated.smsApiKey !== 'your-key') })
})

// ── SIP Trunks ─────────────────────────────────────────────────────────────────
router.get('/connections/sip-trunks', requireAuth, async (_req, res) => {
  const trunks = await prisma.sipTrunk.findMany({ orderBy: { createdAt: 'asc' } })
  res.json(trunks)
})

router.post('/connections/sip-trunks', requireAuth, async (req, res) => {
  const {
    name, host, port = 5060, netmask = 32, protocol = 'UDP',
    allowInbound = true, allowOutbound = true, optionsPing = false,
    username, password, useSipRegistration = false,
    leadingPlus = false, techPrefix, sipDiversionHeader,
  } = req.body
  if (!name || !host) return res.status(400).json({ error: 'name and host required' })
  const trunk = await prisma.sipTrunk.create({
    data: { name, host, port, netmask, protocol, allowInbound, allowOutbound, optionsPing, username, password, useSipRegistration, leadingPlus, techPrefix, sipDiversionHeader },
  })
  res.status(201).json(trunk)
})

router.patch('/connections/sip-trunks/:id', requireAuth, async (req, res) => {
  const trunk = await prisma.sipTrunk.update({ where: { id: req.params.id }, data: req.body })
  res.json(trunk)
})

router.delete('/connections/sip-trunks/:id', requireAuth, async (req, res) => {
  await prisma.sipTrunk.delete({ where: { id: req.params.id } })
  res.json({ deleted: true })
})

export default router
