// Global test guard: blocks any real network call to a patient-communication
// or LLM provider during the test run. Individual tests must mock `fetch`,
// the OpenAI client, or the relevant service function themselves — this guard
// only exists to fail loudly if a test forgets to and a call would otherwise
// escape to a real provider (WhatsApp/Meta, OpenAI, Africa's Talking, SMTP).
//
// This is deliberately a blunt global patch, not a per-test opt-in: the whole
// point is that no test should be ABLE to reach these hosts, mocked or not.

// Any module that imports lib/env.ts eagerly validates and process.exit(1)s
// if these are missing — provide inert test values so importing agent.service
// (or anything downstream of it) doesn't kill the whole test worker before a
// test even gets to mock its dependencies. Never real credentials.
process.env.DATABASE_URL       ??= 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET         ??= 'test-jwt-secret-not-real-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-not-real-'.padEnd(32, '0')
process.env.NODE_ENV           ??= 'test'

const BLOCKED_HOST_PATTERNS = [
  /api\.openai\.com/,
  /graph\.facebook\.com/,
  /graph\.instagram\.com/,
  /api\.africastalking\.com/,
  /whatsapp/i,
]

const realFetch = global.fetch

function isBlockedUrl(input: unknown): boolean {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as { url?: string })?.url ?? ''
  return BLOCKED_HOST_PATTERNS.some(p => p.test(url))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.fetch = ((input: any, init?: any) => {
  if (isBlockedUrl(input)) {
    throw new Error(
      `[no-real-sends guard] Test attempted a real network call to a blocked provider host: ${String(input)}. ` +
      `Mock fetch or the relevant service function instead of calling this host in a test.`
    )
  }
  return realFetch(input, init)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any
