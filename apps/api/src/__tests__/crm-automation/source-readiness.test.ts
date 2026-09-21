import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { aiAgentConfig: { findFirst: vi.fn() } },
}))
vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }))

import { sourceReadiness } from '../../crm-automation/source-readiness.service'

const ENV_KEYS = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN', 'SCOREAPP_WEBHOOK_SECRET']
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.aiAgentConfig.findFirst.mockResolvedValue(null)
  savedEnv = {}
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('sourceReadiness — never claims CONNECTED without real configuration evidence', () => {
  it('reports NOT_CONNECTED for every credential-backed source when nothing is configured', async () => {
    const result = await sourceReadiness()
    expect(result.find(r => r.key === 'WHATSAPP')!.status).toBe('NOT_CONNECTED')
    expect(result.find(r => r.key === 'FACEBOOK')!.status).toBe('NOT_CONNECTED')
    expect(result.find(r => r.key === 'INSTAGRAM')!.status).toBe('NOT_CONNECTED')
    expect(result.find(r => r.key === 'SCOREAPP')!.status).toBe('NOT_CONNECTED')
    expect(result.find(r => r.key === 'FACEBOOK_LEAD_ADS')!.status).toBe('NOT_CONNECTED')
  })

  it('self-hosted sources (Website, Quiz, Walk-in, Other) are always CONNECTED — no external dependency', async () => {
    const result = await sourceReadiness()
    for (const key of ['WEBSITE', 'QUIZ', 'WALKIN', 'OTHER']) {
      expect(result.find(r => r.key === key)!.status).toBe('CONNECTED')
    }
  })

  it('WhatsApp is CONNECTED only when BOTH required credentials are present', async () => {
    process.env.WHATSAPP_TOKEN = 'x'
    let result = await sourceReadiness()
    expect(result.find(r => r.key === 'WHATSAPP')!.status).toBe('NOT_CONNECTED')

    process.env.WHATSAPP_PHONE_NUMBER_ID = 'y'
    result = await sourceReadiness()
    expect(result.find(r => r.key === 'WHATSAPP')!.status).toBe('CONNECTED')
  })

  it('ScoreApp is SETUP_REQUIRED (never CONNECTED) even with a secret configured — matches its fail-closed webhook, unverified registration', async () => {
    process.env.SCOREAPP_WEBHOOK_SECRET = 'shh'
    const result = await sourceReadiness()
    expect(result.find(r => r.key === 'SCOREAPP')!.status).toBe('SETUP_REQUIRED')
  })

  it('Facebook Lead Ads is SETUP_REQUIRED (never CONNECTED) even with a page token — subscription/permission can only be verified by a live Meta call, out of scope here', async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'token'
    const result = await sourceReadiness()
    expect(result.find(r => r.key === 'FACEBOOK_LEAD_ADS')!.status).toBe('SETUP_REQUIRED')
  })

  it('reads the Facebook token from the DB config as a real alternative to the env var', async () => {
    prismaMock.aiAgentConfig.findFirst.mockResolvedValue({ facebookPageAccessToken: 'db-token' } as any)
    const result = await sourceReadiness()
    expect(result.find(r => r.key === 'FACEBOOK')!.status).toBe('CONNECTED')
  })

  it('never returns a secret/token value anywhere in the response', async () => {
    process.env.WHATSAPP_TOKEN = 'super-secret-value'
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'another-secret'
    const result = await sourceReadiness()
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('another-secret')
  })
})
