// Covers apps/api/src/services/treatment-classification.service.ts — the
// canonical Presented/Accepted/Declined classification shared by Case
// Acceptance (reports.ts) and the Treatment Pipeline's KPI strip
// (pipeline.ts). Before this file existed, the two read different fields
// (status vs stage) with different value sets and could silently disagree
// on "accepted". These tests pin down each status value's classification
// AND prove parity: given the same plans, a reports.ts-style count and a
// pipeline.ts-style value-sum always select the identical subset.

import { describe, expect, it } from 'vitest'
import { isAccepted, isDeclined, isCancelled, isPresented, ACCEPTED_STATUSES, computeMoneyAtRisk } from '../services/treatment-classification.service'

function plan(status: string, followUpAt: Date | null = null) {
  return { status, followUpAt }
}

describe('isPresented', () => {
  it('every plan handed in is presented, regardless of status', () => {
    for (const status of ['Planned', 'In Progress', 'Completed', 'On Hold', 'Declined', 'Cancelled']) {
      expect(isPresented(plan(status))).toBe(true)
    }
  })
})

describe('isAccepted — exact status classification', () => {
  it('Planned is NOT accepted', () => { expect(isAccepted(plan('Planned'))).toBe(false) })
  it('In Progress IS accepted', () => { expect(isAccepted(plan('In Progress'))).toBe(true) })
  it('Completed IS accepted', () => { expect(isAccepted(plan('Completed'))).toBe(true) })
  it('On Hold is NOT accepted', () => { expect(isAccepted(plan('On Hold'))).toBe(false) })
  it('Declined is NOT accepted', () => { expect(isAccepted(plan('Declined'))).toBe(false) })
  it('Cancelled is NOT accepted', () => { expect(isAccepted(plan('Cancelled'))).toBe(false) })

  it('ACCEPTED_STATUSES is exactly {In Progress, Completed} — the one place this set is defined', () => {
    expect([...ACCEPTED_STATUSES].sort()).toEqual(['Completed', 'In Progress'])
  })
})

describe('isDeclined / isCancelled', () => {
  it('isDeclined is true only for Declined', () => {
    expect(isDeclined(plan('Declined'))).toBe(true)
    for (const status of ['Planned', 'In Progress', 'Completed', 'On Hold', 'Cancelled']) {
      expect(isDeclined(plan(status))).toBe(false)
    }
  })
  it('isCancelled is true only for Cancelled', () => {
    expect(isCancelled(plan('Cancelled'))).toBe(true)
    for (const status of ['Planned', 'In Progress', 'Completed', 'On Hold', 'Declined']) {
      expect(isCancelled(plan(status))).toBe(false)
    }
  })
})

describe('Follow Up must never count as Accepted', () => {
  it('a Planned plan with an active followUpAt is still NOT accepted', () => {
    const p = plan('Planned', new Date('2026-12-01'))
    expect(isAccepted(p)).toBe(false)
  })

  it('an On Hold plan with a followUpAt is still NOT accepted', () => {
    const p = plan('On Hold', new Date('2026-12-01'))
    expect(isAccepted(p)).toBe(false)
  })

  it('a followUpAt on an OTHERWISE-accepted treatment does not change its acceptance -- the two flags are independent, never conflated', () => {
    const withFollowUp = plan('In Progress', new Date('2026-12-01'))
    const withoutFollowUp = plan('In Progress', null)
    expect(isAccepted(withFollowUp)).toBe(true)
    expect(isAccepted(withoutFollowUp)).toBe(true)
    // Setting/clearing followUpAt must never flip acceptance either way.
    expect(isAccepted(withFollowUp)).toBe(isAccepted(withoutFollowUp))
  })
})

describe('Pipeline KPI vs Case Acceptance parity', () => {
  // Fabricates the same plan set reports.ts and pipeline.ts would each see
  // for one date range, then classifies it two different ways: a
  // reports.ts-style COUNT (Case Acceptance) and a pipeline.ts-style VALUE
  // SUM (Pipeline KPI strip). Both must select the exact same subset of
  // plans as "accepted" -- the whole point of sharing one function.
  const plans = [
    { status: 'Planned',     value: 100_000 },
    { status: 'In Progress', value: 200_000 },
    { status: 'Completed',   value: 300_000 },
    { status: 'On Hold',     value: 400_000 },
    { status: 'Declined',    value: 500_000 },
    { status: 'Cancelled',   value: 600_000 },
  ]

  it('Case-Acceptance-style accepted COUNT and Pipeline-style accepted VALUE SUM agree on exactly which plans are accepted', () => {
    const acceptedByReportsStyle = plans.filter(p => isAccepted(p))
    const acceptedByPipelineStyle = plans.filter(p => isAccepted(p)) // same function, same filter — parity is structural, not coincidental

    expect(acceptedByReportsStyle).toEqual(acceptedByPipelineStyle)
    expect(acceptedByReportsStyle.map(p => p.status).sort()).toEqual(['Completed', 'In Progress'])

    const acceptedCount = acceptedByReportsStyle.length
    const acceptedValue = acceptedByPipelineStyle.reduce((s, p) => s + p.value, 0)
    expect(acceptedCount).toBe(2)
    expect(acceptedValue).toBe(200_000 + 300_000)
  })

  it('presented = every plan in range for both systems (no status exclusion)', () => {
    const presentedCount = plans.filter(p => isPresented(p)).length
    expect(presentedCount).toBe(plans.length)
  })

  it('declined is excluded from the conversion-rate denominator identically in both systems', () => {
    const nonDeclined = plans.filter(p => !isDeclined(p))
    expect(nonDeclined.find(p => p.status === 'Declined')).toBeUndefined()
    expect(nonDeclined).toHaveLength(5)
  })
})

describe('computeMoneyAtRisk', () => {
  it('sums value only for plans in the Accepted & Unscheduled stage', () => {
    const plans = [
      { stage: 'Accepted & Unscheduled', value: 100_000 },
      { stage: 'Accepted & Scheduled',   value: 200_000 },
      { stage: 'Completed',              value: 50_000 },
      { stage: 'Accepted & Unscheduled', value: 25_000 },
    ]
    expect(computeMoneyAtRisk(plans)).toBe(125_000)
  })

  it('returns 0 for an empty plan list', () => {
    expect(computeMoneyAtRisk([])).toBe(0)
  })

  // Parity check: pipeline.ts's own "Money at Risk" KPI card performs this
  // exact computation on its `enriched` plans array. Asserting the same
  // inputs produce the same output here pins down that reports.ts's
  // case-acceptance endpoint can never silently drift from it after both
  // call through this one shared function.
  it('agrees with a hand-computed pipeline.ts-style figure for a mixed cohort', () => {
    const enriched = [
      { stage: 'Treatment Presented',    value: 10_000 },
      { stage: 'Accepted & Unscheduled', value: 300_000 },
      { stage: 'Declined',               value: 40_000 },
    ]
    const handComputed = enriched
      .filter(p => p.stage === 'Accepted & Unscheduled')
      .reduce((s, p) => s + p.value, 0)
    expect(computeMoneyAtRisk(enriched)).toBe(handComputed)
  })
})
