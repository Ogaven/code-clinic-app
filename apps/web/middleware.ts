import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function decodeRole(token: string): string | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice(0, (4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    return payload.role ?? null
  } catch {
    return null
  }
}

const ROLE_HOME: Record<string, string> = {
  RECEPTIONIST: '/receptionist/dashboard',
  ADMIN:        '/admin/dashboard',
  DOCTOR:       '/doctor/dashboard',
  ACCOUNTS:     '/accounts/dashboard',
  DEVELOPER:    '/developer/dashboard',
}

const ROUTE_ROLE: Array<[string, string]> = [
  ['/receptionist', 'RECEPTIONIST'],
  ['/admin',        'ADMIN'],
  ['/doctor',       'DOCTOR'],
  ['/accounts',     'ACCOUNTS'],
  ['/developer',    'DEVELOPER'],
]

const PUBLIC_PATHS = ['/', '/login', '/setup', '/privacy.html', '/terms.html', '/privacy', '/terms']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — never redirect, let the page handle its own auth state
  if (PUBLIC_PATHS.some(p => pathname === p)) return NextResponse.next()
  if (pathname.startsWith('/auth/')) return NextResponse.next()

  const token = request.cookies.get('cc_token')?.value
  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = decodeRole(token)
  const home = role ? (ROLE_HOME[role] ?? '/login') : '/login'

  for (const [prefix, required] of ROUTE_ROLE) {
    if (pathname.startsWith(prefix) && role !== required) {
      return NextResponse.redirect(new URL(home, request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!login|_next/static|_next/image|favicon.ico|icon.png|manifest.json|api-proxy|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.webp|.*\\.ico|.*\\.gif).*)',
  ],
}
