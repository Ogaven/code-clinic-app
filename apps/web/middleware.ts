import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require authentication
const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/setup',
  '/2fa',
  '/api-proxy',
  '/api',
  '/_next',
  '/favicon',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Pass through public routes and static assets
  if (
    PUBLIC_PREFIXES.some(p => pathname.startsWith(p)) ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get('cc_token')?.value
  if (!token) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Run on all paths except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
