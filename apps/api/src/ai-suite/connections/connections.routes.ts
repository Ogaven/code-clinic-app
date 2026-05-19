import { Router } from 'express'
import { randomBytes } from 'crypto'
import { requireAuth } from '../../middleware/auth'
import { prisma } from '../../lib/prisma'

const router = Router()

async function getConfig() {
  let c = await prisma.aiAgentConfig.findFirst()
  if (!c) c = await prisma.aiAgentConfig.create({ data: { name: 'Sarah', personality: 'warm and friendly' } })
  return c
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
router.get('/connections/whatsapp', requireAuth, async (_req, res) => {
  const config  = await getConfig()
  const phoneId = config.waPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null
  const token   = config.waAccessToken   || process.env.WHATSAPP_TOKEN           || null
  // A phone number (starts with +) means a "pending setup" request, not a live connection
  const isPending = phoneId ? phoneId.startsWith('+') : false
  res.json({
    connected:  !!(phoneId && token && !isPending),
    pending:    isPending,
    phone:      isPending ? phoneId : null,
    phoneNumberId: (!isPending && phoneId) ? phoneId.slice(0, 6) + '…' : null,
  })
})

// Simplified form: clinic staff enters just their phone number, dev handles the rest
router.patch('/connections/whatsapp/simple', requireAuth, async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'phone required' })
  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { waPhoneNumberId: phone, waAccessToken: '__pending__' },
  })
  res.json({ pending: true, phone })
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

// Step 1: frontend calls this (with auth headers) to get a short-lived state token.
// Avoids putting the user's JWT in a popup URL where it may be expired or stale.
router.get('/connections/facebook/generate-state', requireAuth, async (_req, res) => {
  const state  = randomBytes(24).toString('hex')
  const expiry = Date.now() + 15 * 60 * 1000 // 15 minutes
  const value  = JSON.stringify({ state, expiry })
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, "updatedAt")
    VALUES ('fb_oauth_state', ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
  `
  res.json({ state })
})

// Step 2: popup opens this URL with ?state=<token>. Validates state from DB, then
// redirects to Facebook. No JWT needed here — state token proves auth from step 1.
router.get('/connections/facebook/oauth', async (req, res) => {
  const { state } = req.query as { state?: string }
  if (!state) return res.status(400).send('Missing OAuth state. Please close this window and try again.')

  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM app_settings WHERE key = 'fb_oauth_state' LIMIT 1
    `
    if (!rows.length) return res.status(401).send('OAuth session not found. Please close this window and try again.')
    const stored = JSON.parse(rows[0].value) as { state: string; expiry: number }
    if (stored.state !== state || Date.now() > stored.expiry) {
      return res.status(401).send('OAuth session expired or invalid. Please close this window and try again.')
    }
    // Single-use — delete after validating
    await prisma.$executeRaw`DELETE FROM app_settings WHERE key = 'fb_oauth_state'`
  } catch {
    return res.status(500).send('Server error validating OAuth session. Please try again.')
  }

  const appId       = process.env.FACEBOOK_APP_ID
  const apiBase     = process.env.API_URL || 'https://api.codeclinicemr.com'
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
    const apiBase   = process.env.API_URL || 'https://api.codeclinicemr.com'
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

// Manual token connection — for admins who already have a Page Access Token
router.post('/connections/facebook/manual', requireAuth, async (req, res) => {
  const { pageAccessToken, pageId } = req.body as { pageAccessToken?: string; pageId?: string }
  if (!pageAccessToken) return res.status(400).json({ error: 'pageAccessToken required' })

  // Try to resolve the page name from the Graph API; fall back to pageId or 'Connected'
  let pageName = pageId || 'Connected'
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${pageAccessToken}`)
    const d = await r.json() as { name?: string }
    if (d.name) pageName = d.name
  } catch {}

  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { facebookPageAccessToken: pageAccessToken, facebookPageName: pageName },
  })
  res.json({ connected: true, pageName })
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

router.get('/connections/instagram/generate-state', requireAuth, async (_req, res) => {
  const state  = randomBytes(24).toString('hex')
  const expiry = Date.now() + 15 * 60 * 1000
  const value  = JSON.stringify({ state, expiry })
  await prisma.$executeRaw`
    INSERT INTO app_settings (key, value, "updatedAt")
    VALUES ('ig_oauth_state', ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()
  `
  res.json({ state })
})

router.get('/connections/instagram/oauth', async (req, res) => {
  const { state } = req.query as { state?: string }
  if (!state) return res.status(400).send('Missing OAuth state. Please close this window and try again.')

  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM app_settings WHERE key = 'ig_oauth_state' LIMIT 1
    `
    if (!rows.length) return res.status(401).send('OAuth session not found. Please close this window and try again.')
    const stored = JSON.parse(rows[0].value) as { state: string; expiry: number }
    if (stored.state !== state || Date.now() > stored.expiry) {
      return res.status(401).send('OAuth session expired or invalid. Please close this window and try again.')
    }
    await prisma.$executeRaw`DELETE FROM app_settings WHERE key = 'ig_oauth_state'`
  } catch {
    return res.status(500).send('Server error validating OAuth session. Please try again.')
  }

  const appId    = process.env.FACEBOOK_APP_ID
  const apiBase  = process.env.API_URL || 'https://api.codeclinicemr.com'
  const callback = encodeURIComponent(`${apiBase}/ai-suite/connections/instagram/callback`)
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
    const apiBase   = process.env.API_URL || 'https://api.codeclinicemr.com'
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

// Manual token connection — for admins who already have an Instagram Access Token
router.post('/connections/instagram/manual', requireAuth, async (req, res) => {
  const { accessToken, instagramAccountId } = req.body as { accessToken?: string; instagramAccountId?: string }
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' })

  // Try to resolve the Instagram username; fall back to accountId or 'Connected'
  let accountName = instagramAccountId || 'Connected'
  try {
    const id = instagramAccountId
    if (id) {
      const r = await fetch(`https://graph.facebook.com/v19.0/${id}?fields=username&access_token=${accessToken}`)
      const d = await r.json() as { username?: string }
      if (d.username) accountName = '@' + d.username
    }
  } catch {}

  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { instagramAccessToken: accessToken, instagramAccountName: accountName },
  })
  res.json({ connected: true, accountName })
})

router.delete('/connections/instagram', requireAuth, async (_req, res) => {
  const config = await getConfig()
  await prisma.aiAgentConfig.update({
    where: { id: config.id },
    data: { instagramAccessToken: null, instagramAccountName: null },
  })
  res.json({ connected: false })
})

// ── WhatsApp — numbers / register / verify / insights / profile ───────────────

function waCredentials(config: any) {
  return {
    token:   config.waAccessToken   || process.env.WHATSAPP_TOKEN           || null,
    phoneId: config.waPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  }
}

function tierToLimit(tier?: string): number {
  switch (tier) {
    case 'TIER_10K':       return 10000
    case 'TIER_100K':      return 100000
    case 'TIER_UNLIMITED': return -1
    default:               return 1000
  }
}

router.get('/connections/whatsapp/numbers', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig()
    const { token, phoneId } = waCredentials(config)
    if (!phoneId || !token || phoneId.startsWith('+') || token === '__pending__') {
      return res.json([])
    }
    const wabaId = process.env.WHATSAPP_WABA_ID
    if (wabaId) {
      try {
        const r    = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=display_phone_number,status,verified_name,quality_rating&access_token=${token}`)
        const data = await r.json() as any
        if (data.data?.length) {
          return res.json(data.data.map((n: any) => ({
            id:            n.id,
            phoneNumber:   n.display_phone_number || phoneId,
            name:          n.verified_name || 'Code Clinic',
            status:        n.status === 'CONNECTED' ? 'Connected' : (n.status || 'Connected'),
            qualityRating: n.quality_rating || 'GREEN',
            country:       (n.display_phone_number || '').startsWith('+256') ? 'Uganda' : 'Unknown',
          })))
        }
      } catch (e: any) { console.warn('[WA] numbers Meta error:', e.message) }
    }
    const displayPhone = process.env.WHATSAPP_PHONE_NUMBER || phoneId
    res.json([{
      id: phoneId, phoneNumber: displayPhone, name: 'Code Clinic',
      status: 'Connected', qualityRating: 'GREEN',
      country: displayPhone.startsWith('+256') ? 'Uganda' : 'Unknown',
    }])
  } catch (e: any) { console.error('[WA] numbers error:', e.message); res.json([]) }
})

router.post('/connections/whatsapp/register', requireAuth, async (req, res) => {
  const { displayName, phoneNumber } = req.body as { displayName?: string; phoneNumber?: string }
  if (!displayName || !phoneNumber) {
    return res.status(400).json({ error: 'displayName and phoneNumber are required' })
  }
  const wabaId = process.env.WHATSAPP_WABA_ID
  const token  = process.env.WHATSAPP_TOKEN || (await getConfig()).waAccessToken
  if (!wabaId || !token || token === '__pending__') {
    return res.status(503).json({ error: 'WHATSAPP_WABA_ID and WHATSAPP_TOKEN must be configured' })
  }
  const cleaned = phoneNumber.replace(/\D/g, '')
  const cc      = cleaned.startsWith('0') ? '256' : cleaned.slice(0, 3)
  const number  = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned.slice(3)
  try {
    const addRes  = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cc, phone_number: number, migrate_phone_number: false, verified_name: displayName, code_verification_method: 'SMS', language: 'en_US' }),
    })
    const addData = await addRes.json() as any
    if (addData.error) throw new Error(addData.error.message || JSON.stringify(addData.error))
    const phoneNumberId = addData.id as string
    await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/request_code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code_method: 'SMS', language: 'en_US' }),
    })
    res.json({ phoneNumberId, success: true })
  } catch (e: any) {
    console.error('[WA] register error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.post('/connections/whatsapp/verify', requireAuth, async (req, res) => {
  const { phoneNumberId, otp } = req.body as { phoneNumberId?: string; otp?: string }
  if (!phoneNumberId || !otp) return res.status(400).json({ error: 'phoneNumberId and otp required' })
  const token = process.env.WHATSAPP_TOKEN || (await getConfig()).waAccessToken
  if (!token || token === '__pending__') return res.status(503).json({ error: 'WHATSAPP_TOKEN not configured' })
  try {
    const r    = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/verify_code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: otp }),
    })
    const data = await r.json() as any
    if (data.error) throw new Error(data.error.message)
    const config = await getConfig()
    await prisma.aiAgentConfig.update({ where: { id: config.id }, data: { waPhoneNumberId: phoneNumberId } })
    res.json({ success: true })
  } catch (e: any) {
    console.error('[WA] verify error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

router.get('/connections/whatsapp/insights', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig()
    const { token, phoneId } = waCredentials(config)
    if (!phoneId || !token || phoneId.startsWith('+') || token === '__pending__') {
      return res.json({ tier: 'TIER_1K', messagingLimit: 1000, qualityRating: 'GREEN' })
    }
    const r    = await fetch(`https://graph.facebook.com/v19.0/${phoneId}?fields=messaging_limit_tier,quality_rating&access_token=${token}`)
    const data = await r.json() as any
    if (data.error) throw new Error(data.error.message)
    res.json({ tier: data.messaging_limit_tier || 'TIER_1K', messagingLimit: tierToLimit(data.messaging_limit_tier), qualityRating: data.quality_rating || 'GREEN' })
  } catch { res.json({ tier: 'TIER_1K', messagingLimit: 1000, qualityRating: 'GREEN' }) }
})

router.get('/connections/whatsapp/profile', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig()
    const { token, phoneId } = waCredentials(config)
    if (phoneId && token && !phoneId.startsWith('+') && token !== '__pending__') {
      try {
        const r    = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/whatsapp_business_profile?fields=address,description,email,profile_picture_url,websites,vertical&access_token=${token}`)
        const data = await r.json() as any
        if (data.data?.[0]) {
          const p = data.data[0]
          const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'wa_profile' LIMIT 1`
          const local = rows.length ? JSON.parse(rows[0].value) : {}
          return res.json({ displayName: config.name || 'Code Clinic', category: p.vertical || local.category || 'MEDICAL_AND_HEALTH', description: p.description || local.description || '', address: p.address || local.address || '', email: p.email || local.email || '', website: p.websites?.[0] || local.website || '', imageUrl: p.profile_picture_url || local.imageUrl || null })
        }
      } catch (e: any) { console.warn('[WA] profile Meta error:', e.message) }
    }
    const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'wa_profile' LIMIT 1`
    const p = rows.length ? JSON.parse(rows[0].value) : {}
    res.json({ displayName: config.name || 'Code Clinic', category: p.category || 'MEDICAL_AND_HEALTH', description: p.description || '', address: p.address || '', email: p.email || '', website: p.website || '', imageUrl: p.imageUrl || null })
  } catch { res.json({ displayName: 'Code Clinic', category: 'MEDICAL_AND_HEALTH', description: '', address: '', email: '', website: '', imageUrl: null }) }
})

router.patch('/connections/whatsapp/profile', requireAuth, async (req, res) => {
  const { category, description, address, email, website } = req.body
  const rows    = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'wa_profile' LIMIT 1`
  const existing = rows.length ? JSON.parse(rows[0].value) : {}
  const profile  = { ...existing, category, description, address, email, website }
  const value    = JSON.stringify(profile)
  await prisma.$executeRaw`INSERT INTO app_settings (key, value, "updatedAt") VALUES ('wa_profile', ${value}, NOW()) ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()`
  try {
    const config = await getConfig()
    const { token, phoneId } = waCredentials(config)
    if (phoneId && token && !phoneId.startsWith('+') && token !== '__pending__') {
      const body: any = { messaging_product: 'whatsapp' }
      if (category)    body.vertical    = category
      if (description) body.description = description
      if (address)     body.address     = address
      if (email)       body.email       = email
      if (website)     body.websites    = [website]
      const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/whatsapp_business_profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      })
      const d = await r.json() as any
      if (d.error) console.warn('[WA] profile update Meta error:', d.error.message)
    }
  } catch (e: any) { console.warn('[WA] profile update error:', e.message) }
  res.json({ success: true, ...profile })
})

router.post('/connections/whatsapp/profile/image', requireAuth, async (req, res) => {
  const { imageBase64 } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' })
  const rows    = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM app_settings WHERE key = 'wa_profile' LIMIT 1`
  const existing = rows.length ? JSON.parse(rows[0].value) : {}
  const profile  = { ...existing, imageUrl: imageBase64 }
  const value    = JSON.stringify(profile)
  await prisma.$executeRaw`INSERT INTO app_settings (key, value, "updatedAt") VALUES ('wa_profile', ${value}, NOW()) ON CONFLICT (key) DO UPDATE SET value = ${value}, "updatedAt" = NOW()`
  res.json({ success: true, imageUrl: imageBase64 })
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
