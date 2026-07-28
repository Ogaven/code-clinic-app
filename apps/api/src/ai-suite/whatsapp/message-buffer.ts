import { processInbound } from './whatsapp.service'

// Per-conversation message buffer that debounces rapid-fire WhatsApp texts
// into a single processInbound call. Prevents concurrent agent replies when
// a patient sends several messages in quick succession.
//
// Safe for single-instance (PM2 fork mode) — uses in-memory Map.
// If the app ever runs in cluster mode, replace with Redis-backed state.

const DEBOUNCE_MS = 1500   // wait this long after the last message
const MAX_WAIT_MS = 8000   // flush unconditionally after this long

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
