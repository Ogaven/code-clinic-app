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

  // Since iOS/iPadOS 16.4, Home Screen web apps and Web Push work from any
  // browser's Add to Home Screen (WebKit's own guidance: feature-detect,
  // don't browser-detect) — getNotificationRowState only ever receives
  // isIOS/isStandalone, with no browser-identity signal at all, so iPhone
  // Chrome/Firefox/Edge get the exact same guidance as Safari here, never a
  // "you must switch to Safari" message.
  it('iOS not installed (any browser) reports ios-needs-install instead of a dead-end "unsupported"', () => {
    expect(getNotificationRowState({
      supported: false, permission: 'default', subscribed: false, isIOS: true, isStandalone: false,
    })).toBe('ios-needs-install')
  })

  it('iOS installed as a Home Screen web app (any browser) falls through to the normal supported logic', () => {
    expect(getNotificationRowState({
      supported: true, permission: 'default', subscribed: false, isIOS: true, isStandalone: true,
    })).toBe('offer')
  })

  it('a non-iOS unsupported browser still reports the generic unsupported state', () => {
    expect(getNotificationRowState({
      supported: false, permission: 'default', subscribed: false, isIOS: false, isStandalone: false,
    })).toBe('unsupported')
  })
})