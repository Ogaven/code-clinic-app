import { describe, expect, it } from 'vitest'
import { collapseToAlternatingRoles } from '../ai-suite/knowledge/message-history'

describe('collapseToAlternatingRoles (Knowledge Studio chat root-cause fix)', () => {
  it('leaves an already-alternating history untouched', () => {
    const input = [
      { role: 'user' as const, content: 'What are your hours?' },
      { role: 'assistant' as const, content: 'We are open 8am-6pm.' },
    ]
    expect(collapseToAlternatingRoles(input)).toEqual(input)
  })

  it('collapses [user, user, assistant] into [user, assistant]', () => {
    const input = [
      { role: 'user' as const, content: 'First failed question' },
      { role: 'user' as const, content: 'Follow-up after the failure' },
      { role: 'assistant' as const, content: 'Reply' },
    ]
    const out = collapseToAlternatingRoles(input)
    expect(out).toEqual([
      { role: 'user', content: 'First failed question\n\nFollow-up after the failure' },
      { role: 'assistant', content: 'Reply' },
    ])
    expect(out.every((m, i) => i === 0 || m.role !== out[i - 1].role)).toBe(true)
  })

  it('collapses [user, assistant, user, user] into [user, assistant, user] — the exact poisoned-conversation shape from the original bug report', () => {
    const input = [
      { role: 'user' as const, content: 'What are your hours?' },
      { role: 'assistant' as const, content: 'We are open 8am-6pm.' },
      { role: 'user' as const, content: 'What about Saturday?' }, // this turn's provider call failed — no assistant reply persisted
      { role: 'user' as const, content: 'Hello? Are you there?' }, // next message the staff member sent — would have been a 2nd consecutive 'user' pre-fix
    ]
    const out = collapseToAlternatingRoles(input)
    expect(out).toEqual([
      { role: 'user', content: 'What are your hours?' },
      { role: 'assistant', content: 'We are open 8am-6pm.' },
      { role: 'user', content: 'What about Saturday?\n\nHello? Are you there?' },
    ])
    expect(out.every((m, i) => i === 0 || m.role !== out[i - 1].role)).toBe(true)
    expect(out[0].role).toBe('user')
  })

  it('never produces two consecutive same-role entries for any run length', () => {
    const input = [
      { role: 'user' as const, content: 'a' },
      { role: 'user' as const, content: 'b' },
      { role: 'user' as const, content: 'c' },
      { role: 'assistant' as const, content: 'd' },
      { role: 'assistant' as const, content: 'e' },
      { role: 'user' as const, content: 'f' },
    ]
    const out = collapseToAlternatingRoles(input)
    for (let i = 1; i < out.length; i++) expect(out[i].role).not.toBe(out[i - 1].role)
  })

  it('drops leading assistant entries so the sequence always starts with user', () => {
    const input = [
      { role: 'assistant' as const, content: 'orphaned lead-in' },
      { role: 'user' as const, content: 'real first message' },
    ]
    const out = collapseToAlternatingRoles(input)
    expect(out[0]).toEqual({ role: 'user', content: 'real first message' })
  })

  it('handles an empty history', () => {
    expect(collapseToAlternatingRoles([])).toEqual([])
  })
})
