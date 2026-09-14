import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { isCrmFeatureLive, isCrmAutomationLive, crmFeatureStatus, sendOrSimulate } from '../../crm-automation/dry-run'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function clearAllFlags() {
  delete process.env.CRM_AUTOMATION_LIVE
  delete process.env.CRM_OPERATIONAL_AUTOMATION_LIVE
  delete process.env.CRM_MARKETING_AUTOMATION_LIVE
  delete process.env.CRM_BACKLOG_REENGAGEMENT_LIVE
  delete process.env.CRM_WAITLIST_AUTOMATION_LIVE
  delete process.env.CRM_REVIEW_REQUEST_AUTOMATION_LIVE
}

beforeEach(() => {
  clearAllFlags()
  // dry-run.ts deliberately forces every feature OFF whenever NODE_ENV==='test'
  // (so real application tests can never fire a real send). Exercising the
  // actual live-mode branches here requires stepping outside that guard on
  // purpose — restored immediately in afterEach every time.
  process.env.NODE_ENV = 'production'
})

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  clearAllFlags()
})

describe('isCrmFeatureLive — master kill switch (retained for defense in depth)', () => {
  it('every feature is dry-run when the master flag is off, even if the feature flag itself is on', () => {
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
  })

  it('a feature stays dry-run when the master is on but its own flag is off', () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
  })

  it('a feature is live only when BOTH the master and its own flag are on', () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(true)
  })

  it('NODE_ENV=test forces every feature off regardless of any flag', () => {
    process.env.NODE_ENV = 'test'
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
  })

  it('isCrmAutomationLive() reports only the master switch state', () => {
    expect(isCrmAutomationLive()).toBe(false)
    process.env.CRM_AUTOMATION_LIVE = 'true'
    expect(isCrmAutomationLive()).toBe(true)
  })
})

describe('isCrmFeatureLive — per-feature independence (one feature enabled never enables the others)', () => {
  beforeEach(() => { process.env.CRM_AUTOMATION_LIVE = 'true' })

  it('OPERATIONAL=true does not enable MARKETING/BACKLOG/WAITLIST/REVIEW_REQUEST', () => {
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(true)
    expect(isCrmFeatureLive('MARKETING')).toBe(false)
    expect(isCrmFeatureLive('BACKLOG')).toBe(false)
    expect(isCrmFeatureLive('WAITLIST')).toBe(false)
    expect(isCrmFeatureLive('REVIEW_REQUEST')).toBe(false)
  })

  it('MARKETING=true does not enable OPERATIONAL/BACKLOG/WAITLIST/REVIEW_REQUEST', () => {
    process.env.CRM_MARKETING_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('MARKETING')).toBe(true)
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
    expect(isCrmFeatureLive('BACKLOG')).toBe(false)
    expect(isCrmFeatureLive('WAITLIST')).toBe(false)
    expect(isCrmFeatureLive('REVIEW_REQUEST')).toBe(false)
  })

  it('BACKLOG=true does not enable any other feature', () => {
    process.env.CRM_BACKLOG_REENGAGEMENT_LIVE = 'true'
    expect(isCrmFeatureLive('BACKLOG')).toBe(true)
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
    expect(isCrmFeatureLive('MARKETING')).toBe(false)
    expect(isCrmFeatureLive('WAITLIST')).toBe(false)
    expect(isCrmFeatureLive('REVIEW_REQUEST')).toBe(false)
  })

  it('WAITLIST=true does not enable any other feature', () => {
    process.env.CRM_WAITLIST_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('WAITLIST')).toBe(true)
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
    expect(isCrmFeatureLive('MARKETING')).toBe(false)
    expect(isCrmFeatureLive('BACKLOG')).toBe(false)
    expect(isCrmFeatureLive('REVIEW_REQUEST')).toBe(false)
  })

  it('REVIEW_REQUEST=true does not enable any other feature', () => {
    process.env.CRM_REVIEW_REQUEST_AUTOMATION_LIVE = 'true'
    expect(isCrmFeatureLive('REVIEW_REQUEST')).toBe(true)
    expect(isCrmFeatureLive('OPERATIONAL')).toBe(false)
    expect(isCrmFeatureLive('MARKETING')).toBe(false)
    expect(isCrmFeatureLive('BACKLOG')).toBe(false)
    expect(isCrmFeatureLive('WAITLIST')).toBe(false)
  })
})

describe('crmFeatureStatus() — Admin visibility snapshot', () => {
  it('reports all six features off by default', () => {
    expect(crmFeatureStatus()).toEqual({
      OPERATIONAL: false, MARKETING: false, BACKLOG: false, WAITLIST: false, REVIEW_REQUEST: false, MISSED_CALL_TEXTBACK: false,
    })
  })

  it('reports exactly which features are live, matching the production recommendation (operational only)', () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true'
    expect(crmFeatureStatus()).toEqual({
      OPERATIONAL: true, MARKETING: false, BACKLOG: false, WAITLIST: false, REVIEW_REQUEST: false, MISSED_CALL_TEXTBACK: false,
    })
  })
})

describe('sendOrSimulate — never calls the real provider unless its OWN feature is live', () => {
  it('dry-runs when the feature is off', async () => {
    const realSend = vi.fn().mockResolvedValue(undefined)
    const result = await sendOrSimulate('OPERATIONAL', 'WHATSAPP', '+256700000000', 'hi', realSend)
    expect(realSend).not.toHaveBeenCalled()
    expect(result.dryRun).toBe(true)
  })

  it('calls the real provider only when its own feature is live', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_WAITLIST_AUTOMATION_LIVE = 'true'
    const realSend = vi.fn().mockResolvedValue(undefined)
    const result = await sendOrSimulate('WAITLIST', 'WHATSAPP', '+256700000000', 'hi', realSend)
    expect(realSend).toHaveBeenCalledTimes(1)
    expect(result.dryRun).toBe(false)
  })

  it('a DIFFERENT live feature does not cause this call to go live', async () => {
    process.env.CRM_AUTOMATION_LIVE = 'true'
    process.env.CRM_OPERATIONAL_AUTOMATION_LIVE = 'true' // WAITLIST is not enabled
    const realSend = vi.fn().mockResolvedValue(undefined)
    const result = await sendOrSimulate('WAITLIST', 'WHATSAPP', '+256700000000', 'hi', realSend)
    expect(realSend).not.toHaveBeenCalled()
    expect(result.dryRun).toBe(true)
  })
})
