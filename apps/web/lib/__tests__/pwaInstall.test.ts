import { afterEach, describe, expect, it } from 'vitest'
import { detectIOS, detectStandalone } from '../pwaInstall'

function stubGlobals(overrides: { navigator?: any; window?: any }) {
  if (overrides.navigator !== undefined) (globalThis as any).navigator = overrides.navigator
  if (overrides.window !== undefined) (globalThis as any).window = overrides.window
}

afterEach(() => {
  delete (globalThis as any).navigator
  delete (globalThis as any).window
})

describe('detectIOS', () => {
  it('is false when navigator is unavailable (SSR / Node)', () => {
    delete (globalThis as any).navigator
    expect(detectIOS()).toBe(false)
  })

  it('detects a real iPhone user agent', () => {
    stubGlobals({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 } })
    expect(detectIOS()).toBe(true)
  })

  it('detects a real iPad user agent', () => {
    stubGlobals({ navigator: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 } })
    expect(detectIOS()).toBe(true)
  })

  it('detects iPadOS 13+ reporting as "MacIntel" via touch-point heuristic', () => {
    stubGlobals({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6)', platform: 'MacIntel', maxTouchPoints: 5 } })
    expect(detectIOS()).toBe(true)
  })

  it('does not misidentify a real Mac (no touch points) as an iPad', () => {
    stubGlobals({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6)', platform: 'MacIntel', maxTouchPoints: 0 } })
    expect(detectIOS()).toBe(false)
  })

  it('does not flag Android as iOS', () => {
    stubGlobals({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 } })
    expect(detectIOS()).toBe(false)
  })

  // Since iOS/iPadOS 16.4, Home Screen web apps and Web Push work from any
  // browser's Add to Home Screen, not just Safari's (WebKit's own guidance:
  // feature-detect, don't browser-detect) — detectIOS() must keep reporting
  // "this is an iOS device" the same way regardless of which browser it's
  // running in, so callers never single out Chrome/Firefox/Edge for iOS.
  it('detects iOS the same way for Chrome, Firefox, and Edge on iOS as for Safari', () => {
    const uas = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/119.0 Mobile/15E148 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/605.1.15',
    ]
    for (const userAgent of uas) {
      stubGlobals({ navigator: { userAgent, platform: 'iPhone', maxTouchPoints: 5 } })
      expect(detectIOS()).toBe(true)
    }
  })
})

describe('detectStandalone', () => {
  it('is false when window is unavailable (SSR / Node)', () => {
    delete (globalThis as any).window
    expect(detectStandalone()).toBe(false)
  })

  it('detects iOS Safari\'s non-standard navigator.standalone flag', () => {
    stubGlobals({
      window: { navigator: { standalone: true }, matchMedia: () => ({ matches: false }) },
    })
    expect(detectStandalone()).toBe(true)
  })

  it('detects the cross-platform display-mode: standalone media query', () => {
    stubGlobals({
      window: { navigator: {}, matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) },
    })
    expect(detectStandalone()).toBe(true)
  })

  it('is false in an ordinary browser tab', () => {
    stubGlobals({
      window: { navigator: {}, matchMedia: () => ({ matches: false }) },
    })
    expect(detectStandalone()).toBe(false)
  })
})