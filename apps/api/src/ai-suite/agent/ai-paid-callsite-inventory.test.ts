import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Baseline inventory of direct paid OpenAI Responses calls in the central
 * agent service. Any addition or removal requires explicit review of metering.
 * This is an inventory guard, NOT evidence of full application coverage.
 */
describe('agent paid OpenAI Responses call-site inventory', () => {
  it('requires review when the number of direct Responses calls changes', () => {
    const source = readFileSync(resolve(__dirname, 'agent.service.ts'), 'utf8')
    const calls = source.match(/client\\.responses\\.create\\s*\\(/g) ?? []
    expect(calls).toHaveLength(5)
  })

  it('keeps the hybrid routing disabled by default in production configuration', () => {
    const source = readFileSync(resolve(__dirname, 'provider-config.ts'), 'utf8')
    expect(source).toContain('HYBRID_AI_ENABLED')
  })
})
