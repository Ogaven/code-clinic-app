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
  return typeof id === 'string' && /^\d+$/.test(id)
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

// Meta's Page conversation participants edge can expose names when the direct
// PSID profile edge returns 100/33. Only exact numeric participant IDs are
// eligible for a match; never infer identity from ordering or email.
async function facebookParticipantNames(token: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const pageId = '532091973485208'
  const firstUrl = new URL(`https://graph.facebook.com/v23.0/${pageId}/conversations`)
  firstUrl.searchParams.set('fields', 'participants.limit(2){id,name}')
  firstUrl.searchParams.set('limit', '100')
  // Bounded pagination ensures older conversations can be considered without
  // allowing an unbounded API crawl during the periodic background worker.
  let next: string | undefined = firstUrl.toString()
  let pages = 0
  try {
    while (next && pages < 5) {
      const url = new URL(next)
      // Never follow a pagination link to an unrelated host.
      if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') break
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) {
        console.warn('[MetaProfileRefresh] Facebook participant lookup rejected', { status: response.status, page: pages + 1 })
        break
      }
      const payload = await response.json() as {
        data?: Array<{ participants?: { data?: Array<{ id?: string; name?: string }> } }>
        paging?: { next?: string }
      }
      pages++
      for (const conversation of payload.data ?? []) {
        for (const participant of conversation.participants?.data ?? []) {
          if (!participant.id || !/^\d+$/.test(participant.id) || participant.id === pageId) continue
          const name = participant.name?.trim()
          if (name && !placeholder(name)) names.set(participant.id, name)
        }
      }
      next = payload.paging?.next
    }
    console.info('[MetaProfileRefresh] Facebook participant index', { pages, identities: names.size, hasMore: Boolean(next) })
  } catch {
    console.warn('[MetaProfileRefresh] Facebook participant lookup unavailable', { pages })
  }
  return names
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
    const fbNames = tokens.FACEBOOK && batch.some(row => row.channel === 'FACEBOOK' && placeholder(row.displayName))
      ? await facebookParticipantNames(tokens.FACEBOOK)
      : new Map<string, string>()
    let facebookNameMatches = 0
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
      const name = (row.channel === 'FACEBOOK' ? fbNames.get(row.phoneNumber) : null) || profile.name?.trim() || null
      const validName = name && !placeholder(name) ? name : null
      if (row.channel === 'FACEBOOK' && row.phoneNumber && fbNames.has(row.phoneNumber)) facebookNameMatches++
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
    console.info('[MetaProfileRefresh] Batch summary', { ...stats, facebookNameMatches })
  } catch (error) {
    console.warn('[MetaProfileRefresh] Background refresh skipped:', error instanceof Error ? error.message : 'unknown error')
  } finally {
    running = false
  }
}
