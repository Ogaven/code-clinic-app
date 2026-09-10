import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function decodeToken(token: string): { role: string | null; permissions: Record<string, boolean> } {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice(0, (4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    let perms: Record<string, boolean> = {}
    if (payload.permissions) {
      try { perms = JSON.parse(payload.permissions) } catch {}
    }
    return { role: payload.role ?? null, permissions: perms }
  } catch {
    return { role: null, permissions: {} }
  }
}

const ROLE_HOME: Record<string, string> = {
  RECEPTIONIST: '/receptionist/dashboard',
  ADMIN:        '/admin/dashboard',
  DOCTOR:       '/doctor/dashboard',
  ACCOUNTS:     '/accounts/dashboard',
  DEVELOPER:    '/developer/dashboard',
}

const ROUTE_ROLE: Array<[string, string[]]> = [
  ['/receptionist', ['RECEPTIONIST', 'DOCTOR']],
  ['/admin',        ['ADMIN']],
  ['/doctor',       ['DOCTOR', 'RECEPTIONIST']],
  ['/accounts',     ['ACCOUNTS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST']],
  ['/developer',    ['DEVELOPER']],
]

// Route prefix → permission key. Checked only for non-ADMIN, non-DEVELOPER roles.
// A feature is blocked only when explicitly set to false; missing key = allowed.
//
// '/receptionist/scheduling' and '/receptionist/appointments' used to gate on
// DIFFERENT keys ('scheduling' vs 'appointments') even though the desktop
// TopBar's "Appointments" link already points at /receptionist/scheduling
// (the fuller workspace) tagged with the 'appointments' key — so disabling
// 'appointments' hid the nav link but never blocked the page, while the
// separate 'scheduling' key blocked a page nothing linked to any more.
// Merged onto one real key, 'appointments' (see WORKSTREAM A Part B security
// findings). Escalations, Treatment Pipeline, Referrals and Campaigns were
// real nav-permKey'd links with NO route entry here at all — frontend hiding
// only, never enforced — added below using the permKey each nav item
// already declares (ReceptionistTopBar.tsx).
const ROUTE_FEATURE: Array<[string, string]> = [
  ['/receptionist/scheduling',                               'appointments'],
  ['/receptionist/appointments',                             'appointments'],
  ['/receptionist/patients',                                 'patients'],
  ['/receptionist/leads',                                    'leads'],
  ['/receptionist/flow',                                     'liveFlow'],
  ['/receptionist/ai-suite/inbox',                           'aiSuiteInbox'],
  ['/receptionist/ai-suite/escalations',                     'aiSuiteInbox'],
  ['/receptionist/ai-suite/followup-dashboard',              'aiSuiteFollowup'],
  ['/receptionist/ai-suite/confirmation-dashboard',          'aiSuiteConfirmation'],
  ['/receptionist/ai-suite/calls',                           'callLogs'],
  ['/receptionist/ai-suite/voice-studio',                    'voiceStudio'],
  ['/receptionist/ai-suite/knowledge',                       'knowledgeBase'],
  ['/receptionist/reports',                                  'reports'],
  ['/receptionist/communications',                           'communications'],
  ['/receptionist/treatment-pipeline',                       'treatmentPipeline'],
  ['/receptionist/referrals',                                'referrals'],
  ['/receptionist/campaigns',                                'campaigns'],
  ['/doctor/schedule',                                       'appointments'],
  ['/doctor/patients',                                       'patients'],
  ['/doctor/flow',                                           'liveFlow'],
  ['/doctor/messages',                                       'communications'],
  ['/doctor/ai-suite/followup-dashboard',                    'aiSuiteFollowup'],
  ['/doctor/ai-suite/confirmation-dashboard',                'aiSuiteConfirmation'],
  ['/doctor/ai-suite/knowledge',                             'knowledgeBase'],
  ['/accounts',                                              'accounts'],
  ['/audit-log',                                             'auditLog'],
]

const PUBLIC_PATHS = ['/', '/login', '/setup', '/privacy.html', '/terms.html', '/privacy', '/terms', '/chatbot-widget', '/pre-visit']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — never redirect, let the page handle its own auth state
  if (PUBLIC_PATHS.some(p => pathname === p)) return NextResponse.next()
  if (pathname.startsWith('/auth/'))   return NextResponse.next()
  if (pathname.startsWith('/widget/')) return NextResponse.next()
  if (pathname.startsWith('/quiz/'))   return NextResponse.next()

  const token = request.cookies.get('cc_token')?.value
  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { role, permissions } = decodeToken(token)
  const home = role ? (ROLE_HOME[role] ?? '/login') : '/login'

  for (const [prefix, required] of ROUTE_ROLE) {
    if (pathname.startsWith(prefix) && !required.includes(role || '')) {
      return NextResponse.redirect(new URL(home, request.url))
    }
  }

  // Permission check — skip for ADMIN and DEVELOPER (always have full access)
  if (role && role !== 'ADMIN' && role !== 'DEVELOPER') {
    for (const [prefix, feature] of ROUTE_FEATURE) {
      if (!pathname.startsWith(prefix)) continue
      // Legacy read fallback: staff permissioned before the 'scheduling' ->
      // 'appointments' merge may still have 'scheduling: false' persisted
      // with no 'appointments' key at all — without this, that explicit
      // deny would silently go inert (missing key = allowed). New writes
      // from the permissions registry only ever use 'appointments'.
      const value = feature === 'appointments' && permissions['appointments'] === undefined
        ? permissions['scheduling']
        : permissions[feature]
      if (value === false) {
        return NextResponse.redirect(new URL(home, request.url))
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!login|_next/static|_next/image|favicon.ico|icon.png|manifest.json|sw.js|api-proxy|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.webp|.*\\.ico|.*\\.gif|.*\\.js\\.map).*)',
  ],
}
