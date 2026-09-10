// Tests for public/sw.js — a plain, unbundled static asset served as-is (not
// part of the webpack/Next.js module graph), so it can't be `import`ed
// directly into a test the way a normal TS module can. Two strategies here:
//   1. Read the raw source and assert the safety-critical shape is present
//      (regression guard against someone "simplifying" it back to something
//      dangerous without touching this test).
//   2. Mirror the small, stable safeNotificationUrl() function verbatim and
//      unit-test its actual behavior directly.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const swSource = readFileSync(join(__dirname, '..', 'sw.js'), 'utf-8')

describe('sw.js — no sensitive API caching', () => {
  it('explicitly skips /api/ and /api-proxy/ paths in the fetch handler before any cache logic', () => {
    expect(swSource).toMatch(/url\.pathname\.startsWith\(['"]\/api\/['"]\)/)
    expect(swSource).toMatch(/url\.pathname\.startsWith\(['"]\/api-proxy\/['"]\)/)
  })

  it('only cache-first-handles content-hashed /_next/static/ assets, not arbitrary API responses', () => {
    expect(swSource).toMatch(/url\.pathname\.startsWith\(['"]\/_next\/static\/['"]\)/)
  })
})

describe('sw.js — notification click routing never trusts an arbitrary payload URL', () => {
  it('defines a same-origin guard before navigating', () => {
    expect(swSource).toContain('function safeNotificationUrl')
    expect(swSource).toMatch(/resolved\.origin !== self\.location\.origin/)
  })

  it('the notificationclick handler routes the payload URL through the guard, not raw', () => {
    const handlerStart = swSource.indexOf("addEventListener('notificationclick'")
    expect(handlerStart).toBeGreaterThan(-1)
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 600)
    expect(handlerSlice).toContain('safeNotificationUrl(')
    expect(handlerSlice).not.toMatch(/e\.notification\.data\.url\)\s*\|\|/) // the old, unguarded assignment
  })
})

// Mirrors sw.js's safeNotificationUrl() verbatim — keep in sync if that
// function ever changes.
function safeNotificationUrl(rawUrl: unknown, origin: string): string {
  const fallback = '/dashboard'
  if (!rawUrl || typeof rawUrl !== 'string') return fallback
  try {
    const resolved = new URL(rawUrl, origin)
    if (resolved.origin !== origin) return fallback
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return fallback
  }
}

const ORIGIN = 'https://codeclinicemr.com'

describe('safeNotificationUrl (mirrored logic)', () => {
  it('allows a same-origin relative path', () => {
    expect(safeNotificationUrl('/doctor/dashboard', ORIGIN)).toBe('/doctor/dashboard')
  })

  it('allows a same-origin absolute URL and strips it back to a path', () => {
    expect(safeNotificationUrl(`${ORIGIN}/receptionist/patients/123`, ORIGIN)).toBe('/receptionist/patients/123')
  })

  it('preserves query and hash for a same-origin path', () => {
    expect(safeNotificationUrl('/receptionist/reports?tab=flow', ORIGIN)).toBe('/receptionist/reports?tab=flow')
  })

  it('rejects an external origin and falls back to the safe default', () => {
    expect(safeNotificationUrl('https://evil.example.com/phish', ORIGIN)).toBe('/dashboard')
  })

  it('rejects a protocol-relative external URL', () => {
    expect(safeNotificationUrl('//evil.example.com/phish', ORIGIN)).toBe('/dashboard')
  })

  it('rejects a javascript: URL', () => {
    expect(safeNotificationUrl('javascript:alert(1)', ORIGIN)).toBe('/dashboard')
  })

  it('falls back safely on missing or non-string input', () => {
    expect(safeNotificationUrl(undefined, ORIGIN)).toBe('/dashboard')
    expect(safeNotificationUrl(null, ORIGIN)).toBe('/dashboard')
    expect(safeNotificationUrl(42, ORIGIN)).toBe('/dashboard')
  })

  it('falls back safely on a malformed URL string', () => {
    expect(safeNotificationUrl('http://', ORIGIN)).toBe('/dashboard')
  })
})