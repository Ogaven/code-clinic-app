import { prisma } from '../../lib/prisma'

export function agentProviderErrorCode(error: unknown): string {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return 'insufficient_quota'
  if (code === 'rate_limit_exceeded') return 'rate_limit_exceeded'
  return typeof status === 'number' ? `openai_http_${status}` : 'agent_request_failed'
}

// ── Fire-and-forget OpenAI token-usage audit log ──────────────────────────────
// Mirrors the logOutboundMessage pattern in whatsapp.service.ts: runs as an
// unawaited async IIFE with its own internal try/catch, so a DB hiccup (or,
// in tests, an unmocked prisma.aiUsageLog) can never surface as a rejection
// on the caller's await chain or get swallowed by an outer catch as if the
// OpenAI call itself had failed.
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
  ;(async () => {
    try {
      const { conversationId, channel, feature, model, usage, toolCallCount = 0, succeeded = true, errorMessage = null } = params
      await prisma.aiUsageLog.create({
        data: {
          conversationId:    conversationId ?? null,
          channel,
          feature,
          model,
          inputTokens:       usage?.input_tokens ?? 0,
          cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          outputTokens:      usage?.output_tokens ?? 0,
          reasoningTokens:   usage?.output_tokens_details?.reasoning_tokens ?? 0,
          totalTokens:       usage?.total_tokens ?? 0,
          toolCallCount,
          succeeded,
          errorMessage,
        },
      })
    } catch (e: any) {
      console.error('[AiUsageLog] Failed to write usage log:', e?.message)
    }
  })()
}

