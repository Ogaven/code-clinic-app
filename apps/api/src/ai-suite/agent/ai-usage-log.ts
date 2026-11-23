import { randomUUID } from 'node:crypto'
import { prisma } from '../../lib/prisma'

export function agentProviderErrorCode(error: unknown): string {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'insufficient_quota'
  if (code === 'rate_limit_exceeded') return 'rate_limit_exceeded'
  return typeof status === 'number' ? `openai_http_${status}` : 'agent_request_failed'
}

// Keep usage writes off the reply path and drain outstanding writes on shutdown.
const pendingWrites = new Set<Promise<void>>()

export async function drainAiUsageLogs(timeoutMs = 1000): Promise<void> {
  if (!pendingWrites.size) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(pendingWrites),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function logAiUsage(params: {
  conversationId?: string | null
  channel:         string
  feature:         string
  model:           string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usage?:          any
  toolCallCount?:  number
  succeeded?:      boolean
  errorMessage?:   string | null
}): void {
  const { conversationId, channel, feature, model, usage, toolCallCount = 0, succeeded = true, errorMessage = null } = params
  const data = {
    id: randomUUID(),
    conversationId: conversationId ?? null,
    channel,
    feature,
    model,
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    toolCallCount,
    succeeded,
    errorMessage,
  }
  const write = (async () => {
    try {
      await prisma.aiUsageLog.create({ data })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      try {
        // The original conversation can be removed while the provider call is in flight.
        if (code === 'P2003' && data.conversationId) {
          await prisma.aiUsageLog.create({ data: { ...data, conversationId: null } })
          return
        }
        // Reuse the same ID when the first write may already have committed.
        if (code === 'P1001' || code === 'P1017' || code === 'P2024') {
          await prisma.aiUsageLog.create({ data })
          return
        }
      } catch (retryError) {
        if ((retryError as { code?: string } | null)?.code === 'P2002') return
      }
      console.error('[AiUsageLog] Failed to persist usage event', { id: data.id, code })
    }
  })()
  pendingWrites.add(write)
  void write.then(() => pendingWrites.delete(write))
}
