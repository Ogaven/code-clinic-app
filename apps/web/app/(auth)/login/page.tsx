'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

const ROLE_REDIRECTS: Record<string, string> = {
  ACCOUNTS:     '/accounts/dashboard',
  RECEPTIONIST: '/receptionist/dashboard',
  DOCTOR:       '/dashboard',
  ADMIN:        '/dashboard',
  DEVELOPER:    '/dashboard',
}

export default function LoginPage() {
  const router  = useRouter()
  const [email, setEmail]   = useState('')
  const [pwd, setPwd]       = useState('')
  const [showPwd, setShow]  = useState(false)
  const [loading, setLoad]  = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [ready, setReady]   = useState(false)

  useEffect(() => {
    setTimeout(() => setReady(true), 60)
    // Redirect to setup if no users exist yet
    fetch('/api-proxy/auth/needs-setup')
      .then(r => r.json())
      .then(d => { if (d.needsSetup) router.replace('/setup') })
      .catch(() => {})
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setLoad(true)
    try {
      const res = await fetch('/api-proxy/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid credentials.'); return }
      if (data.requiresTwoFactor) { sessionStorage.setItem('cc_temp_token', data.tempToken); router.push('/2fa'); return }
      localStorage.setItem('cc_token', data.accessToken)
      localStorage.setItem('cc_user', JSON.stringify(data.user))
      router.push(ROLE_REDIRECTS[data.user?.role] || '/dashboard')
    } catch {
      setError('Cannot reach server. Please try again.')
    } finally { setLoad(false) }
  }

  return (
    <div className="h-screen w-screen overflow-hidden relative flex"
      style={{ background: 'linear-gradient(150deg,#020818 0%,#070f3d 35%,#0d1b6e 70%,#1251a8 100%)' }}>

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize:'36px 36px' }}/>

      {/* Glow blobs */}
      <div className="absolute rounded-full pointer-events-none" style={{ width:600,height:600,background:'radial-gradient(circle,rgba(41,171,226,0.18),transparent)',top:'-200px',left:'-150px' }}/>
      <div className="absolute rounded-full pointer-events-none" style={{ width:400,height:400,background:'radial-gradient(circle,rgba(124,58,237,0.12),transparent)',bottom:'-100px',right:'-80px' }}/>

      {/* ── LEFT: login card ── */}
      <div className="flex items-center justify-center w-full lg:w-1/2 px-5 relative z-10">
        <div className="w-full max-w-[400px]"
          style={{ opacity:ready?1:0, transform:ready?'translateY(0)':'translateY(20px)', transition:'opacity 0.5s ease, transform 0.5s ease' }}>

          <div className="rounded-3xl px-6 py-7"
            style={{ background:'rgba(255,255,255,0.08)', backdropFilter:'blur(36px)', WebkitBackdropFilter:'blur(36px)', border:'1px solid rgba(255,255,255,0.14)', boxShadow:'0 24px 64px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.08)' }}>

            {/* Logo */}
            <Image src="/logo.png" alt="Code Clinic" width={120} height={42} className="brightness-0 invert mb-5"/>

            <h2 className="text-xl font-bold text-white mb-0.5" style={{ fontFamily:'Plus Jakarta Sans' }}>Sign In</h2>
            <p className="text-sm text-blue-200/60 mb-5">Enter your credentials to continue</p>

            <form onSubmit={handleLogin} className="space-y-3.5">
              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-blue-100 mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35"/>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@codeclinic.ug" required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all text-white placeholder-white/25"
                    style={{ background:'rgba(255,255,255,0.07)', border:'1.5px solid rgba(255,255,255,0.16)', caretColor:'#29ABE2' }}
                    onFocus={e=>{ e.target.style.borderColor='#29ABE2'; e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)' }}
                    onBlur={e=>{ e.target.style.borderColor='rgba(255,255,255,0.16)'; e.target.style.boxShadow='none' }}/>
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-blue-100">Password</label>
                  <button type="button" className="text-xs font-semibold text-cyan-400 hover:underline">Forgot Password?</button>
                </div>
                <div className="relative">
                  <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35"/>
                  <input type={showPwd?'text':'password'} value={pwd} onChange={e => setPwd(e.target.value)}
                    placeholder="••••••••" required
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl text-sm outline-none transition-all text-white"
                    style={{ background:'rgba(255,255,255,0.07)', border:'1.5px solid rgba(255,255,255,0.16)' }}
                    onFocus={e=>{ e.target.style.borderColor='#29ABE2'; e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)' }}
                    onBlur={e=>{ e.target.style.borderColor='rgba(255,255,255,0.16)'; e.target.style.boxShadow='none' }}/>
                  <button type="button" onClick={() => setShow(!showPwd)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                    {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2"
                  style={{ background:'rgba(239,68,68,0.13)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                  ⚠ {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className={cn('w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:scale-[0.98] mt-1', loading && 'opacity-60 cursor-not-allowed')}
                style={{ background:loading?'#6B7280':'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 6px 24px rgba(41,171,226,0.38)' }}>
                {loading && <Loader2 size={15} className="animate-spin"/>}
                {loading ? 'Signing in...' : 'Sign In →'}
              </button>
            </form>

            <p className="text-center text-xs mt-5 text-blue-200/50">
              New here?{' '}
              <Link href="/setup" className="text-cyan-400 font-bold hover:underline">Create an account</Link>
            </p>
          </div>

          <p className="text-center text-[11px] text-white/25 mt-4">©2026 elyrac Ai</p>
        </div>
      </div>

      {/* ── RIGHT: dental image (desktop only) ── */}
      <div className="hidden lg:flex items-center justify-center relative z-10" style={{ width:'50%' }}>
        <div className="absolute rounded-full animate-pulse pointer-events-none"
          style={{ width:460,height:460,background:'radial-gradient(circle,rgba(41,171,226,0.28),transparent)',zIndex:1 }}/>
        <div className="absolute top-8 left-0 right-0 text-center z-20 pointer-events-none">
          <p className="font-bold text-lg text-white/80" style={{ fontFamily:'Plus Jakarta Sans' }}>Code Clinic Management System</p>
          <p className="text-sm text-blue-200/50 mt-0.5">Painless Dentistry, Lifesaving Smiles.</p>
        </div>
        <div className="relative" style={{ zIndex:10 }}>
          <Image src="/dental3d.png" alt="Dental 3D" width={480} height={420} priority
            style={{ filter:'drop-shadow(0 24px 64px rgba(41,171,226,0.5))', maxHeight:'70vh', width:'auto', objectFit:'contain' }}/>
        </div>
        {/* Stat chips */}
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ top:'20%',left:'4%',background:'rgba(13,27,110,0.7)',backdropFilter:'blur(20px)',border:'1px solid rgba(41,171,226,0.3)' }}>
          <p className="text-lg mb-0.5">🦷</p><p className="text-xs font-bold text-blue-100">Your smile is your<br/>best accessory</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ bottom:'20%',left:'4%',background:'rgba(13,27,110,0.7)',backdropFilter:'blur(20px)',border:'1px solid rgba(41,171,226,0.3)' }}>
          <p className="text-lg mb-0.5">✨</p><p className="text-xs font-bold text-blue-100">5,000+ smiles<br/>transformed</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ top:'20%',right:'4%',background:'rgba(13,27,110,0.7)',backdropFilter:'blur(20px)',border:'1px solid rgba(41,171,226,0.3)' }}>
          <p className="text-lg mb-0.5">🏆</p><p className="text-xs font-bold text-blue-100">98% patient<br/>satisfaction</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-xl" style={{ bottom:'20%',right:'4%',background:'rgba(16,185,129,0.18)',backdropFilter:'blur(20px)',border:'1px solid rgba(16,185,129,0.32)' }}>
          <p className="text-lg mb-0.5">💙</p><p className="text-xs font-bold text-white">Pain-free dentistry<br/>is our promise</p>
        </div>
      </div>
    </div>
  )
}
