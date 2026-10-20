import { prisma } from '../../lib/prisma'
import { fetchFbUserInfo, fetchInstagramUserInfo } from '../facebook/facebook.routes'

// Automatic, low-volume historical Meta DM identity repair. No messages sent.
// Cursor advances even when Meta refuses access, preventing one inaccessible
// account from starving all other conversations. Resets after the last page.
let cursor: string | undefined
let running = false

function placeholder(name: string | null): boolean {
  if (!name) return true
  const value = name.trim()
  return !value || /^FB User(?:\s+\d+)?$/i.test(value)
    || /^Instagram User$/i.test(value)
    || /^@?(?:ig_)?\d+$/i.test(value)
}

export async function refreshMissingMetaProfiles(): Promise<void> {
  if (running) return
  running = true
  try {
    const config = await prisma.aiAgentConfig.findFirst()
    const tokens: Record<string, string | undefined> = {
      FACEBOOK: config?.facebookPageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      INSTAGRAM: config?.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN,
    }
    const rows = await prisma.aiConversation.findMany({
      where: { channel: { in: ['FACEBOOK', 'INSTAGRAM'] } },
      orderBy: { id: 'asc' },
      take: 11,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, channel: true, phoneNumber: true, displayName: true, profilePictureUrl: true },
    })
    const batch = rows.slice(0, 10)
    cursor = rows.length > 10 ? batch[batch.length - 1].id : undefined
    for (const row of batch) {
      const token = tokens[row.channel]
      if (!token || !row.phoneNumber || (!placeholder(row.displayName) && row.profilePictureUrl)) continue
      const profile = row.channel === 'FACEBOOK'
        ? await fetchFbUserInfo(row.phoneNumber, token)
        : await fetchInstagramUserInfo(row.phoneNumber, token)
      const name = profile.name?.trim() || null
      const validName = name && !placeholder(name) ? name : null
      // Conditional writes protect real names/photos against a concurrent
      // webhook update. Only identity fields may be changed.
      if (validName && placeholder(row.displayName)) {
        await prisma.aiConversation.updateMany({
          where: { id: row.id, displayName: row.displayName },
          data: { displayName: validName },
        })
      }
      if (profile.pictureUrl && !row.profilePictureUrl) {
        await prisma.aiConversation.updateMany({
          where: { id: row.id, profilePictureUrl: null },
          data: { profilePictureUrl: profile.pictureUrl },
        })
      }
    }
  } catch (error) {
    console.warn('[MetaProfileRefresh] Background refresh skipped:', error instanceof Error ? error.message : 'unknown error')
  } finally {
    running = false
  }
}
