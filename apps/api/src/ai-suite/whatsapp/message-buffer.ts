import { processInbound } from './whatsapp.service'
import { prisma } from '../../lib/prisma'

// Per-conversation message buffer that debounces rapid-fire WhatsApp texts
// into a single processInbound call. Prevents concurrent agent replies when
// a patient sends several messages in quick succession.
//
// Wamid dedup uses a two-layer strategy:
//   1. In-memory Map  — fast, synchronous, zero DB overhead (catches same-process duplicates)
//   2. DB table       — persists across PM2 restarts (catches post-restart dual-webhook duplicates)
// The same wamid can arrive via both the Africa's Talking webhook AND the WhatsApp
// Cloud API webhook. If PM2 restarts between the two deliveries the memory layer is
// cleared; the DB layer catches it regardless.

const DEBOUNCE_MS  = 1500
const MAX_WAIT_MS  = 8000
const WAMID_TTL_MS = 120_000   // 2 minutes — covers any plausible AT → restart → Cloud API gap

// ── Layer 1: in-memory fast path ──────────────────────────────────────────────
const seenWamids = new Map<string, number>()  // wamid → expiry timestamp

function isWamidSeenMemory(wamid: string): boolean {
  if (!wamid) return false
  const exp = seenWamids.get(wamid)
  if (exp === undefined) return false
  if (Date.now() > exp) { seenWamids.delete(wamid); return false }
  return true
}

function markWamidSeenMemory(wamid: string): void {
  if (!wamid) return
  seenWamids.set(wamid, Date.now() + WAMID_TTL_MS)
  if (seenWamids.size > 500) {
    const now = Date.now()
    for (const [k, exp] of seenWamids) { if (now > exp) seenWamids.delete(k) }
  }
}

// ── Layer 2: DB persistence (restart-safe) ────────────────────────────────────
let _cleanupCounter = 0

async function isWamidSeenDb(wamid: string): Promise<boolean> {
  if (!wamid) return false
  try {
    const row = await prisma.processedWamid.findFirst({
      where: { wamid, processedAt: { gte: new Date(Date.now() - WAMID_TTL_MS) } },
    })
    return row !== null
  } catch {
    return false  // DB failure must never block message processing
  }
}

async function markWamidSeenDb(wamid: string): Promise<void> {
  if (!wamid) return
  try {
    await prisma.processedWamid.upsert({ where: { wamid }, create: { wamid }, update: {} })
    // Periodic cleanup so the table stays tiny
    if (++_cleanupCounter % 50 === 0) {
      prisma.processedWamid
        .deleteMany({ where: { processedAt: { lt: new Date(Date.now() - WAMID_TTL_MS) } } })
        .catch(() => {})
    }
  } catch {
    // Non-fatal — in-memory layer still protects within this process lifetime
  }
}

// ── Message buffer ─────────────────────────────────────────────────────────────
interface BufferEntry {
  messages:       Array<{ text: string; wamid: string }>
  phoneNumberId?: string
  debounceTimer:  ReturnType<typeof setTimeout>
  maxTimer:       ReturnType<typeof setTimeout>
}

const buffer = new Map<string, BufferEntry>()

function flush(from: string): void {
  const entry = buffer.get(from)
  if (!entry) return

  clearTimeout(entry.debounceTimer)
  clearTimeout(entry.maxTimer)
  buffer.delete(from)

  if (!entry.messages.length) return

  const combined  = entry.messages.map(m => m.text).join('\n')
  const lastWamid = entry.messages[entry.messages.length - 1].wamid

  if (entry.messages.length > 1) {
    console.log(
      `[MessageBuffer] Batching ${entry.messages.length} msgs from ${from}: "${combined.slice(0, 120)}"`
    )
  }

  processInbound(from, combined, lastWamid, entry.phoneNumberId).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[MessageBuffer] processInbound error for ${from}:`, msg)
  })
}

function _doBuffer(from: string, text: string, wamid: string, phoneNumberId?: string): void {
  const existing = buffer.get(from)
  if (existing) {
    clearTimeout(existing.debounceTimer)
    existing.messages.push({ text, wamid })
    existing.debounceTimer = setTimeout(() => flush(from), DEBOUNCE_MS)
  } else {
    const debounceTimer = setTimeout(() => flush(from), DEBOUNCE_MS)
    const maxTimer      = setTimeout(() => flush(from), MAX_WAIT_MS)
    buffer.set(from, { messages: [{ text, wamid }], phoneNumberId, debounceTimer, maxTimer })
  }
}

async function _checkDbThenBuffer(from: string, text: string, wamid: string, phoneNumberId?: string): Promise<void> {
  if (await isWamidSeenDb(wamid)) {
    console.log(`[MessageBuffer] Duplicate wamid ...${wamid.slice(-16)} from ${from} — skipping (dedup:db, post-restart)`)
    return
  }
  void markWamidSeenDb(wamid)
  _doBuffer(from, text, wamid, phoneNumberId)
}

export function enqueueMessage(from: string, text: string, wamid: string, phoneNumberId?: string): void {
  // Layer 1 — sync memory check (covers same-process dual-webhook arrivals)
  if (isWamidSeenMemory(wamid)) {
    console.log(`[MessageBuffer] Duplicate wamid ...${wamid.slice(-16)} from ${from} — skipping (dedup:memory)`)
    return
  }
  // Mark memory immediately (JS is single-threaded — no race between two sync checks)
  markWamidSeenMemory(wamid)

  // Layer 2 — async DB check (covers post-restart arrivals); caller signature stays void
  void _checkDbThenBuffer(from, text, wamid, phoneNumberId)
}
