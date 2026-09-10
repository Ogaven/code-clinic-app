import { describe, expect, it } from 'vitest'
import { getMobileNav } from '../mobileNav'

describe('getMobileNav — role-aware navigation + RBAC', () => {
  it('ADMIN always sees every primary tab and More section, regardless of perms', () => {
    // Middleware.ts skips the permission check entirely for ADMIN — the nav
    // must mirror that exactly, never filtering on a permsMap for this role.
    const withEverythingDenied = getMobileNav('ADMIN', {
      patients: false, scheduling: false, aiSuiteInbox: false, reports: false,
    })
    expect(withEverythingDenied.primary).toHaveLength(4)
    expect(withEverythingDenied.primary.map(t => t.key)).toEqual(['home', 'patients', 'appointments', 'ai-suite'])
    expect(withEverythingDenied.more.length).toBeGreaterThan(0)
  })

  it('RECEPTIONIST hides a primary tab when its real middleware-enforced permission key is denied', () => {
    // /receptionist/scheduling is gated by 'scheduling' in middleware.ts's
    // ROUTE_FEATURE table — not 'appointments'. Getting this key wrong would
    // show a tab that immediately bounces the user via the middleware redirect.
    const nav = getMobileNav('RECEPTIONIST', { scheduling: false })
    expect(nav.primary.find(t => t.key === 'appointments')).toBeUndefined()
    expect(nav.primary.find(t => t.key === 'home')).toBeDefined() // no permKey — never hidden
  })

  it('RECEPTIONIST keeps a primary tab whose permission key is simply absent (default-allow)', () => {
    const nav = getMobileNav('RECEPTIONIST', {})
    expect(nav.primary.map(t => t.key)).toEqual(['home', 'patients', 'appointments', 'ai-suite'])
  })

  it('RECEPTIONIST "More" sections disappear entirely once every item inside is denied', () => {
    const nav = getMobileNav('RECEPTIONIST', { liveFlow: false })
    expect(nav.more.find(s => s.heading === 'Clinic')).toBeUndefined()
  })

  it('RECEPTIONIST "More" keeps a section if at least one item inside remains authorized', () => {
    const nav = getMobileNav('RECEPTIONIST', { leads: false, referrals: false, campaigns: false })
    const crm = nav.more.find(s => s.heading === 'CRM')
    expect(crm).toBeDefined()
    expect(crm!.items.map(i => i.label)).toEqual(['Treatment Pipeline'])
  })

  it('DOCTOR primary tabs use Treatments instead of AI Suite, matching the real doctor route tree', () => {
    const nav = getMobileNav('DOCTOR', {})
    expect(nav.primary.map(t => t.key)).toEqual(['home', 'patients', 'appointments', 'treatments'])
    expect(nav.primary.find(t => t.key === 'ai-suite')).toBeUndefined()
  })

  it('DOCTOR hides Appointments when the real "appointments" permission key is denied', () => {
    const nav = getMobileNav('DOCTOR', { appointments: false })
    expect(nav.primary.find(t => t.key === 'appointments')).toBeUndefined()
  })

  it('every configured href is a real, non-empty path — never a placeholder', () => {
    for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR'] as const) {
      const nav = getMobileNav(role, {})
      for (const tab of nav.primary) {
        expect(tab.href.startsWith('/')).toBe(true)
        expect(tab.href).not.toContain('#')
      }
      for (const section of nav.more) {
        for (const item of section.items) {
          expect(item.href.startsWith('/')).toBe(true)
        }
      }
    }
  })
})