'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

const ROLE_MAP: Record<string, string> = {
  ADMIN:        '/dashboard',
  DEVELOPER:    '/developer/dashboard',
  DOCTOR:       '/doctor/dashboard',
  RECEPTIONIST: '/receptionist/dashboard',
  ACCOUNTS:     '/accounts/dashboard',
}

export default function WelcomePage() {
  const router = useRouter()
  // Card is visible immediately — no waiting for async checks
  const [show] = useState(true)

  useEffect(() => {
    // Only redirect if the user is already logged in
    try {
      const raw = localStorage.getItem('cc_user')
      const tok = localStorage.getItem('cc_token')
      if (raw && tok) {
        const u = JSON.parse(raw)
        router.replace(ROLE_MAP[u.role] || '/login')
      }
    } catch {}
  }, [router])

  return (
    <div className="min-h-screen w-screen flex flex-col"
      style={{ background: 'linear-gradient(145deg,#020818 0%,#060e3a 30%,#0d1b6e 65%,#1565C0 100%)' }}>
    <div style={{ background: '#1A237E', color: 'white', textAlign: 'center', padding: '8px', fontSize: '13px', width: '100%' }}>
      <a href="/privacy.html" style={{ color: '#29ABE2', marginRight: '16px' }}>Privacy Policy</a>
      <a href="/terms.html" style={{ color: '#29ABE2' }}>Terms of Service</a>
    </div>
    <div className="flex-1 relative flex items-center justify-center overflow-hidden">

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* Glow blobs */}
      <div className="absolute rounded-full pointer-events-none"
        style={{ width: 700, height: 700, background: 'radial-gradient(circle,rgba(41,171,226,0.2),transparent)', top: '-200px', left: '-200px' }} />
      <div className="absolute rounded-full pointer-events-none"
        style={{ width: 500, height: 500, background: 'radial-gradient(circle,rgba(124,58,237,0.15),transparent)', bottom: '-130px', right: '-100px' }} />

      {/* Dental image — right side, desktop only */}
      <div className="absolute right-0 top-0 bottom-0 hidden lg:flex items-center justify-end pointer-events-none"
        style={{ width: '55%', zIndex: 2 }}>
        <div className="relative" style={{ marginRight: '-40px' }}>
          <div className="absolute rounded-full animate-pulse"
            style={{ width: 500, height: 500, background: 'radial-gradient(circle,rgba(41,171,226,0.32),transparent)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
          <Image src="/dental3d.png" alt="Dental 3D" width={640} height={560} priority
            style={{ filter: 'drop-shadow(0 30px 80px rgba(41,171,226,0.55))', maxHeight: '88vh', width: 'auto', objectFit: 'contain', position: 'relative', zIndex: 10 }} />
        </div>
      </div>

      {/* Glass card */}
      <div className="relative z-10 w-full flex items-center justify-center lg:justify-start lg:pl-16 xl:pl-24 px-6">
        <div className="w-full max-w-[400px]"
          style={{ opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(28px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}>

          {/* Mobile dental image */}
          <div className="flex justify-center mb-4 lg:hidden">
            <Image src="/dental3d.png" alt="Code Clinic" width={200} height={170} priority
              style={{ filter: 'drop-shadow(0 12px 32px rgba(41,171,226,0.5))', objectFit: 'contain' }} />
          </div>

          <div className="rounded-3xl px-8 py-8 shadow-2xl"
            style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 40px 80px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.1)' }}>

            <Image src="/logo.png" alt="Code Clinic" width={145} height={54} className="brightness-0 invert mb-6" />

            <h1 className="text-3xl font-bold text-white leading-tight mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              Code Clinic<br />Management System
            </h1>
            <p className="text-blue-200/70 text-sm font-medium mb-8">Painless Dentistry, Lifesaving Smiles.</p>

            <div className="flex gap-3">
              <button onClick={() => router.push('/login')}
                className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:-translate-y-1 hover:shadow-2xl active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 8px 32px rgba(41,171,226,0.4)' }}>
                Sign In →
              </button>
              <button onClick={() => router.push('/setup')}
                className="flex-1 py-3.5 rounded-2xl font-bold text-white/80 text-sm transition-all hover:bg-white/15 active:scale-[0.97]"
                style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.22)' }}>
                Sign Up
              </button>
            </div>
            <p className="text-center text-[11px] text-blue-300/40 mt-6">©2026 elyrac Ai</p>
          </div>
        </div>
      </div>
    </div>

    </div>
  )
}
