import { describe, expect, it } from 'vitest'
import { getMobileNav } from '../mobileNav'

describe('getMobileNav — role-aware navigation + RBAC', () => {
  it('ADMIN always sees every primary tab regardless of perms, with no Home tab and no More sheet', () => {
    // Middleware.ts skips the permission check entirely for ADMIN — the nav
    // must mirror that exactly, never filtering on a permsMap for this role.
    // ADMIN has 6 primary destinations (Patients/Appointments/AI Suite/
    // Treatment/CRM/Reports) — no "Home" tab (the header logo is Home) and
    // no "More" button (every former More destination now lives behind one
    // of these 6 tabs' own menu, so `more` is always empty for this role).
    const withEverythingDenied = getMobileNav('ADMIN', {
      patients: false, appointments: false, aiSuiteInbox: false, reports: false,
    })
    expect(withEverythingDenied.primary).toHaveLength(6)
    expect(withEverythingDenied.primary.map(t => t.key)).toEqual(
      ['patients', 'appointments', 'ai-suite', 'treatment', 'crm', 'reports'],
    )
    expect(withEverythingDenied.primary.find(t => t.key === 'home')).toBeUndefined()
    expect(withEverythingDenied.more).toEqual([])
  })

  it('ADMIN Patients tab opens a menu containing a Billing item with a Billing drill-down', () => {
    const nav = getMobileNav('ADMIN', {})
    const patientsTab = nav.primary.find(t => t.key === 'patients')
    expect(patientsTab?.type).toBe('menu')
    if (patientsTab?.type !== 'menu') throw new Error('unreachable')
    const billing = patientsTab.sections[0].items.find(i => i.label === 'Billing')
    expect(billing?.children?.[0].items.map(i => i.label)).toEqual(
      ['Accounts', 'Sales', 'Expenses', 'Payroll', 'Stocks'],
    )
  })

  it('ADMIN Reports tab menu includes the Staff section (Staff is reachable from Reports, not a giant More menu)', () => {
    const nav = getMobileNav('ADMIN', {})
    const reportsTab = nav.primary.find(t => t.key === 'reports')
    expect(reportsTab?.type).toBe('menu')
    if (reportsTab?.type !== 'menu') throw new Error('unreachable')
    const staffSection = reportsTab.sections.find(s => s.heading === 'Staff')
    expect(staffSection?.items.map(i => i.label)).toEqual(
      ['Staff List', 'Attendance', 'Staff Permissions', 'Audit Logs'],
    )
  })

  it('RECEPTIONIST hides a primary tab when its real middleware-enforced permission key is denied', () => {
    // /receptionist/scheduling is gated by the canonical 'appointments' key in
    // middleware.ts's ROUTE_FEATURE table (post scheduling/appointments merge —
    // new writes from the permissions registry only ever use 'appointments').
    // Getting this key wrong would show a tab that immediately bounces the
    // user via the middleware redirect.
    const nav = getMobileNav('RECEPTIONIST', { appointments: false })
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
    // A drill-down trigger (an item with `children`, e.g. ADMIN's "Billing"
    // under Patients) never navigates — MobileNavSheet renders it as a
    // <button> that swaps to its children, and its `href` is structurally
    // required but unused. Only leaf items (no `children`) are real links.
    function checkSections(sections: import('../mobileNav').MoreSection[]) {
      for (const section of sections) {
        for (const item of section.items) {
          if (item.children) { checkSections(item.children); continue }
          expect(item.href.startsWith('/')).toBe(true)
          expect(item.href).not.toContain('#')
        }
      }
    }

    for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR'] as const) {
      const nav = getMobileNav(role, {})
      for (const tab of nav.primary) {
        if (tab.type === 'menu') { checkSections(tab.sections); continue }
        expect(tab.href.startsWith('/')).toBe(true)
        expect(tab.href).not.toContain('#')
      }
      checkSections(nav.more)
    }
  })
})