import { prisma } from '../../lib/prisma'
import { fetchFbUserInfo, fetchInstagramUserInfo } from '../facebook/facebook.routes'

// Automatic, low-volume historical Meta DM identity repair. No messages sent.
// Cursor advances even when Meta refuses access, preventing one inaccessible
// account from starving all other conversations. Resets after the last page.
let cursor: string | undefined
let running = false

// Historical synthetic identifiers (fb_*, ig_*, verify_*) are not proven
// platform-scoped user IDs. Never send them to Meta or mutate them in storage.
// Only attempt Graph lookups for numeric sender IDs received from webhooks.
function lookupEligible(id: string | null): boolean {
  return typeof id === 'string' && /^\\d+$/.test(id)
}

function placeholder(name: string | null): boolean {
  if (!name) return true
  const value = name.trim()
  return !value || /^FB User(?:\s+\d+)?$/i.test(value)
    || /^Instagram User$/i.test(value)
    || /^@?(?:ig_)?\d+$/i.test(value)
}

// Validate only the configured Instagram token before historical lookups. Meta
// error 190 means the saved token is unusable; the environment token is then
// considered as a fallback. No credentials or account identifiers are logged.
async function instagramProfileToken(configured?: string | null, fallback?: string): Promise<string | undefined> {
  const primary = configured?.trim()
  const secondary = fallback?.trim()
  if (!primary) return secondary
  if (!secondary || primary === secondary) return primary

  try {
    const url = new URL('https://graph.facebook.com/v23.0/me')
    url.searchParams.set('fields', 'id')
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${primary}` },
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) return primary
    const data = await response.json() as { error?: { code?: number } }
    if (data.error?.code === 190 || response.status === 401) {
      console.warn('[MetaProfileRefresh] Saved Instagram token rejected; using environment fallback')
      return secondary
    }
    // Do not bypass a token for transient failures or unrelated permission errors.
    return primary
  } catch {
    return primary
  }
}

export async function refreshMissingMetaProfiles(): Promise<void> {
  if (running) return
  running = true
  try {
    const config = await prisma.aiAgentConfig.findFirst()
    const tokens: Record<string, string | undefined> = {
      FACEBOOK: config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      INSTAGRAM: await instagramProfileToken(config?.instagramAccessToken, process.env.INSTAGRAM_ACCESS_TOKEN),
    }
    const rows = await prisma.aiConversation.findMany({
      where: { channel: { in: ['FACEBOOK', 'INSTAGRAM'] }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 11,
      select: { id: true, channel: true, phoneNumber: true, displayName: true, profilePictureUrl: true },
    })
    const batch = rows.slice(0, 10)
    cursor = rows.length > 10 ? batch[batch.length - 1].id : undefined
    const stats = { scanned: batch.length, attempted: 0, namesUpdated: 0, photosUpdated: 0, missingToken: 0, skippedNonPlatformId: 0, unavailable: 0 }
    for (const row of batch) {
      const token = tokens[row.channel]
      if (!token) { stats.missingToken++; continue }
      if (!row.phoneNumber || (!placeholder(row.displayName) && row.profilePictureUrl)) continue
      if (!lookupEligible(row.phoneNumber)) { stats.skippedNonPlatformId++; continue }
      stats.attempted++
      const profile = row.channel === 'FACEBOOK'
        ? await fetchFbUserInfo(row.phoneNumber, token)
        : await fetchInstagramUserInfo(row.phoneNumber, token)
      if (!profile.name && !profile.pictureUrl) stats.unavailable++
      const name = profile.name?.trim() || null
      const validName = name && !placeholder(name) ? name : null
      // Conditional writes protect real names/photos against a concurrent
      // webhook update. Only identity fields may be changed.
      if (validName && placeholder(row.displayName)) {
        const updated = await prisma.aiConversation.updateMany({
          where: { id: row.id, displayName: row.displayName },
          data: { displayName: validName },
        })
        stats.namesUpdated += updated.count
      }
      if (profile.pictureUrl && !row.profilePictureUrl) {
        const updated = await prisma.aiConversation.updateMany({
          where: { id: row.id, profilePictureUrl: null },
          data: { profilePictureUrl: profile.pictureUrl },
        })
        stats.photosUpdated += updated.count
      }
    }
    console.info('[MetaProfileRefresh] Batch summary', stats)
  } catch (error) {
    console.warn('[MetaProfileRefresh] Background refresh skipped:', error instanceof Error ? error.message : 'unknown error')
  } finally {
    running = false
  }
}
