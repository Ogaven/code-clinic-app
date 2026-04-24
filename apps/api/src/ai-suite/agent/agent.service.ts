// Agent service stub — will be replaced with full Anthropic Claude integration
// Requires ANTHROPIC_API_KEY in environment

export async function getAgentReply(message: string, from: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.warn('[Agent] ANTHROPIC_API_KEY not set — running in stub mode')
  }

  console.log(`[Agent] Received message from ${from}: "${message}"`)
  console.log('[Agent] ANTHROPIC_API_KEY present:', !!apiKey)

  // TODO: Replace with actual Claude call
  return 'Sarah is thinking...'
}
