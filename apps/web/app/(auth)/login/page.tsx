'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setAuthCookie } from '@/lib/api'

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


export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]   = useState('')
  const [pwd, setPwd]       = useState('')
  const [showPwd, setShow]  = useState(false)
  const [loading, setLoad]  = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [dark, setDark]     = useState(true)
  const [ready, setReady]   = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const isDark = localStorage.getItem('cc_theme') !== 'light'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    setTimeout(() => setReady(true), 60)

    // Show OAuth error if redirected back from Google with error
    const oauthError = new URLSearchParams(window.location.search).get('error')
    if (oauthError === 'google_no_account')
      setError('No account found for that Google address. Ask your admin to create your account first.')
    else if (oauthError === 'google_inactive')
      setError('Your account is inactive. Contact your administrator.')
    else if (oauthError)
      setError('Google sign-in failed. Please try again or use email/password.')

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
      setAuthCookie(data.accessToken)
      const ROLE_HOME: Record<string, string> = {
        RECEPTIONIST: '/receptionist/dashboard',
        ADMIN:        '/dashboard',
        DOCTOR:       '/doctor/dashboard',
        ACCOUNTS:     '/accounts/dashboard',
        DEVELOPER:    '/developer/dashboard',
      }
      const home = ROLE_HOME[data.user.role]
      if (!home) throw new Error('Unknown role: ' + data.user.role)
      window.location.href = home
    } catch {
      setError('Cannot reach server. Please try again.')
    } finally { setLoad(false) }
  }

  function handleGoogle() {
    window.location.href = '/api-proxy/auth/google'
  }

  /* Theme tokens — glass panel over the full-bleed dental photograph */
  const fallbackBg = dark ? '#050b22' : '#cfe4ff'
  const cardBg   = dark ? 'rgba(8,15,40,0.60)' : 'rgba(255,255,255,0.68)'
  const cardBdr  = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.75)'
  const titleClr = dark ? '#fff' : '#1A237E'
  const subClr   = dark ? '#93C5FD' : '#5A6A85'
  const lblClr   = dark ? '#C8D8F0' : '#374151'
  const inputBg  = dark ? 'rgba(255,255,255,0.07)' : '#F3F7FF'
  const inputBdr = dark ? 'rgba(255,255,255,0.16)' : '#BDD0FF'
  const inputClr = dark ? '#fff' : '#1A237E'
  // Tonal scrim behind the card zone — theme-coloured (navy / soft-white),
  // never flat grey, so the photo keeps its colour while staying legible.
  const sideScrim   = dark
    ? 'linear-gradient(100deg, rgba(3,8,26,0.80) 0%, rgba(3,8,26,0.46) 36%, rgba(3,8,26,0.10) 58%, transparent 70%)'
    : 'linear-gradient(100deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.22) 36%, rgba(255,255,255,0.04) 58%, transparent 70%)'
  const bottomScrim = dark
    ? 'linear-gradient(to top, rgba(3,8,26,0.88) 0%, rgba(3,8,26,0.5) 32%, transparent 68%)'
    : 'linear-gradient(to top, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.28) 32%, transparent 68%)'

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">

      {/* Full-bleed dental photograph — the visual hero. Object-position shifts
          per breakpoint so the tooth cluster (which sits right-of-centre in the
          source) stays clear of the card at every width. */}
      <div className="fixed inset-0 -z-20" style={{ background: fallbackBg }}>
        <Image
          src="/images/login-dental-bg.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_28%] md:object-[76%_center] xl:object-right"
        />
      </div>

      {/* Theme-coloured tonal scrims — ground the glass card and footer against
          the photo. Always navy or soft-white, never a flat grey wash. */}
      <div className="fixed inset-0 -z-10 hidden md:block pointer-events-none" style={{ background: sideScrim, transition: 'background 0.4s' }}/>
      <div className="fixed inset-0 -z-10 pointer-events-none" style={{ background: bottomScrim, transition: 'background 0.4s' }}/>

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        className="fixed top-5 right-5 z-50 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
        style={{ background:dark?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.55)', border:`1px solid ${dark?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.7)'}`, backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)' }}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {dark ? <Sun size={17} color="#FCD34D"/> : <Moon size={17} color="#1A237E"/>}
      </button>

      {/* Login zone — left ~40% at tablet/desktop (glass card centred within
          it, never overlapping the tooth on the right); lower-centred over the
          photo on mobile, with a bottom scrim for legibility. */}
      <div className="relative z-10 min-h-screen w-full flex flex-col md:flex-row">
        <div className="flex-1 flex items-end md:items-center justify-center px-4 md:px-6 lg:px-0 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))] md:pb-0 md:w-[52%] lg:w-[46%] xl:w-[41%] md:flex-none">
          <div className="w-full max-w-[440px] md:max-w-[340px] lg:max-w-[420px] xl:max-w-[500px]"
            style={reduceMotion ? undefined : { opacity:ready?1:0, transform:ready?'translateY(0)':'translateY(18px)', transition:'opacity 0.5s, transform 0.5s' }}>

            <div className="rounded-[32px] px-7 py-7 sm:px-8 sm:py-8 md:px-6 md:py-6 lg:px-8 lg:py-8"
              style={{ background:cardBg, backdropFilter:'blur(28px)', WebkitBackdropFilter:'blur(28px)', border:`1px solid ${cardBdr}`, boxShadow:dark?'0 24px 64px rgba(0,0,0,0.5)':'0 24px 64px rgba(26,35,126,0.18)' }}>

              <Image src="/logo.png" alt="Code Clinic" width={130} height={45} className={dark?'brightness-0 invert mb-5':'mb-5'} style={{ transition:'filter 0.3s' }}/>

              <h2 className="text-2xl md:text-xl lg:text-2xl font-bold mb-1" style={{ color:titleClr, fontFamily:'Plus Jakarta Sans' }}>
                We brighten your smile 😁
              </h2>
              <p className="text-sm mb-5" style={{ color:subClr }}>Sign in with your clinic credentials</p>

              <form onSubmit={handleLogin} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color:lblClr }}>Email</label>
                  <div className="relative">
                    <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.4 }}/>
                    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@codeclinic.ug" required
                      className="w-full pl-9 pr-4 py-3 rounded-xl text-sm outline-none transition-all"
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
                      className="w-full pl-9 pr-10 py-3 rounded-xl text-sm outline-none transition-all"
                      style={{ background:inputBg, border:`1.5px solid ${inputBdr}`, color:inputClr }}
                      onFocus={e=>{e.target.style.borderColor='#29ABE2';e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)'}}
                      onBlur={e=>{e.target.style.borderColor=inputBdr;e.target.style.boxShadow='none'}}/>
                    <button type="button" onClick={()=>setShow(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                      style={{ color:inputClr, opacity:0.45 }}>
                      {showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </button>
                  </div>
                </div>

                {error && (
                  <div role="alert" aria-live="polite" className="rounded-xl px-3.5 py-2 text-xs flex items-center gap-2"
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

            </div>
            <p className="text-center text-[11px] mt-3" style={{ color:dark?'rgba(255,255,255,0.55)':'rgba(26,35,126,0.45)' }}>©2026 elyrac Ai</p>
          </div>
        </div>

        {/* Right visual zone — the photograph shows through here; deliberately
            empty, never covered by the card. */}
        <div className="hidden md:block md:w-[48%] lg:w-[54%] xl:w-[59%] md:flex-none" aria-hidden="true"/>
      </div>

      <div style={{ position:'fixed', bottom:0, left:0, right:0, textAlign:'center', padding:'16px', paddingBottom:'max(16px, env(safe-area-inset-bottom))', fontSize:'13px', color:dark?'rgba(255,255,255,0.65)':'rgba(26,35,126,0.65)', zIndex:40 }}>
        <a href="/privacy.html" style={{ color: '#29ABE2', textDecoration: 'none' }}>Privacy Policy</a>
        {' · '}
        <a href="/terms.html" style={{ color: '#29ABE2', textDecoration: 'none' }}>Terms of Service</a>
      </div>
    </div>
  )
}
