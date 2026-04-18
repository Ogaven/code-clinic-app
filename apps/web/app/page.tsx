'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const ROLE_MAP: Record<string, string> = {
  ADMIN:        '/dashboard',
  DEVELOPER:    '/dashboard',
  DOCTOR:       '/doctor/dashboard',
  RECEPTIONIST: '/receptionist/dashboard',
  ACCOUNTS:     '/accounts/dashboard',
}

// Root page: immediately redirect to the right app based on role.
// If not logged in, go to /login.
export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    try {
      const raw = localStorage.getItem('cc_user')
      const tok = localStorage.getItem('cc_token')
      if (!raw || !tok) { router.replace('/login'); return }
      const u = JSON.parse(raw)
      router.replace(ROLE_MAP[u.role] || '/login')
    } catch {
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
    </div>
  )
}
