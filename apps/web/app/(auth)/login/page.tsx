'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setAuthCookie } from '@/lib/api'
import { questrial } from '../../fonts/questrial'

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

  useEffect(() => {
    const isDark = localStorage.getItem('cc_theme') !== 'light'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)

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

  /* Theme tokens. Light-mode page background is colour-matched to the
     dental photo's own sampled background (~#63b2f5-#76bcf9) so the photo
     blends into the page with no visible seam/frame — ONE continuous
     environment, per the approved direction. */
  const pageBg   = dark ? 'linear-gradient(150deg,#020818 0%,#070f3d 35%,#0d1b6e 70%,#1251a8 100%)' : 'linear-gradient(135deg,#66B4F5 0%,#72BAF6 100%)'
  const cardBg   = dark ? 'rgba(8,15,40,0.50)' : 'rgba(255,255,255,0.58)'
  const cardBdr  = dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.8)'
  const titleClr = dark ? '#fff' : '#1A237E'
  const subClr   = dark ? '#93C5FD' : '#5A6A85'
  const lblClr   = dark ? '#C8D8F0' : '#374151'
  const inputBg  = dark ? 'rgba(255,255,255,0.07)' : '#F3F7FF'
  const inputBdr = dark ? 'rgba(255,255,255,0.16)' : '#BDD0FF'
  const inputClr = dark ? '#fff' : '#1A237E'
  // Bottom scrim for mobile only, where the photo is a full-bleed cover
  // background behind the card and needs a legibility assist.
  const mobileScrim = dark
    ? 'linear-gradient(to top, rgba(3,8,26,0.92) 0%, rgba(3,8,26,0.65) 35%, rgba(3,8,26,0.30) 65%, transparent 90%)'
    : 'linear-gradient(to top, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.58) 35%, rgba(255,255,255,0.24) 65%, transparent 90%)'

  // Same Questrial treatment as the rest of Code Clinic (see .cc-admin-shell /
  // .cc-receptionist-shell in globals.css) — identical font-family stack and
  // tracking/line-height tokens, applied inline since this page's scope can't
  // add a new global class.
  const uiFont      = { fontFamily: 'var(--font-questrial), Inter, system-ui, sans-serif', letterSpacing: '0.008em', lineHeight: 1.5 }
  const headingFont = { fontFamily: 'var(--font-questrial), Inter, system-ui, sans-serif', letterSpacing: '0.004em', lineHeight: 1.25 }

  return (
    <div className={cn("relative z-0 min-h-screen w-full overflow-x-hidden flex flex-col", questrial.variable)} style={{ background: pageBg, transition: 'background 0.5s' }}>
      <style>{`
        @keyframes loginCardIn { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: translateY(0) } }
        .login-card-in { animation: loginCardIn 0.5s ease-out both }
        @media (prefers-reduced-motion: reduce) { .login-card-in { animation: none } }
      `}</style>

      {/* ONE continuous full-viewport dental/blue environment. Mobile gets a
          full-bleed cover photo (cropped is fine there — the card sits low
          with a scrim). Tablet/desktop gets the SAME photo at a deliberately
          smaller-than-cover scale, right-anchored with no crop of its own
          frame, so it reads as part of the page rather than a filled
          background — the page's colour-matched background shows through
          wherever the photo doesn't reach, with no visible seam or frame. */}
      <div className="md:hidden fixed inset-0 -z-20">
        <Image
          src="/images/login-dental-bg.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_25%]"
        />
        <div className="absolute inset-0" style={{ background: mobileScrim }}/>
      </div>
      {/* Desktop/tablet composition — a wrapper sized to the photo's OWN
          rendered box (not the full viewport), right-anchored and vertically
          centred, deliberately smaller than "cover" so the complete scene
          stays fully visible with breathing room. Because the mask is
          applied to a box that exactly matches the image's own dimensions,
          its percentages align with the image's real edges, so it dissolves
          into the matched page background with no visible seam — sizing the
          wrapper to the content is what a viewport-wide mask (tried first)
          got wrong. */}
      <div
        className="hidden md:block fixed right-0 top-1/2 -translate-y-1/2 md:w-[500px] lg:w-[650px] xl:w-[1080px] 2xl:w-[1350px]"
        style={{ aspectRatio: '2400 / 1632' }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 bg-no-repeat bg-cover bg-right"
          style={{
            backgroundImage: "url('/images/login-dental-bg.jpg')",
            WebkitMaskImage: 'radial-gradient(ellipse 85% 85% at 72% 50%, black 55%, transparent 100%)',
            maskImage: 'radial-gradient(ellipse 85% 85% at 72% 50%, black 55%, transparent 100%)',
          }}
        />
      </div>

      {/* Glass login card — floats over the SAME backdrop, left-inset, well
          clear of the dental composition (which is controlled independently
          above). No dedicated "right column" — this is the only content
          zone; the environment behind it is a single background layer. */}
      <div className="relative z-10 flex-1 w-full flex items-center justify-center md:justify-start px-4 md:pl-[5%] pb-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))] md:pb-8">
        <div className="w-full max-w-[440px] md:max-w-[340px] lg:max-w-[420px] xl:max-w-[460px] login-card-in" style={uiFont}>

            <div className="rounded-[32px] px-7 py-7 sm:px-8 sm:py-8 md:px-6 md:py-6 lg:px-8 lg:py-8"
              style={{ background:cardBg, backdropFilter:'blur(28px)', WebkitBackdropFilter:'blur(28px)', border:`1px solid ${cardBdr}`, boxShadow:dark?'0 24px 64px rgba(0,0,0,0.5)':'0 24px 64px rgba(26,35,126,0.18)' }}>

              <Image src="/logo.png" alt="Code Clinic" width={130} height={45} className={dark?'brightness-0 invert mb-5':'mb-5'} style={{ transition:'filter 0.3s' }}/>

              <h2 className="text-2xl md:text-xl lg:text-2xl font-bold mb-1" style={{ color:titleClr, ...headingFont }}>
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

      <div style={{ position:'fixed', bottom:0, left:0, right:0, textAlign:'center', padding:'16px', paddingBottom:'max(16px, env(safe-area-inset-bottom))', fontSize:'13px', color:dark?'rgba(255,255,255,0.65)':'rgba(26,35,126,0.65)', zIndex:40, ...uiFont }}>
        <a href="/privacy.html" style={{ color: '#29ABE2', textDecoration: 'none' }}>Privacy Policy</a>
        {' · '}
        <a href="/terms.html" style={{ color: '#29ABE2', textDecoration: 'none' }}>Terms of Service</a>
      </div>
    </div>
  )
}
