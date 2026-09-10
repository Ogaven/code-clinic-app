import { describe, expect, it } from 'vitest'
import { getNotificationRowState } from '../notificationRowState'

describe('getNotificationRowState', () => {
  it('unsupported wins over every other signal', () => {
    expect(getNotificationRowState({ supported: false, permission: 'granted', subscribed: true })).toBe('unsupported')
  })

  it('denied is reported even if a stale subscription flag is still true', () => {
    expect(getNotificationRowState({ supported: true, permission: 'denied', subscribed: true })).toBe('denied')
  })

  it('subscribed shows the disable action', () => {
    expect(getNotificationRowState({ supported: true, permission: 'granted', subscribed: true })).toBe('subscribed')
  })

  it('offers to enable when supported, not denied, and not yet subscribed', () => {
    expect(getNotificationRowState({ supported: true, permission: 'default', subscribed: false })).toBe('offer')
  })

  it('granted-but-not-subscribed still offers to enable, not a false "subscribed" state', () => {
    // e.g. permission was granted in a previous session but the push
    // subscription itself was cleared server-side — must not claim enabled.
    expect(getNotificationRowState({ supported: true, permission: 'granted', subscribed: false })).toBe('offer')
  })
})