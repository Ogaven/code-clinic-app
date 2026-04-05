'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const ROLE_REDIRECTS: Record<string, string> = {
  ACCOUNTS: '/accounts/dashboard', RECEPTIONIST: '/receptionist/dashboard',
  DOCTOR: '/dashboard', ADMIN: '/dashboard', DEVELOPER: '/dashboard',
}

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token   = params.get('token')
    const userRaw = params.get('user')
    const error   = params.get('error')

    if (error) { router.replace('/login?error=' + error); return }
    if (!token || !userRaw) { router.replace('/login'); return }

    try {
      const user = JSON.parse(decodeURIComponent(userRaw))
      localStorage.setItem('cc_token', token)
      localStorage.setItem('cc_user', JSON.stringify(user))
      router.replace(ROLE_REDIRECTS[user.role] || '/dashboard')
    } catch {
      router.replace('/login')
    }
  }, [])

  return (
    <div className="h-screen flex items-center justify-center flex-col gap-4"
      style={{ background: 'linear-gradient(145deg,#020818,#0d1b6e)' }}>
      <Loader2 size={36} className="animate-spin text-cyan-400"/>
      <p className="text-blue-200 text-sm">Signing you in...</p>
    </div>
  )
}
