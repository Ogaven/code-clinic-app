'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.252 17.64 11.927 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

function AppleIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={color}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

const ROLE_REDIRECTS: Record<string, string> = {
  ACCOUNTS: '/accounts/dashboard', RECEPTIONIST: '/receptionist/dashboard',
  DOCTOR: '/doctor/dashboard', ADMIN: '/dashboard', DEVELOPER: '/developer/dashboard',
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]   = useState('')
  const [pwd, setPwd]       = useState('')
  const [showPwd, setShow]  = useState(false)
  const [loading, setLoad]  = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [dark, setDark]     = useState(true)
  const [ready, setReady]   = useState(false)

  useEffect(() => {
    const isDark = localStorage.getItem('cc_theme') !== 'light'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
    setTimeout(() => setReady(true), 60)

    // Show OAuth error if redirected back from Google with error
    const oauthError = new URLSearchParams(window.location.search).get('error')
    if (oauthError) setError('Google sign-in failed. Please try again or use email.')

    // Redirect to setup if no users exist
    fetch('/api-proxy/auth/needs-setup')
      .then(r => r.json())
      .then(d => { if (d.needsSetup) router.replace('/setup') })
      .catch(() => {})
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('cc_theme', next ? 'dark' : 'light')
  }

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

  function handleGoogle() {
    window.location.href = '/api-proxy/auth/google'
  }

  /* Theme tokens */
  const pageBg   = dark ? 'linear-gradient(150deg,#020818 0%,#070f3d 35%,#0d1b6e 70%,#1251a8 100%)' : 'linear-gradient(150deg,#EBF0FF 0%,#D6E4FF 50%,#E8F4FF 100%)'
  const cardBg   = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)'
  const cardBdr  = dark ? 'rgba(255,255,255,0.14)' : 'rgba(186,212,255,0.9)'
  const titleClr = dark ? '#fff' : '#1A237E'
  const subClr   = dark ? '#93C5FD' : '#5A6A85'
  const lblClr   = dark ? '#C8D8F0' : '#374151'
  const inputBg  = dark ? 'rgba(255,255,255,0.07)' : '#F3F7FF'
  const inputBdr = dark ? 'rgba(255,255,255,0.16)' : '#BDD0FF'
  const inputClr = dark ? '#fff' : '#1A237E'
  const socialBg = dark ? 'rgba(255,255,255,0.09)' : '#fff'
  const socialBdr= dark ? 'rgba(255,255,255,0.18)' : '#DDE8FF'
  const chipBg   = dark ? 'rgba(13,27,110,0.7)' : 'rgba(255,255,255,0.85)'
  const chipBdr  = dark ? 'rgba(41,171,226,0.3)' : 'rgba(26,35,126,0.15)'
  const chipTxt  = dark ? '#E0F0FF' : '#1A237E'

  return (
    <div className="h-screen w-screen overflow-hidden relative flex"
      style={{ background: pageBg, transition: 'background 0.5s' }}>

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize:'36px 36px' }}/>

      {/* Glow blobs */}
      <div className="absolute rounded-full pointer-events-none" style={{ width:600,height:600,background:`radial-gradient(circle,${dark?'rgba(41,171,226,0.18)':'rgba(41,171,226,0.1)'},transparent)`,top:'-200px',left:'-150px' }}/>
      <div className="absolute rounded-full pointer-events-none" style={{ width:400,height:400,background:`radial-gradient(circle,${dark?'rgba(124,58,237,0.12)':'rgba(124,58,237,0.06)'},transparent)`,bottom:'-100px',right:'-80px' }}/>

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        className="absolute top-5 right-5 z-50 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
        style={{ background:dark?'rgba(255,255,255,0.1)':'rgba(26,35,126,0.08)', border:`1px solid ${dark?'rgba(255,255,255,0.2)':'rgba(26,35,126,0.12)'}` }}>
        {dark ? <Sun size={17} color="#FCD34D"/> : <Moon size={17} color="#1A237E"/>}
      </button>

      {/* ── LEFT: login card ── */}
      <div className="flex items-center justify-center w-full lg:w-1/2 px-5 relative z-10">
        <div className="w-full max-w-[400px]"
          style={{ opacity:ready?1:0, transform:ready?'translateY(0)':'translateY(20px)', transition:'opacity 0.5s, transform 0.5s' }}>

          <div className="rounded-3xl px-6 py-6"
            style={{ background:cardBg, backdropFilter:'blur(36px)', WebkitBackdropFilter:'blur(36px)', border:`1px solid ${cardBdr}`, boxShadow:dark?'0 24px 64px rgba(0,0,0,0.5)':'0 24px 64px rgba(26,35,126,0.14)' }}>

            <Image src="/logo.png" alt="Code Clinic" width={115} height={40} className={dark?'brightness-0 invert mb-4':'mb-4'} style={{ transition:'filter 0.3s' }}/>

            <h2 className="text-xl font-bold mb-0.5" style={{ color:titleClr, fontFamily:'Plus Jakarta Sans' }}>
              We brighten your smile 😁
            </h2>
            <p className="text-xs mb-4" style={{ color:subClr }}>Sign in with your clinic credentials</p>

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color:lblClr }}>Email</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.4 }}/>
                  <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@codeclinic.ug" required
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all"
                    style={{ background:inputBg, border:`1.5px solid ${inputBdr}`, color:inputClr, caretColor:'#29ABE2' }}
                    onFocus={e=>{e.target.style.borderColor='#29ABE2';e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)'}}
                    onBlur={e=>{e.target.style.borderColor=inputBdr;e.target.style.boxShadow='none'}}/>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold" style={{ color:lblClr }}>Password</label>
                  <button type="button" className="text-xs font-semibold hover:underline" style={{ color:'#29ABE2' }}>Forgot?</button>
                </div>
                <div className="relative">
                  <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.4 }}/>
                  <input type={showPwd?'text':'password'} value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="••••••••" required
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl text-sm outline-none transition-all"
                    style={{ background:inputBg, border:`1.5px solid ${inputBdr}`, color:inputClr }}
                    onFocus={e=>{e.target.style.borderColor='#29ABE2';e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)'}}
                    onBlur={e=>{e.target.style.borderColor=inputBdr;e.target.style.boxShadow='none'}}/>
                  <button type="button" onClick={()=>setShow(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.45 }}>
                    {showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl px-3.5 py-2 text-xs flex items-center gap-2"
                  style={{ background:'rgba(239,68,68,0.13)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                  ⚠ {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className={cn('w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:scale-[0.98]', loading&&'opacity-60 cursor-not-allowed')}
                style={{ background:loading?'#6B7280':'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 6px 24px rgba(41,171,226,0.38)' }}>
                {loading&&<Loader2 size={14} className="animate-spin"/>}
                {loading?'Signing in...':'Sign In →'}
              </button>
            </form>

            <p className="text-center text-xs mt-4" style={{ color:subClr }}>
              New here?{' '}
              <Link href="/setup" className="font-bold hover:underline" style={{ color:'#29ABE2' }}>Create account</Link>
            </p>
          </div>
          <p className="text-center text-[11px] mt-3" style={{ color:dark?'rgba(255,255,255,0.2)':'rgba(26,35,126,0.3)' }}>©2026 elyrac Ai</p>
        </div>
      </div>

      {/* ── RIGHT: dental image (desktop only) ── */}
      <div className="hidden lg:flex items-center justify-center relative z-10" style={{ width:'50%' }}>
        <div className="absolute rounded-full animate-pulse pointer-events-none"
          style={{ width:460,height:460,background:'radial-gradient(circle,rgba(41,171,226,0.28),transparent)',zIndex:1 }}/>
        <div className="absolute top-8 left-0 right-0 text-center z-20 pointer-events-none">
          <p className="font-bold text-lg" style={{ color:dark?'rgba(255,255,255,0.85)':'rgba(26,35,126,0.75)', fontFamily:'Plus Jakarta Sans' }}>
            Code Clinic Management System
          </p>
          <p className="text-sm mt-0.5" style={{ color:dark?'rgba(147,197,253,0.7)':'rgba(26,35,126,0.5)' }}>Painless Dentistry, Lifesaving Smiles.</p>
        </div>
        <div className="relative" style={{ zIndex:10 }}>
          <Image src="/dental3d.png" alt="Dental 3D" width={480} height={420} priority
            style={{ filter:'drop-shadow(0 24px 64px rgba(41,171,226,0.5))', maxHeight:'70vh', width:'auto', objectFit:'contain' }}/>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ top:'20%',left:'4%',background:chipBg,backdropFilter:'blur(20px)',border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">🦷</p><p className="text-xs font-bold" style={{ color:chipTxt }}>Your smile is your<br/>best accessory</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ bottom:'20%',left:'4%',background:chipBg,backdropFilter:'blur(20px)',border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">✨</p><p className="text-xs font-bold" style={{ color:chipTxt }}>5,000+ smiles<br/>transformed</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl" style={{ top:'20%',right:'4%',background:chipBg,backdropFilter:'blur(20px)',border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">🏆</p><p className="text-xs font-bold" style={{ color:chipTxt }}>98% patient<br/>satisfaction</p>
        </div>
        <div className="absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-xl" style={{ bottom:'20%',right:'4%',background:'rgba(16,185,129,0.18)',backdropFilter:'blur(20px)',border:'1px solid rgba(16,185,129,0.32)' }}>
          <p className="text-lg mb-0.5">💙</p><p className="text-xs font-bold text-white">Pain-free dentistry<br/>is our promise</p>
        </div>
      </div>
    </div>
  )
}
