'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

const ROLE_MAP: Record<string, string> = {
  ADMIN:        '/dashboard',
  DEVELOPER:    '/developer/dashboard',
  DOCTOR:       '/doctor/dashboard',
  RECEPTIONIST: '/receptionist/dashboard',
  ACCOUNTS:     '/accounts/dashboard',
}

export default function WelcomePage() {
  const router = useRouter()
  const [show] = useState(true)

  useEffect(() => {
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

      {/* Top bar */}
      <div style={{ background: '#1A237E', color: 'white', textAlign: 'center', padding: '8px', fontSize: '13px', width: '100%' }}>
        <Link href="/privacy" style={{ color: '#29ABE2', marginRight: '16px' }}>Privacy Policy</Link>
        <Link href="/terms" style={{ color: '#29ABE2' }}>Terms of Service</Link>
      </div>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-center overflow-hidden py-16 lg:py-0 lg:min-h-[92vh]">

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
          <div className="w-full max-w-[420px]"
            style={{ opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(28px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}>

            {/* Mobile dental image */}
            <div className="flex justify-center mb-4 lg:hidden">
              <Image src="/dental3d.png" alt="Code Clinic" width={200} height={170} priority
                style={{ filter: 'drop-shadow(0 12px 32px rgba(41,171,226,0.5))', objectFit: 'contain' }} />
            </div>

            <div className="rounded-3xl px-8 py-8 shadow-2xl"
              style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 40px 80px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.1)' }}>

              <Image src="/logo.png" alt="Code Clinic" width={145} height={54} className="brightness-0 invert mb-6" />

              <h1 className="text-2xl font-bold text-white leading-tight mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Code Clinic —<br />AI-Powered Dental Practice<br />Management System
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

      {/* ── About section ───────────────────────────────────────── */}
      <div style={{ background: 'rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-10">

          <div>
            <div className="text-2xl mb-3">🦷</div>
            <h2 className="text-white font-bold text-lg mb-3">What is Code Clinic?</h2>
            <p className="text-blue-200/60 text-sm leading-relaxed">
              Code Clinic is a comprehensive dental practice management platform used by dental clinics
              and their staff — doctors, receptionists, and accounts teams. It covers appointment
              scheduling, patient records, treatment plans, dental charting, billing and invoicing,
              stock management, and AI-assisted patient communications via WhatsApp, SMS, and voice.
            </p>
          </div>

          <div>
            <div className="text-2xl mb-3">📅</div>
            <h2 className="text-white font-bold text-lg mb-3">Why We Connect to Google Calendar</h2>
            <p className="text-blue-200/60 text-sm leading-relaxed">
              Code Clinic integrates with Google Calendar so that dental appointments booked in the
              system are automatically synced to the clinic&apos;s Google Calendar. This allows doctors
              and staff to view their daily schedule directly from Google Calendar alongside other
              commitments — no double-entry needed.
            </p>
          </div>

          <div>
            <div className="text-2xl mb-3">👥</div>
            <h2 className="text-white font-bold text-lg mb-3">Who Uses Code Clinic?</h2>
            <p className="text-blue-200/60 text-sm leading-relaxed">
              Code Clinic is used exclusively by dental clinic staff — clinic administrators, dentists,
              dental nurses, receptionists, and accounts officers. Access is role-based and requires an
              invitation from the clinic administrator. It is not a consumer-facing application.
            </p>
          </div>
        </div>
      </div>

      {/* ── Google Calendar disclosure ───────────────────────────── */}
      <div style={{ background: 'rgba(41,171,226,0.07)', borderTop: '1px solid rgba(41,171,226,0.2)', borderBottom: '1px solid rgba(41,171,226,0.2)' }}>
        <div className="max-w-3xl mx-auto px-6 py-12 text-center">
          <div className="text-3xl mb-4">🔒</div>
          <h2 className="text-white font-bold text-xl mb-4">How We Use Google Calendar</h2>
          <p className="text-blue-200/70 text-base leading-relaxed mb-4">
            Code Clinic connects to Google Calendar to sync dental appointments. When a clinic staff
            member authorises the integration, we read and write calendar events that correspond to
            clinic appointments only. We use the minimum permissions required — we do not access
            contacts, emails, or any other Google data.
          </p>
          <p className="text-blue-200/50 text-sm leading-relaxed">
            We do not share your Google account data with any third parties. Calendar data is used
            solely to display and manage clinic appointment schedules within Code Clinic. You can
            revoke access at any time from your Google Account settings or from the Integrations
            page inside Code Clinic.
          </p>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div style={{ background: '#020818', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-blue-300/40 text-xs">©2026 elyrac Ai · Code Clinic EMR</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="text-xs text-blue-300/60 hover:text-blue-300 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-xs text-blue-300/60 hover:text-blue-300 transition-colors">Terms of Service</Link>
            <a href="mailto:support@codeclinicemr.com" className="text-xs text-blue-300/60 hover:text-blue-300 transition-colors">Contact</a>
          </div>
        </div>
      </div>

    </div>
  )
}
