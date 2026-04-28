import { describe, it, expect } from 'vitest'
import { detectIntent } from '../ai-suite/agent/agent.service'

// ── detectIntent ──────────────────────────────────────────────────────────────

describe('detectIntent', () => {
  it('detects BOOK intent from "book an appointment"', () => {
    expect(detectIntent('I want to book an appointment')).toBe('BOOK')
  })

  it('detects BOOK intent from "checkup"', () => {
    expect(detectIntent('I need a checkup')).toBe('BOOK')
  })

  it('detects BOOK intent from "filling"', () => {
    expect(detectIntent('I need a filling done')).toBe('BOOK')
  })

  it('detects CANCEL intent', () => {
    expect(detectIntent("I need to cancel my appointment")).toBe('CANCEL')
  })

  it('detects CANCEL from "won\'t make it"', () => {
    expect(detectIntent("I won't make it tomorrow")).toBe('CANCEL')
  })

  it('detects CANCEL has higher priority than BOOK keywords in same message', () => {
    // "cancel my appointment" — cancel should win
    expect(detectIntent('Please cancel my appointment')).toBe('CANCEL')
  })

  it('detects RESCHEDULE intent', () => {
    expect(detectIntent('I need to reschedule my appointment')).toBe('RESCHEDULE')
  })

  it('detects RESCHEDULE from "different time"', () => {
    expect(detectIntent('Can we do a different time?')).toBe('RESCHEDULE')
  })

  it('returns null for unrelated messages', () => {
    expect(detectIntent('Hello, how are you?')).toBeNull()
  })

  it('returns null for empty message', () => {
    expect(detectIntent('')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(detectIntent('BOOK AN APPOINTMENT')).toBe('BOOK')
    expect(detectIntent('CANCEL')).toBe('CANCEL')
  })
})
