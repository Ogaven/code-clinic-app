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