import { processInbound } from './whatsapp.service'

// Per-conversation message buffer that debounces rapid-fire WhatsApp texts
// into a single processInbound call. Prevents concurrent agent replies when
// a patient sends several messages in quick succession.
//
// Also provides wamid-level idempotency: the same Meta wamid can arrive via
// BOTH the Africa's Talking webhook AND the WhatsApp Cloud API webhook for
// the same number. Deduplicating on wamid prevents double agent replies.
//
// Safe for single-instance (PM2 fork mode) — uses in-memory Maps.
// If the app ever runs in cluster mode, replace with Redis-backed state.

const DEBOUNCE_MS  = 1500    // wait this long after the last message
const MAX_WAIT_MS  = 8000    // flush unconditionally after this long
const WAMID_TTL_MS = 60_000  // ignore duplicate wamids within this window

// ── Wamid dedup cache ─────────────────────────────────────────────────────────
const seenWamids = new Map<string, number>() // wamid → expiry timestamp

function isWamidSeen(wamid: string): boolean {
  if (!wamid) return false
  const exp = seenWamids.get(wamid)
  if (exp === undefined) return false
  if (Date.now() > exp) { seenWamids.delete(wamid); return false }
  return true
}

function markWamidSeen(wamid: string): void {
  if (!wamid) return
  seenWamids.set(wamid, Date.now() + WAMID_TTL_MS)
  // Periodically prune expired entries so the Map doesn't grow unboundedly
  if (seenWamids.size > 500) {
    const now = Date.now()
    for (const [k, exp] of seenWamids) { if (now > exp) seenWamids.delete(k) }
  }
}

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

export function enqueueMessage(from: string, text: string, wamid: string, phoneNumberId?: string): void {
  // Deduplicate: same wamid arriving from both AT and Cloud API webhooks must only process once
  if (isWamidSeen(wamid)) {
    console.log(`[MessageBuffer] Duplicate wamid ...${wamid.slice(-16)} from ${from} — skipping (dual-webhook dedup)`)
    return
  }
  markWamidSeen(wamid)

  const existing = buffer.get(from)

  if (existing) {
    // Reset debounce window; max-wait timer stays unchanged
    clearTimeout(existing.debounceTimer)
    existing.messages.push({ text, wamid })
    existing.debounceTimer = setTimeout(() => flush(from), DEBOUNCE_MS)
  } else {
    const debounceTimer = setTimeout(() => flush(from), DEBOUNCE_MS)
    const maxTimer      = setTimeout(() => flush(from), MAX_WAIT_MS)
    buffer.set(from, { messages: [{ text, wamid }], phoneNumberId, debounceTimer, maxTimer })
  }
}
