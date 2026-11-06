import { createHash } from 'crypto'
import { prisma } from '../lib/prisma'
import { processSocialMessage, processComment, processLeadAdSubmission } from '../ai-suite/facebook/facebook.routes'

type MetaEvent = { object?: string; entry?: any[] }

export function metaEventKey(source: string, event: unknown): string {
  return createHash('sha256').update(source + ':' + JSON.stringify(event)).digest('hex')
}

export async function enqueueMetaEvent(body: MetaEvent): Promise<void> {
  if (!body || typeof body !== 'object') throw new Error('Invalid Meta webhook body')
  if (body.object !== 'page' && body.object !== 'instagram') return
  if (!Array.isArray(body.entry)) throw new Error('Invalid Meta webhook: entry must be an array')
  for (const entry of body.entry) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid Meta webhook entry')
    if (entry.messaging !== undefined && !Array.isArray(entry.messaging)) throw new Error('Invalid Meta webhook messaging')
    if (entry.changes !== undefined && !Array.isArray(entry.changes)) throw new Error('Invalid Meta webhook changes')
    for (const event of entry.messaging ?? []) {
      if (!event || typeof event !== 'object' || !event.message?.text || event.message.is_echo) continue
      const payload = { object: body.object, kind: 'message', event }
      await persist(payload)
    }
    for (const change of entry.changes ?? []) {
      if (!change || typeof change !== 'object') continue
      if (body.object === 'page' && change.field !== 'feed' && change.field !== 'leadgen') continue
      if (body.object === 'instagram' && change.field !== 'comments') continue
      const payload = { object: body.object, kind: 'change', change }
      await persist(payload)
    }
  }
}

async function persist(payload: object): Promise<void> {
  const serialized = JSON.stringify(payload)
  const eventKey = metaEventKey('meta', payload)
  await prisma.metaInboundEvent.upsert({
    where: { eventKey },
    create: { eventKey, source: 'META', payload: serialized },
    update: {},
  })
}

async function dispatch(payload: any): Promise<void> {
  const instagram = payload.object === 'instagram'
  if (payload.kind === 'message') {
    const e = payload.event
    await processSocialMessage(String(e.sender.id), String(e.message.text), instagram ? 'INSTAGRAM' : 'FACEBOOK', e.message.mid ? String(e.message.mid) : undefined)
    return
  }
  const c = payload.change
  const v = c.value
  if (!instagram && c.field === 'leadgen') {
    if (v?.leadgen_id) await processLeadAdSubmission(String(v.leadgen_id))
    return
  }
  if (instagram) {
    if (v?.text && v?.from?.id) await processComment(String(v.id ?? ''), String(v.media?.id ?? ''), String(v.from.id), String(v.from.username ?? ''), String(v.text), 'INSTAGRAM_COMMENT', v.parent_id ? String(v.parent_id) : undefined)
  } else if (v?.item === 'comment' && v?.verb === 'add' && v?.message && String(v.from?.id ?? '') !== '532091973485208') {
    await processComment(String(v.comment_id ?? ''), String(v.post_id ?? ''), String(v.from?.id ?? ''), String(v.from?.name ?? ''), String(v.message), 'FACEBOOK_COMMENT', v.parent_id ? String(v.parent_id) : undefined)
  }
}

export async function processMetaInboxBatch(): Promise<void> {
  const now = new Date()
  const pending = await prisma.metaInboundEvent.findMany({
    where: { OR: [{ status: 'PENDING', availableAt: { lte: now } }, { status: 'PROCESSING', leaseUntil: { lt: now } }] },
    orderBy: { createdAt: 'asc' }, take: 20,
  })
  for (const item of pending) {
    // A crashed worker can leave a PROCESSING lease expired indefinitely.
    // Enforce the same eight-attempt limit for lease expirations as for
    // ordinary handler failures; do not send messages on a ninth attempt.
    if (item.attempts >= 8) {
      await prisma.metaInboundEvent.updateMany({
        where: { id: item.id, status: item.status, attempts: item.attempts },
        data: { status: 'FAILED', leaseUntil: null, lastError: 'Maximum processing attempts exceeded (including expired leases)' },
      })
      continue
    }
    const leaseUntil = new Date(Date.now() + 10 * 60_000)
    const claim = await prisma.metaInboundEvent.updateMany({
      where: { id: item.id, status: item.status, attempts: item.attempts, ...(item.status === 'PROCESSING' ? { leaseUntil: { lt: new Date() } } : { availableAt: { lte: new Date() } }) },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, leaseUntil },
    })
    if (claim.count !== 1) continue
    try {
      await dispatch(JSON.parse(item.payload))
      await prisma.metaInboundEvent.updateMany({ where: { id: item.id, status: 'PROCESSING', attempts: item.attempts + 1 }, data: { status: 'COMPLETED', processedAt: new Date(), leaseUntil: null, lastError: null } })
    } catch (error) {
      const attempts = item.attempts + 1
      await prisma.metaInboundEvent.updateMany({
        where: { id: item.id, status: 'PROCESSING', attempts: item.attempts + 1 },
        data: { status: attempts >= 8 ? 'FAILED' : 'PENDING', leaseUntil: null, availableAt: new Date(Date.now() + Math.min(3600, 2 ** attempts * 10) * 1000), lastError: String(error).slice(0, 1000) },
      })
    }
  }
}
